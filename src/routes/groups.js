import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

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
                   COUNT(DISTINCT c.voices) as voice_variations,
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
            SELECT COUNT(DISTINCT c.voices) as voice_variations,
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
            INSERT INTO groups (display_title) 
            VALUES ($1) 
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

        // Delete the old groups
        await client.query(`
            DELETE FROM groups 
            WHERE id = ANY($1)
        `, [groupIds]);

        await client.query('COMMIT');

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
            INSERT INTO editions (group_id, editor_id, voicing, file_url) 
            VALUES ($1, $2, $3, $4) 
            RETURNING id
        `, [groupId, editorId || null, voicing || null, fileUrl]);

        res.json({ 
            success: true, 
            editionId: result.rows[0].id,
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
            INSERT INTO recordings (group_id, performer_id, file_url) 
            VALUES ($1, $2, $3) 
            RETURNING id
        `, [groupId, performerId || null, fileUrl]);

        res.json({ 
            success: true, 
            recordingId: result.rows[0].id,
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
            SELECT c.id, t.text as title, comp.name as composer, c.voices,
                   ct.name as composition_type, c.tone, c.even_odd
            FROM compositions c
            LEFT JOIN titles t ON c.title_id = t.id
            LEFT JOIN composers comp ON c.composer_id = comp.id
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
            JOIN composition_functions cf ON cf.function_id = f.id
            JOIN compositions c ON c.id = cf.composition_id
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

// GET /api/admin/groups - Search/list groups with admin details
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            page_size = 25, 
            title = '',
            composer = '',
            voices = '',
            has_editions = false,
            has_recordings = false
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(page_size);
        const limit = parseInt(page_size);

        // Build WHERE conditions
        const conditions = [];
        const params = [];
        let paramCount = 0;

        if (title.trim()) {
            paramCount++;
            conditions.push(`g.display_title ILIKE $${paramCount}`);
            params.push(`%${title.trim()}%`);
        }

        if (composer) {
            paramCount++;
            conditions.push(`c.composer_id = $${paramCount}`);
            params.push(parseInt(composer));
        }

        if (voices) {
            paramCount++;
            conditions.push(`c.voices = $${paramCount}`);
            params.push(parseInt(voices));
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
                c.voices,
                ct.name as composition_type,
                -- Simplified composer logic for admin view
                STRING_AGG(DISTINCT comp.name, ', ') as composers
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            LEFT JOIN composers comp ON c.composer_id = comp.id
            LEFT JOIN editions e ON e.group_id = g.id
            LEFT JOIN recordings r ON r.group_id = g.id
            ${whereClause}
            GROUP BY g.id, g.display_title, g.created_at, g.updated_at, c.voices, ct.name
            ORDER BY g.updated_at DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;

        params.push(limit, offset);

        // Count query
        const countQuery = `
            SELECT COUNT(DISTINCT g.id) as total
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            LEFT JOIN composers comp ON c.composer_id = comp.id
            LEFT JOIN editions e ON e.group_id = g.id
            LEFT JOIN recordings r ON r.group_id = g.id
            ${whereClause}
        `;

        const countParams = params.slice(0, paramCount);

        // Execute queries
        const [groupsResult, countResult] = await Promise.all([
            pool.query(groupsQuery, params),
            pool.query(countQuery, countParams)
        ]);

        const groups = groupsResult.rows;
        const total = parseInt(countResult.rows[0].total);

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

export default router; 