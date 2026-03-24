import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes in this router
router.use(requireAuth);

// POST /api/admin/groups/merge - Merge multiple groups into one
router.post('/merge', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { groupIds, displayTitle } = req.body;

        if (!groupIds || groupIds.length < 2) {
            return res.status(400).json({ error: 'At least 2 groups are required for merging' });
        }

        if (!displayTitle || displayTitle.trim().length === 0) {
            return res.status(400).json({ error: 'Display title is required' });
        }

        await client.query('BEGIN');

        // Verify groups exist and check compatibility
        const groupsResult = await client.query(`
            SELECT g.id, 
                   COUNT(DISTINCT c.number_of_voices) as voice_variations,
                   COUNT(DISTINCT c.composition_type_id) as type_variations,
                   COUNT(DISTINCT c.tone) as tone_variations,
                   COUNT(DISTINCT c.even_odd) as even_odd_variations
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            WHERE g.id = ANY($1)
            GROUP BY g.id
        `, [groupIds]);

        if (groupsResult.rows.length !== groupIds.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'One or more groups not found' });
        }

        // Check if groups are compatible (all compositions must have same properties)
        const compatibilityCheck = await client.query(`
            SELECT COUNT(DISTINCT c.number_of_voices) as voice_variations,
                   COUNT(DISTINCT c.composition_type_id) as type_variations,
                   COUNT(DISTINCT c.tone) as tone_variations,
                   COUNT(DISTINCT c.even_odd) as even_odd_variations
            FROM compositions c
            WHERE c.group_id = ANY($1)
        `, [groupIds]);

        const compat = compatibilityCheck.rows[0];
        if (compat.voice_variations > 1 || compat.type_variations > 1 || 
            compat.tone_variations > 1 || compat.even_odd_variations > 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Groups cannot be merged due to incompatible composition properties (voices, type, tone, or even/odd values differ)' 
            });
        }

        // Create new group for the merge
        const newGroupResult = await client.query(`
            INSERT INTO groups (display_title, created_at, updated_at) 
            VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
            RETURNING id
        `, [displayTitle.trim()]);

        const newGroupId = newGroupResult.rows[0].id;

        // Move all compositions to the new group
        await client.query(`
            UPDATE compositions 
            SET group_id = $1 
            WHERE group_id = ANY($2)
        `, [newGroupId, groupIds]);

        // Move all editions to the new group
        await client.query(`
            UPDATE editions 
            SET group_id = $1 
            WHERE group_id = ANY($2)
        `, [newGroupId, groupIds]);

        // Move all recordings to the new group
        await client.query(`
            UPDATE recordings 
            SET group_id = $1 
            WHERE group_id = ANY($2)
        `, [newGroupId, groupIds]);

        // Store old group data for audit trail before deletion
        const oldGroupsResult = await client.query(`
            SELECT * FROM groups WHERE id = ANY($1)
        `, [groupIds]);
        const oldGroups = oldGroupsResult.rows;

        // Delete the old groups
        await client.query(`
            DELETE FROM groups 
            WHERE id = ANY($1)
        `, [groupIds]);

        await client.query('COMMIT');

        // Log comprehensive merge audit entry
        try {
            await pool.query(
                `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.user?.id || null,
                    req.user?.email || 'unknown@system.local',
                    'UPDATE',
                    'groups',
                    newGroupId,
                    JSON.stringify({ 
                        action: 'group_merge',
                        source_groups: oldGroups.map(g => ({ 
                            id: g.id, 
                            display_title: g.display_title,
                            created_at: g.created_at,
                            updated_at: g.updated_at
                        }))
                    }),
                    JSON.stringify({ 
                        action: 'group_merge',
                        result_group: {
                            id: newGroupId,
                            display_title: displayTitle,
                            merged_count: groupIds.length,
                            source_group_ids: groupIds,
                            source_group_titles: oldGroups.map(g => g.display_title)
                        }
                    })
                ]
            );
        } catch (auditError) {
            console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }

        res.json({ 
            success: true, 
            newGroupId: newGroupId,
            message: `Successfully merged ${groupIds.length} groups into "${displayTitle}"` 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Group merge error:', error);
        res.status(500).json({ error: 'Failed to merge groups' });
    } finally {
        client.release();
    }
});

// POST /api/admin/groups/editions - Add edition to a group
router.post('/editions', async (req, res) => {
    try {
        const { groupId, editorId, voicing, fileUrl } = req.body;

        if (!groupId || !fileUrl) {
            return res.status(400).json({ error: 'Group ID and file URL are required' });
        }

        // Verify group exists
        const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Insert edition
        const result = await pool.query(`
            INSERT INTO editions (group_id, editor_id, voicing, file_url, created_at, updated_at) 
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
            RETURNING id
        `, [groupId, editorId || null, voicing || null, fileUrl]);

        const editionId = result.rows[0].id;

        // Get group and editor names for audit trail
        const detailsResult = await pool.query(`
            SELECT g.display_title as group_title, e.name as editor_name
            FROM groups g
            LEFT JOIN editors e ON e.id = $2
            WHERE g.id = $1
        `, [groupId, editorId || null]);
        
        const details = detailsResult.rows[0];
        const editionTitle = `${details.editor_name || 'Unknown Editor'} edition for "${details.group_title}"`;

        // Log audit entry
        try {
            await pool.query(
                `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.user?.id || null,
                    req.user?.email || 'unknown@system.local',
                    'CREATE',
                    'editions',
                    editionId,
                    null,
                    JSON.stringify({
                        id: editionId,
                        group_id: groupId,
                        group_title: details.group_title,
                        editor_id: editorId,
                        editor_name: details.editor_name,
                        voicing: voicing,
                        file_url: fileUrl
                    })
                ]
            );
        } catch (auditError) {
            console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }

        res.json({ 
            success: true, 
            editionId: editionId,
            message: 'Edition added successfully' 
        });

    } catch (error) {
        console.error('Add edition error:', error);
        res.status(500).json({ error: 'Failed to add edition' });
    }
});

// POST /api/admin/groups/recordings - Add recording to a group
router.post('/recordings', async (req, res) => {
    try {
        const { groupId, performerId, fileUrl } = req.body;

        if (!groupId || !fileUrl) {
            return res.status(400).json({ error: 'Group ID and file URL are required' });
        }

        // Verify group exists
        const groupCheck = await pool.query('SELECT id FROM groups WHERE id = $1', [groupId]);
        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Insert recording
        const result = await pool.query(`
            INSERT INTO recordings (group_id, performer_id, file_url, created_at, updated_at) 
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
            RETURNING id
        `, [groupId, performerId || null, fileUrl]);

        const recordingId = result.rows[0].id;

        // Get group and performer names for audit trail
        const detailsResult = await pool.query(`
            SELECT g.display_title as group_title, p.name as performer_name
            FROM groups g
            LEFT JOIN performers p ON p.id = $2
            WHERE g.id = $1
        `, [groupId, performerId || null]);
        
        const details = detailsResult.rows[0];
        const recordingTitle = `${details.performer_name || 'Unknown Performer'} recording for "${details.group_title}"`;

        // Log audit entry
        try {
            await pool.query(
                `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.user?.id || null,
                    req.user?.email || 'unknown@system.local',
                    'CREATE',
                    'recordings',
                    recordingId,
                    null,
                    JSON.stringify({
                        id: recordingId,
                        group_id: groupId,
                        group_title: details.group_title,
                        performer_id: performerId,
                        performer_name: details.performer_name,
                        file_url: fileUrl
                    })
                ]
            );
        } catch (auditError) {
            console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }

        res.json({ 
            success: true, 
            recordingId: recordingId,
            message: 'Recording added successfully' 
        });

    } catch (error) {
        console.error('Add recording error:', error);
        res.status(500).json({ error: 'Failed to add recording' });
    }
});

// GET /api/admin/groups/:id - Get detailed group information
router.get('/:id', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);

        // Get group basic info
        const groupResult = await pool.query(`
            SELECT id, display_title, created_at, updated_at
            FROM groups 
            WHERE id = $1
        `, [groupId]);

        if (groupResult.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const group = groupResult.rows[0];

        // Get compositions in this group
        const compositionsResult = await pool.query(`
            SELECT c.id, t.text as title, c.number_of_voices,
                   ct.name as composition_type, c.tone, c.even_odd,
                   (
                     SELECT string_agg(comp.name, ', ' ORDER BY comp.name)
                     FROM composers comp
                     WHERE comp.id = ANY(c.composer_id_list)
                   ) as composer
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            WHERE c.group_id = $1
            ORDER BY t.text
        `, [groupId]);

        // Get editions
        const editionsResult = await pool.query(`
            SELECT e.id, e.voicing, e.file_url, ed.name as editor_name
            FROM editions e
            LEFT JOIN editors ed ON e.editor_id = ed.id
            WHERE e.group_id = $1
            ORDER BY e.created_at
        `, [groupId]);

        // Get recordings
        const recordingsResult = await pool.query(`
            SELECT r.id, r.file_url, p.name as performer_name
            FROM recordings r
            LEFT JOIN performers p ON r.performer_id = p.id
            WHERE r.group_id = $1
            ORDER BY r.created_at
        `, [groupId]);

        // Get functions
        const functionsResult = await pool.query(`
            SELECT DISTINCT f.name
            FROM functions f
            JOIN functions_titles ft ON f.id = ft.function_id
            JOIN titles t ON ft.title_id = t.id
            JOIN compositions c ON c.title_id = t.id
            WHERE c.group_id = $1
            ORDER BY f.name
        `, [groupId]);

        res.json({
            ...group,
            compositions: compositionsResult.rows,
            editions: editionsResult.rows,
            recordings: recordingsResult.rows,
            functions: functionsResult.rows.map(row => row.name)
        });

    } catch (error) {
        console.error('Get group error:', error);
        res.status(500).json({ error: 'Failed to get group information' });
    }
});

// PUT /api/admin/groups/:id - Update group display title
router.put('/:id', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);
        const { display_title } = req.body;

        if (!display_title || display_title.trim().length === 0) {
            return res.status(400).json({ error: 'Display title is required' });
        }

        // Get old group data for audit trail
        const oldGroupResult = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
        if (oldGroupResult.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }
        const oldGroup = oldGroupResult.rows[0];

        // Update group
        const result = await pool.query(`
            UPDATE groups 
            SET display_title = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING id, display_title, updated_at
        `, [display_title.trim(), groupId]);

        const updatedGroup = result.rows[0];

        // Log audit entry
        try {
            await pool.query(
                `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.user?.id || null,
                    req.user?.email || 'unknown@system.local',
                    'UPDATE',
                    'groups',
                    groupId,
                    JSON.stringify({ display_title: oldGroup.display_title }),
                    JSON.stringify({ display_title: updatedGroup.display_title })
                ]
            );
        } catch (auditError) {
            console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }

        res.json({ 
            success: true, 
            group: updatedGroup,
            message: 'Group display title updated successfully' 
        });

    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({ error: 'Failed to update group' });
    }
});

// GET /api/admin/groups - Search/list groups with admin details
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            page_size = 25, 
            title = '',
            composer = '',
            voices = '',
            type = '',
            tone = '',
            even_odd = '',
            has_editions = false,
            has_recordings = false,
            sort = 'title'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(page_size);
        const limit = parseInt(page_size);

        // Build WHERE conditions
        const conditions = [];
        const params = [];
        let paramCount = 0;

        if (title.trim()) {
            paramCount++;
            conditions.push(`(
                TRANSLATE(LOWER(g.display_title), '.,;:!?"''()[]{}/-', '') ILIKE TRANSLATE(LOWER($${paramCount}), '.,;:!?"''()[]{}/-', '') OR 
                EXISTS (
                    SELECT 1 FROM compositions c2
                    JOIN titles t2 ON c2.title_id = t2.id
                    WHERE c2.group_id = g.id AND TRANSLATE(LOWER(t2.text), '.,;:!?"''()[]{}/-', '') ILIKE TRANSLATE(LOWER($${paramCount}), '.,;:!?"''()[]{}/-', '')
                )
            )`);
            params.push(`%${title.trim()}%`);
        }

        if (composer) {
            paramCount++;
            conditions.push(`$${paramCount} = ANY(c.composer_id_list)`);
            params.push(parseInt(composer));
        }

        if (voices) {
            paramCount++;
            conditions.push(`c.number_of_voices = $${paramCount}`);
            params.push(parseInt(voices));
        }

        if (type) {
            paramCount++;
            conditions.push(`c.composition_type_id = $${paramCount}`);
            params.push(parseInt(type));
        }

        if (tone) {
            paramCount++;
            conditions.push(`c.tone && ARRAY[$${paramCount}]::text[]`);
            params.push(tone);
        }

        if (even_odd) {
            paramCount++;
            conditions.push(`c.even_odd = $${paramCount}`);
            params.push(parseInt(even_odd));
        }

        if (has_editions === 'true') {
            conditions.push('EXISTS (SELECT 1 FROM editions e WHERE e.group_id = g.id)');
        }

        if (has_recordings === 'true') {
            conditions.push('EXISTS (SELECT 1 FROM recordings r WHERE r.group_id = g.id)');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Main query
        const groupsQuery = `
            SELECT DISTINCT
                g.id,
                g.display_title,
                g.created_at,
                g.updated_at,
                COUNT(DISTINCT c.id) as composition_count,
                COUNT(DISTINCT e.id) as edition_count,
                COUNT(DISTINCT r.id) as recording_count,
                c.number_of_voices,
                ct.name as composition_type,
                c.tone,
                c.even_odd,
                -- Composers for the group
                (
                  SELECT string_agg(DISTINCT comp.name, ', ' ORDER BY comp.name)
                  FROM composers comp
                  WHERE comp.id = ANY(
                    SELECT DISTINCT unnest(c2.composer_id_list)
                    FROM compositions c2
                    WHERE c2.group_id = g.id
                  )
                ) as composers
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            LEFT JOIN editions e ON e.group_id = g.id
            LEFT JOIN recordings r ON r.group_id = g.id
            ${whereClause}
            GROUP BY g.id, g.display_title, g.created_at, g.updated_at, c.number_of_voices, ct.name, c.tone, c.even_odd
            ORDER BY ${sort === 'title' ? 'g.display_title' : 'g.updated_at DESC'}
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;

        // Composition details query - using $1 since it will be called separately
        const compositionsQuery = `
            SELECT 
                c.group_id,
                json_agg(
                  json_build_object(
                    'id', c.id,
                    'title', COALESCE(t.text, 'Untitled'),
                    'composers', comp_names.composers,
                    'sources', COALESCE(source_data.sources, '[]'::json)
                  ) ORDER BY COALESCE(t.text, 'Untitled')
                ) as compositions_detail
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN (
                SELECT 
                    c2.id as composition_id,
                    string_agg(comp.name, ', ' ORDER BY comp.name) as composers
                FROM compositions c2
                LEFT JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
                GROUP BY c2.id
            ) comp_names ON comp_names.composition_id = c.id
            LEFT JOIN (
                SELECT 
                    i.composition_id,
                    json_agg(
                      json_build_object(
                        'code', s.code,
                        'position', i.position
                      ) ORDER BY s.code, i.position
                    ) as sources
                FROM inclusions i
                JOIN sources s ON i.source_id = s.id
                GROUP BY i.composition_id
            ) source_data ON source_data.composition_id = c.id
            WHERE c.group_id = ANY($1)
            GROUP BY c.group_id
        `;

        params.push(limit, offset);

        // Count query
        const countQuery = `
            SELECT COUNT(DISTINCT g.id) as total
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            LEFT JOIN editions e ON e.group_id = g.id
            LEFT JOIN recordings r ON r.group_id = g.id
            ${whereClause}
        `;

        const countParams = params.slice(0, paramCount);

        // Execute main queries
        const [groupsResult, countResult] = await Promise.all([
            pool.query(groupsQuery, params),
            pool.query(countQuery, countParams)
        ]);

        const groups = groupsResult.rows;
        const total = parseInt(countResult.rows[0].total);

        // Get composition details for the returned groups
        if (groups.length > 0) {
            const groupIds = groups.map(g => g.id);
            
            const compositionsResult = await pool.query(compositionsQuery, [groupIds]);
            
            // Create a map of group_id to compositions_detail
            const compositionsMap = {};
            compositionsResult.rows.forEach(row => {
                compositionsMap[row.group_id] = row.compositions_detail;
            });
            
            // Add composition details to each group
            groups.forEach(group => {
                group.compositions_detail = compositionsMap[group.id] || [];
            });
        }

        res.json({
            groups,
            total,
            page: parseInt(page),
            page_size: parseInt(page_size),
            total_pages: Math.ceil(total / parseInt(page_size))
        });

    } catch (error) {
        console.error('List groups error:', error);
        res.status(500).json({ error: 'Failed to list groups' });
    }
});

// DELETE /api/admin/groups/editions/:id - Remove edition
router.delete('/editions/:id', async (req, res) => {
    try {
        const editionId = parseInt(req.params.id);

        const result = await pool.query('DELETE FROM editions WHERE id = $1 RETURNING id', [editionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Edition not found' });
        }

        res.json({ success: true, message: 'Edition removed successfully' });

    } catch (error) {
        console.error('Delete edition error:', error);
        res.status(500).json({ error: 'Failed to remove edition' });
    }
});

// DELETE /api/admin/groups/recordings/:id - Remove recording
router.delete('/recordings/:id', async (req, res) => {
    try {
        const recordingId = parseInt(req.params.id);

        const result = await pool.query('DELETE FROM recordings WHERE id = $1 RETURNING id', [recordingId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json({ success: true, message: 'Recording removed successfully' });

    } catch (error) {
        console.error('Delete recording error:', error);
        res.status(500).json({ error: 'Failed to remove recording' });
    }
});

// POST /api/admin/groups/:groupId/remove-composition - Remove composition from group (splits group)
router.post('/:groupId/remove-composition', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const groupId = parseInt(req.params.groupId);
        const { compositionId, newGroupTitle } = req.body;

        if (!compositionId) {
            return res.status(400).json({ error: 'Composition ID is required' });
        }

        await client.query('BEGIN');

        // Verify composition exists and belongs to this group
        const compositionCheck = await client.query(`
            SELECT c.id, t.text as title
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            WHERE c.id = $1 AND c.group_id = $2
        `, [compositionId, groupId]);

        if (compositionCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Composition not found in this group' });
        }

        const composition = compositionCheck.rows[0];

        // Check if this is the only composition in the group
        const compositionCountResult = await client.query(`
            SELECT COUNT(*) as count
            FROM compositions
            WHERE group_id = $1
        `, [groupId]);

        const compositionCount = parseInt(compositionCountResult.rows[0].count);

        if (compositionCount <= 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Cannot remove the only composition from a group' });
        }

        // Create new group for the removed composition
        const newGroupTitleToUse = newGroupTitle?.trim() || composition.title || 'Untitled Group';
        
        const newGroupResult = await client.query(`
            INSERT INTO groups (display_title, created_at, updated_at) 
            VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
            RETURNING id
        `, [newGroupTitleToUse]);

        const newGroupId = newGroupResult.rows[0].id;

        // Move composition to new group
        await client.query(`
            UPDATE compositions 
            SET group_id = $1 
            WHERE id = $2
        `, [newGroupId, compositionId]);

        // Move any editions that might be specifically for this composition
        // (In practice, editions are usually at group level, but this handles edge cases)
        await client.query(`
            UPDATE editions 
            SET group_id = $1 
            WHERE group_id = $2 
            AND (voicing IS NULL OR voicing = '')
        `, [newGroupId, groupId]);

        // Move any recordings that might be specifically for this composition  
        await client.query(`
            UPDATE recordings 
            SET group_id = $1 
            WHERE group_id = $2
            AND id IN (
                SELECT r.id FROM recordings r
                WHERE r.group_id = $2
                LIMIT 1
            )
        `, [newGroupId, groupId]);

        await client.query('COMMIT');

        res.json({ 
            success: true, 
            newGroupId: newGroupId,
            newGroupTitle: newGroupTitleToUse,
            message: `Composition "${composition.title}" moved to new group "${newGroupTitleToUse}"` 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Remove composition error:', error);
        res.status(500).json({ error: 'Failed to remove composition from group' });
    } finally {
        client.release();
    }
});

// POST /api/admin/groups/:groupId/bulk-update-compositions - Bulk update composition properties
router.post('/:groupId/bulk-update-compositions', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const groupId = parseInt(req.params.groupId);
        const { compositionTypeId, tone, evenOdd } = req.body;

        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required' });
        }

        await client.query('BEGIN');

        // Verify group exists and get compositions
        const groupResult = await client.query(`
            SELECT g.id, g.display_title, 
                   COUNT(DISTINCT c.id) as composition_count
            FROM groups g
            LEFT JOIN compositions c ON c.group_id = g.id
            WHERE g.id = $1
            GROUP BY g.id, g.display_title
        `, [groupId]);

        if (groupResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Group not found' });
        }

        const group = groupResult.rows[0];

        if (group.composition_count === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No compositions found in this group' });
        }

        // Get compositions in this group before update
        const compositionsBeforeResult = await client.query(`
            SELECT c.id, c.title_id, c.composition_type_id, c.tone, c.even_odd, 
                   c.number_of_voices, c.composer_id_list, c.group_id,
                   t.text as title
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            WHERE c.group_id = $1
            ORDER BY t.text
        `, [groupId]);

        const compositionsBefore = compositionsBeforeResult.rows;

        // Check if any properties are being updated (including explicit null for removal)
        const hasUpdates = (compositionTypeId !== undefined) ||
                          (tone !== undefined) ||
                          (evenOdd !== undefined);

        if (!hasUpdates) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No properties to update were provided' });
        }

        const now = new Date();
        const results = {
            updated: [],
            merged: [],
            errors: []
        };

        // Process each composition individually
        for (const composition of compositionsBefore) {
            try {
                // Calculate new properties for this composition
                const newCompositionTypeId = compositionTypeId !== undefined ? 
                    (compositionTypeId ? parseInt(compositionTypeId) : null) : composition.composition_type_id;
                const newTone = tone !== undefined ? 
                    (tone ? [tone] : null) : composition.tone;
                const newEvenOdd = evenOdd !== undefined ? 
                    (evenOdd !== null ? parseInt(evenOdd) : null) : composition.even_odd;

                const isAnonymous = composition.composer_id_list && 
                    composition.composer_id_list.length === 1 && 
                    composition.composer_id_list[0] === 23;

                if (isAnonymous) {
                    const updateResult = await client.query(`
                        UPDATE compositions 
                        SET composition_type_id = $1, tone = $2, even_odd = $3, updated_at = $4
                        WHERE id = $5
                        RETURNING id
                    `, [newCompositionTypeId, newTone, newEvenOdd, now, composition.id]);

                    if (updateResult.rowCount > 0) {
                        results.updated.push({
                            compositionId: composition.id,
                            title: composition.title,
                            action: 'updated_in_place',
                            oldProperties: {
                                composition_type_id: composition.composition_type_id,
                                tone: composition.tone,
                                even_odd: composition.even_odd
                            },
                            newProperties: {
                                composition_type_id: newCompositionTypeId,
                                tone: newTone,
                                even_odd: newEvenOdd
                            }
                        });
                    }
                } else {
                    // For non-anonymous compositions, check if a composition with these properties exists
                    const existingCompositionResult = await client.query(`
                        SELECT id, group_id FROM compositions 
                        WHERE title_id = $1 
                        AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
                        AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
                        AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
                        AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
                        AND composer_id_list = $6
                        AND id != $7
                    `, [
                        composition.title_id,
                        newCompositionTypeId,
                        newTone,
                        newEvenOdd,
                        composition.number_of_voices,
                        composition.composer_id_list,
                        composition.id
                    ]);

                    if (existingCompositionResult.rows.length > 0) {
                        // Found existing composition - merge by reassigning inclusions
                        const existingComposition = existingCompositionResult.rows[0];
                        
                        // Get all inclusions currently pointing to the old composition
                        const inclusionsResult = await client.query(`
                            SELECT id FROM inclusions WHERE composition_id = $1
                        `, [composition.id]);

                        // Reassign all inclusions to the existing composition
                        await client.query(`
                            UPDATE inclusions 
                            SET composition_id = $1, updated_at = $2
                            WHERE composition_id = $3
                        `, [existingComposition.id, now, composition.id]);

                        // The old composition will be orphaned and cleaned up later
                        results.merged.push({
                            oldCompositionId: composition.id,
                            newCompositionId: existingComposition.id,
                            title: composition.title,
                            action: 'merged_to_existing',
                            inclusionCount: inclusionsResult.rows.length,
                            newProperties: {
                                composition_type_id: newCompositionTypeId,
                                tone: newTone,
                                even_odd: newEvenOdd
                            }
                        });
                    } else {
                        // No existing composition found - update in place
                        const updateResult = await client.query(`
                            UPDATE compositions 
                            SET composition_type_id = $1, tone = $2, even_odd = $3, updated_at = $4
                            WHERE id = $5
                            RETURNING id
                        `, [newCompositionTypeId, newTone, newEvenOdd, now, composition.id]);

                        if (updateResult.rowCount > 0) {
                            results.updated.push({
                                compositionId: composition.id,
                                title: composition.title,
                                action: 'updated_in_place',
                                oldProperties: {
                                    composition_type_id: composition.composition_type_id,
                                    tone: composition.tone,
                                    even_odd: composition.even_odd
                                },
                                newProperties: {
                                    composition_type_id: newCompositionTypeId,
                                    tone: newTone,
                                    even_odd: newEvenOdd
                                }
                            });
                        }
                    }
                }

            } catch (error) {
                console.error(`Error processing composition ${composition.id}:`, error);
                results.errors.push({
                    compositionId: composition.id,
                    title: composition.title,
                    error: error.message
                });
            }
        }

        // Get updated compositions for audit trail
        const compositionsAfterResult = await client.query(`
            SELECT c.id, t.text as title, ct.name as composition_type, c.tone, c.even_odd
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            WHERE c.group_id = $1
            ORDER BY t.text
        `, [groupId]);

        const compositionsAfter = compositionsAfterResult.rows;

        await client.query('COMMIT');

        // Import cleanup function and trigger it
        const { triggerCleanup } = await import('../cleanup.js');
        
        // Trigger cleanup after bulk operations (async, with delay to ensure all operations complete)
        if (results.merged.length > 0) {
            triggerCleanup(true, 'all', 'after bulk composition update', 3000);
        }

        // Log audit entry
        try {
            await pool.query(
                `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
                [
                    req.user?.id || null,
                    req.user?.email || 'unknown@system.local',
                    'BULK_UPDATE',
                    'compositions',
                    groupId,
                    JSON.stringify({ 
                        group_title: group.display_title,
                        compositions_before: compositionsBefore.map(c => ({
                            id: c.id,
                            title: c.title,
                            composition_type_id: c.composition_type_id,
                            tone: c.tone,
                            even_odd: c.even_odd
                        })),
                        update_parameters: { compositionTypeId, tone, evenOdd }
                    }),
                    JSON.stringify({ 
                        group_title: group.display_title,
                        compositions_after: compositionsAfter,
                        results: results
                    })
                ]
            );
        } catch (auditError) {
            console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }

        const totalProcessed = results.updated.length + results.merged.length;
        const messageDetails = [];
        if (results.updated.length > 0) messageDetails.push(`${results.updated.length} updated`);
        if (results.merged.length > 0) messageDetails.push(`${results.merged.length} merged to existing compositions`);
        if (results.errors.length > 0) messageDetails.push(`${results.errors.length} errors`);

        res.json({ 
            success: true,
            message: `Successfully processed ${totalProcessed} composition${totalProcessed !== 1 ? 's' : ''} in group "${group.display_title}" (${messageDetails.join(', ')})`,
            groupTitle: group.display_title,
            results: results,
            compositionsBefore: compositionsBefore,
            compositionsAfter: compositionsAfter
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk update compositions error:', error);
        res.status(500).json({ error: 'Failed to bulk update composition properties' });
    } finally {
        client.release();
    }
});

// GET /api/admin/groups/:id/compositions - Get compositions for group splitting
router.get('/:id/compositions', async (req, res) => {
    try {
        const groupId = parseInt(req.params.id);

        const result = await pool.query(`
            SELECT 
                c.id,
                t.text as title,
                c.number_of_voices,
                ct.name as composition_type,
                c.tone,
                c.even_odd,
                (
                  SELECT string_agg(comp.name, ', ' ORDER BY comp.name)
                  FROM composers comp
                  WHERE comp.id = ANY(c.composer_id_list)
                ) as composers,
                (
                  SELECT COUNT(*)
                  FROM inclusions i
                  WHERE i.composition_id = c.id
                ) as inclusion_count
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            WHERE c.group_id = $1
            ORDER BY t.text
        `, [groupId]);

        res.json(result.rows);

    } catch (error) {
        console.error('Get group compositions error:', error);
        res.status(500).json({ error: 'Failed to get group compositions' });
    }
});

// POST /api/admin/groups/bulk-update-titles - Bulk update display titles for multiple groups
router.post('/bulk-update-titles', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { groupIds, displayTitle } = req.body;

        if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'Group IDs array is required' });
        }

        if (!displayTitle || displayTitle.trim() === '') {
            return res.status(400).json({ error: 'Display title is required' });
        }

        await client.query('BEGIN');

        // Verify all groups exist
        const placeholders = groupIds.map((_, index) => `$${index + 1}`).join(',');
        const groupsResult = await client.query(`
            SELECT id, display_title 
            FROM groups 
            WHERE id IN (${placeholders})
        `, groupIds);

        if (groupsResult.rows.length !== groupIds.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'One or more groups not found' });
        }

        const now = new Date();

        // Update all group titles
        const updateResult = await client.query(`
            UPDATE groups 
            SET display_title = $1, updated_at = $2
            WHERE id IN (${placeholders})
            RETURNING id, display_title
        `, [displayTitle.trim(), now, ...groupIds]);

        await client.query('COMMIT');

        res.json({
            message: `Successfully updated display title for ${updateResult.rowCount} groups to "${displayTitle.trim()}".`,
            updated_groups: updateResult.rows
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk update titles error:', error);
        res.status(500).json({ error: 'Failed to update group titles' });
    } finally {
        client.release();
    }
});

// POST /api/admin/groups/bulk-update-compositions - Bulk update composition properties for multiple groups
router.post('/bulk-update-compositions', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { groupIds, compositionTypeId, tone, evenOdd } = req.body;

        if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'Group IDs array is required' });
        }

        // Check if any properties are being updated (including explicit null for removal)
        const hasUpdates = (compositionTypeId !== undefined) ||
                          (tone !== undefined) ||
                          (evenOdd !== undefined);

        if (!hasUpdates) {
            return res.status(400).json({ error: 'No properties to update were provided' });
        }

        await client.query('BEGIN');

        // Verify all groups exist and get composition count
        const placeholders = groupIds.map((_, index) => `$${index + 1}`).join(',');
        const groupsResult = await client.query(`
            SELECT g.id, g.display_title, 
                   COUNT(DISTINCT c.id) as composition_count
            FROM groups g
            LEFT JOIN compositions c ON c.group_id = g.id
            WHERE g.id IN (${placeholders})
            GROUP BY g.id, g.display_title
        `, groupIds);

        if (groupsResult.rows.length !== groupIds.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'One or more groups not found' });
        }

        const totalCompositions = groupsResult.rows.reduce((sum, group) => sum + parseInt(group.composition_count), 0);

        if (totalCompositions === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No compositions found in selected groups' });
        }

        // Get all compositions in these groups
        const compositionsResult = await client.query(`
            SELECT c.id, c.title_id, c.composition_type_id, c.tone, c.even_odd, 
                   c.number_of_voices, c.composer_id_list, c.group_id,
                   t.text as title,
                   g.display_title as group_title
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN groups g ON c.group_id = g.id
            WHERE c.group_id IN (${placeholders})
            ORDER BY g.display_title, t.text
        `, groupIds);

        const compositions = compositionsResult.rows;
        const now = new Date();
        let updatedCount = 0;
        let mergedCount = 0;
        const results = {
            updated: [],
            merged: [],
            errors: []
        };

        // Process each composition individually
        for (const composition of compositions) {
            try {
                // Calculate new properties for this composition
                const newCompositionTypeId = compositionTypeId !== undefined ? 
                    (compositionTypeId ? parseInt(compositionTypeId) : null) : composition.composition_type_id;
                const newTone = tone !== undefined ? 
                    (tone ? [tone] : null) : composition.tone;
                const newEvenOdd = evenOdd !== undefined ? 
                    (evenOdd !== null ? parseInt(evenOdd) : null) : composition.even_odd;

                const isAnonymous = composition.composer_id_list && 
                    composition.composer_id_list.length === 1 && 
                    composition.composer_id_list[0] === 23;

                if (isAnonymous) {
                    // For anonymous compositions, always update in place
                    const updateResult = await client.query(`
                        UPDATE compositions 
                        SET composition_type_id = $1, tone = $2, even_odd = $3, updated_at = $4
                        WHERE id = $5
                        RETURNING id
                    `, [newCompositionTypeId, newTone, newEvenOdd, now, composition.id]);

                    if (updateResult.rowCount > 0) {
                        updatedCount++;
                        results.updated.push({
                            compositionId: composition.id,
                            title: composition.title,
                            groupTitle: composition.group_title,
                            action: 'updated_in_place'
                        });
                    }
                } else {
                    // For non-anonymous compositions, check if a composition with these properties exists
                    const existingCompositionResult = await client.query(`
                        SELECT id, group_id FROM compositions 
                        WHERE title_id = $1 
                        AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
                        AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
                        AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
                        AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
                        AND composer_id_list = $6
                        AND id != $7
                    `, [
                        composition.title_id,
                        newCompositionTypeId,
                        newTone,
                        newEvenOdd,
                        composition.number_of_voices,
                        composition.composer_id_list,
                        composition.id
                    ]);

                    if (existingCompositionResult.rows.length > 0) {
                        // Found existing composition - merge by reassigning inclusions
                        const existingComposition = existingCompositionResult.rows[0];
                        
                        // Get all inclusions currently pointing to the old composition
                        const inclusionsResult = await client.query(`
                            SELECT id FROM inclusions WHERE composition_id = $1
                        `, [composition.id]);

                        // Reassign all inclusions to the existing composition
                        await client.query(`
                            UPDATE inclusions 
                            SET composition_id = $1, updated_at = $2
                            WHERE composition_id = $3
                        `, [existingComposition.id, now, composition.id]);

                        mergedCount++;
                        results.merged.push({
                            oldCompositionId: composition.id,
                            newCompositionId: existingComposition.id,
                            title: composition.title,
                            groupTitle: composition.group_title,
                            inclusionCount: inclusionsResult.rows.length
                        });
                    } else {
                        // No existing composition found - update in place
                        const updateResult = await client.query(`
                            UPDATE compositions 
                            SET composition_type_id = $1, tone = $2, even_odd = $3, updated_at = $4
                            WHERE id = $5
                            RETURNING id
                        `, [newCompositionTypeId, newTone, newEvenOdd, now, composition.id]);

                        if (updateResult.rowCount > 0) {
                            updatedCount++;
                            results.updated.push({
                                compositionId: composition.id,
                                title: composition.title,
                                groupTitle: composition.group_title,
                                action: 'updated_in_place'
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing composition ${composition.id}:`, error);
                results.errors.push({
                    compositionId: composition.id,
                    title: composition.title,
                    error: error.message
                });
            }
        }

        await client.query('COMMIT');

        let message = `Bulk update completed for ${groupIds.length} groups:\n`;
        message += `• ${updatedCount} compositions updated\n`;
        if (mergedCount > 0) {
            message += `• ${mergedCount} compositions merged with existing entries\n`;
        }
        if (results.errors.length > 0) {
            message += `• ${results.errors.length} errors occurred`;
        }

        res.json({
            message: message,
            summary: {
                groupsProcessed: groupIds.length,
                compositionsProcessed: compositions.length,
                updated: updatedCount,
                merged: mergedCount,
                errors: results.errors.length
            },
            details: results
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk update compositions error:', error);
        res.status(500).json({ error: 'Failed to update composition properties' });
    } finally {
        client.release();
    }
});

export default router; 