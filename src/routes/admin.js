import express from 'express';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { runDatabaseCleanup } from '../cleanup.js';

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(requireAdmin);

// Get all clef combinations
router.get('/clef-combinations', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT id, clef_combination
      FROM clef_combinations
      ORDER BY clef_combination
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clef combinations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all clef combination to voicing mappings
router.get('/clef-voicing-mappings', async (req, res) => {
  try {
    const query = `
      SELECT clef_combination_id, voicing_id
      FROM clef_combinations_voicings
      ORDER BY clef_combination_id, voicing_id
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching clef-voicing mappings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a clef combination to voicing mapping
router.post('/clef-voicing-mappings', async (req, res) => {
  try {
    const { clef_combination_id, voicing_id } = req.body;

    if (!clef_combination_id || !voicing_id) {
      return res.status(400).json({ error: 'clef_combination_id and voicing_id are required' });
    }

    // Try INSERT with ON CONFLICT first (if constraint exists)
    try {
      const insertQuery = `
        INSERT INTO clef_combinations_voicings (clef_combination_id, voicing_id)
        VALUES ($1, $2)
        ON CONFLICT (clef_combination_id, voicing_id) DO NOTHING
      `;
      
      await pool.query(insertQuery, [clef_combination_id, voicing_id]);
      res.json({ success: true, message: 'Mapping added successfully' });
      return;
    } catch (conflictError) {
      // If ON CONFLICT fails (no constraint), fall back to manual check
      console.log('ON CONFLICT failed, using manual duplicate check:', conflictError.message);
    }

    // Fallback: Check if mapping already exists manually
    const checkQuery = `
      SELECT 1 FROM clef_combinations_voicings 
      WHERE clef_combination_id = $1 AND voicing_id = $2
    `;
    const checkResult = await pool.query(checkQuery, [clef_combination_id, voicing_id]);
    
    if (checkResult.rows.length > 0) {
      return res.json({ success: true, message: 'Mapping already exists' });
    }

    const insertQuery = `
      INSERT INTO clef_combinations_voicings (clef_combination_id, voicing_id, created_at, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    
    await pool.query(insertQuery, [clef_combination_id, voicing_id]);
    res.json({ success: true, message: 'Mapping added successfully' });
  } catch (error) {
    console.error('Error adding clef-voicing mapping:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a clef combination to voicing mapping
router.delete('/clef-voicing-mappings', async (req, res) => {
  try {
    const { clef_combination_id, voicing_id } = req.body;

    if (!clef_combination_id || !voicing_id) {
      return res.status(400).json({ error: 'clef_combination_id and voicing_id are required' });
    }

    const query = `
      DELETE FROM clef_combinations_voicings
      WHERE clef_combination_id = $1 AND voicing_id = $2
    `;
    
    const result = await pool.query(query, [clef_combination_id, voicing_id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Mapping not found' });
    }

    res.json({ success: true, message: 'Mapping removed successfully' });
  } catch (error) {
    console.error('Error removing clef-voicing mapping:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new voicing
router.post('/voicings', async (req, res) => {
  try {
    const { voicing } = req.body;

    if (!voicing || !voicing.trim()) {
      return res.status(400).json({ error: 'voicing is required' });
    }

    const trimmedVoicing = voicing.trim();

    // Check if voicing already exists
    const checkQuery = 'SELECT id FROM voicings WHERE voicing = $1';
    const checkResult = await pool.query(checkQuery, [trimmedVoicing]);
    
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ error: 'Voicing already exists' });
    }

    const insertQuery = `
      INSERT INTO voicings (voicing, created_at, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, voicing
    `;
    
    const result = await pool.query(insertQuery, [trimmedVoicing]);
    res.json({ 
      success: true, 
      message: 'Voicing added successfully',
      voicing: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding voicing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new clef combination (will be auto-populated by source editor, but also manual admin option)
router.post('/clef-combinations', async (req, res) => {
  try {
    const { clef_combination } = req.body;

    if (!clef_combination || !clef_combination.trim()) {
      return res.status(400).json({ error: 'clef_combination is required' });
    }

    const trimmedClefCombo = clef_combination.trim();

    // Define clef display order for sorting and validation
    const clefDisplayOrder = [
      'g1', 'g2', 'g3', 'c1', 'g4', 'c2', 'g5', 'c3', 'f1', 'g28', 'c4', 'f2', 'c5', 'd1', 'f3', 'd2', 'f4', 'd3', 'y1', 'f5', 'd4', 'y2', 'd5', 'y3', 'y4', 'y5', 'x1', 'x2', 'x3', 'x4', 'x5', 'org', 'bc', 'lut'
    ];

    // Parse and validate individual clefs
    const clefArray = trimmedClefCombo.match(/(g[0-9]+|g28|c[0-9]+|f[0-9]+|x[0-9]+|y[0-9]+|d[0-9]+|lut|org|bc)/g) || [];
    
    if (clefArray.length === 0) {
      return res.status(400).json({ error: 'No valid clefs found in combination' });
    }

    // Validate each clef exists in our valid list
    for (const clef of clefArray) {
      if (!clefDisplayOrder.includes(clef)) {
        return res.status(400).json({ error: `Invalid clef: ${clef}` });
      }
    }

    // Sort clefs according to display order to ensure consistency
    const sortedClefs = clefArray.sort((a, b) => {
      const aIndex = clefDisplayOrder.indexOf(a);
      const bIndex = clefDisplayOrder.indexOf(b);
      return aIndex - bIndex;
    });

    const sortedClefCombo = sortedClefs.join('');

    // Check if clef combination already exists (use sorted version)
    const checkQuery = 'SELECT id FROM clef_combinations WHERE clef_combination = $1';
    const checkResult = await pool.query(checkQuery, [sortedClefCombo]);
    
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ error: 'Clef combination already exists' });
    }

    const insertQuery = `
      INSERT INTO clef_combinations (clef_combination, created_at, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, clef_combination
    `;
    
    const result = await pool.query(insertQuery, [sortedClefCombo]);
    res.json({ 
      success: true, 
      message: 'Clef combination added successfully',
      clef_combination: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding clef combination:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check recent user registrations
router.get('/recent-users', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const recentUsers = await pool.query(`
      SELECT 
        id,
        email,
        name,
        status,
        role,
        created_at,
        updated_at
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    
    res.json({
      success: true,
      users: recentUsers.rows,
      count: recentUsers.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching recent users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent activity/audit trail from audit_log table
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // Check if audit_log table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'audit_log'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      // Fallback to legacy activity tracking if audit_log doesn't exist
      const legacyActivity = await pool.query(`
        SELECT 'source' as type, 'CREATE' as action, id, 
               COALESCE(code, 'Untitled Source') as title, 
               'Unknown User' as user_email,
               COALESCE(created_at, updated_at, NOW()) as created_at
        FROM sources 
        WHERE (created_at >= NOW() - INTERVAL '30 days' 
               OR updated_at >= NOW() - INTERVAL '30 days')
        ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
        LIMIT $1
      `, [limit]);
      
      return res.json({ activity: legacyActivity.rows });
    }
    
    // Check if audit_log table has the expected structure
    const tableStructure = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'audit_log' 
      ORDER BY ordinal_position
    `);
    
    if (tableStructure.rows.length === 0) {
      // Fallback to legacy activity tracking if audit_log doesn't exist
      const legacyActivity = await pool.query(`
        SELECT 'source' as type, 'CREATE' as action, id, 
               COALESCE(code, 'Untitled Source') as title, 
               'Unknown User' as user_email,
               COALESCE(created_at, updated_at, NOW()) as created_at
        FROM sources 
        WHERE (created_at >= NOW() - INTERVAL '30 days' 
               OR updated_at >= NOW() - INTERVAL '30 days')
        ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
        LIMIT $1
      `, [limit]);
      
      return res.json({ activity: legacyActivity.rows });
    }
    
    // Check if the table has the changes column
    const hasChangesColumn = tableStructure.rows.some(col => col.column_name === 'changes');
    
    if (!hasChangesColumn) {
      // Fallback to basic audit log query without enhanced record titles
      const auditActivity = await pool.query(`
        SELECT 
          al.user_email,
          al.action,
          al.table_name,
          al.record_title,
          al.created_at
        FROM audit_log al
        WHERE al.created_at >= NOW() - INTERVAL '30 days'
        ORDER BY al.created_at DESC
        LIMIT $1
      `, [limit]);
      
      return res.json({ activity: auditActivity.rows });
    }
    
    // Get simplified audit log entries with enhanced record titles
    const auditActivity = await pool.query(`
      SELECT 
        al.user_email,
        al.action,
        al.table_name,
        al.record_id,
        CASE 
          WHEN al.record_title IS NOT NULL AND al.record_title != '' AND al.record_title NOT LIKE 'Untitled %' THEN al.record_title
          WHEN al.table_name = 'titles' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'text' THEN al.changes->'new'->>'text'
          WHEN al.table_name = 'sources' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'code' THEN al.changes->'new'->>'code'
          WHEN al.table_name = 'groups' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'display_title' THEN al.changes->'new'->>'display_title'
          WHEN al.table_name = 'composers' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'name' THEN al.changes->'new'->>'name'
          WHEN al.table_name = 'editors' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'name' THEN al.changes->'new'->>'name'
          WHEN al.table_name = 'performers' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'name' THEN al.changes->'new'->>'name'
          WHEN al.table_name = 'functions' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'name' THEN al.changes->'new'->>'name'
          WHEN al.table_name = 'functions_titles' AND al.changes::jsonb ? 'new' AND al.changes->'new' ? 'title_text' THEN al.changes->'new'->>'title_text'
          WHEN al.table_name = 'inclusions' AND al.changes::jsonb ? 'old' AND al.changes->'old' ? 'composition_title' THEN al.changes->'old'->>'composition_title'
          -- Fallback: try to lookup the actual source code from database for sources
          WHEN al.table_name = 'sources' AND al.record_id IS NOT NULL THEN (
            SELECT COALESCE(s.code, 'Source #' || s.id)
            FROM sources s 
            WHERE s.id = al.record_id
          )
          ELSE 'Unknown Record'
        END as record_title,
        al.changes,
        al.created_at
      FROM audit_log al
      WHERE al.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY al.created_at DESC
      LIMIT $1
    `, [limit]);
    
    // If no audit log entries, fall back to recent user registrations and other activity
    if (auditActivity.rows.length === 0) {
      // Get recent user registrations
      const recentUsers = await pool.query(`
        SELECT 
          email as user_email,
          'CREATE' as action,
          'users' as table_name,
          name as record_title,
          created_at
        FROM users 
        WHERE created_at >= NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      
      return res.json({ activity: recentUsers.rows });
    }

    res.json({ activity: auditActivity.rows });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific problematic records for data quality alerts
router.get('/data-quality-records/:alertType', async (req, res) => {
  try {
    const { alertType } = req.params;
    const { limit = 100 } = req.query;
    
    let query = '';
    let records = [];
    
    switch (alertType) {
      case 'functions_no_titles':
        query = `
          SELECT f.id, f.name as title, 'functions' as table_name
          FROM functions f
          WHERE f.id NOT IN (SELECT DISTINCT function_id FROM functions_titles WHERE function_id IS NOT NULL)
          AND f.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'functions_no_titles' AND entity_type = 'functions'
          )
          ORDER BY f.name
          LIMIT $1
        `;
        break;
        
      case 'titles_no_functions':
        query = `
          SELECT t.id, t.text as title, 'titles' as table_name
          FROM titles t
          WHERE t.id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
          AND t.id IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
          AND t.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'titles_no_functions' AND entity_type = 'titles'
          )
          ORDER BY t.text
          LIMIT $1
        `;
        break;
        
      case 'groups_title_mismatch':
        query = `
          SELECT g.id, g.display_title as title, 'groups' as table_name,
                 STRING_AGG(DISTINCT t.text, ', ') as composition_titles
          FROM groups g
          LEFT JOIN compositions c ON c.group_id = g.id
          LEFT JOIN titles t ON c.title_id = t.id
          WHERE g.display_title NOT IN (
            SELECT DISTINCT t2.text
            FROM compositions c2
            JOIN titles t2 ON c2.title_id = t2.id
            WHERE c2.group_id = g.id
          )
          AND EXISTS (SELECT 1 FROM compositions c3 WHERE c3.group_id = g.id)
          AND g.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'groups_title_mismatch' AND entity_type = 'groups'
          )
          GROUP BY g.id, g.display_title
          ORDER BY g.display_title
          LIMIT $1
        `;
        break;
        
      case 'clef_combos_no_voicings':
        query = `
          SELECT cc.id, cc.clef_combination as title, 'clef_combinations' as table_name
          FROM clef_combinations cc
          LEFT JOIN clef_combinations_voicings ccv ON cc.id = ccv.clef_combination_id
          WHERE ccv.clef_combination_id IS NULL
          AND cc.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'clef_combos_no_voicings' AND entity_type = 'clef_combinations'
          )
          ORDER BY cc.clef_combination
          LIMIT $1
        `;
        break;
        
      case 'titles_no_language':
        query = `
          SELECT t.id, t.text as title, 'titles' as table_name
          FROM titles t
          WHERE t.language IS NULL
          AND t.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'titles_no_language' AND entity_type = 'titles'
          )
          ORDER BY t.text
          LIMIT $1
        `;
        break;
        
      case 'composers_missing_data':
        query = `
          SELECT c.id, c.name as title, 'composers' as table_name
          FROM composers c
          WHERE (c.from_year IS NULL OR c.to_year IS NULL OR c.birthplace_2 IS NULL OR c.birthplace_2 = '')
          AND c.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'composers_missing_data' AND entity_type = 'composers'
          )
          ORDER BY c.name
          LIMIT $1
        `;
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid alert type' });
    }
    
    const result = await pool.query(query, [limit]);
    records = result.rows;
    
    res.json({ records, alertType });
  } catch (error) {
    console.error('Error fetching data quality records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/data-quality-groups-for-correction - Get groups for title mismatch correction
router.get('/data-quality-groups-for-correction', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    const query = `
      SELECT 
        g.id, 
        g.display_title,
        COUNT(DISTINCT c.id) as composition_count,
        COUNT(DISTINCT t.text) as unique_title_count,
        (
          SELECT jsonb_agg(
            DISTINCT jsonb_build_object(
              'id', c2.id,
              'title', t2.text,
              'composers', (
                SELECT string_agg(comp.name, ', ' ORDER BY comp.name)
                FROM composers comp
                WHERE comp.id = ANY(c2.composer_id_list)
              )
            )
          )
          FROM compositions c2
          LEFT JOIN titles t2 ON c2.title_id = t2.id
          WHERE c2.group_id = g.id
        ) as compositions,
        (
          SELECT t3.text
          FROM compositions c3
          LEFT JOIN titles t3 ON c3.title_id = t3.id
          WHERE c3.group_id = g.id
          LIMIT 1
        ) as common_title
      FROM groups g
      LEFT JOIN compositions c ON c.group_id = g.id
      LEFT JOIN titles t ON c.title_id = t.id
      WHERE g.display_title NOT IN (
        SELECT DISTINCT t2.text
        FROM compositions c2
        JOIN titles t2 ON c2.title_id = t2.id
        WHERE c2.group_id = g.id
      )
      AND EXISTS (SELECT 1 FROM compositions c3 WHERE c3.group_id = g.id)
      AND g.id NOT IN (
        SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
        WHERE alert_type = 'groups_title_mismatch' AND entity_type = 'groups'
      )
      GROUP BY g.id, g.display_title
      ORDER BY g.display_title
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    
    // Process the results to add correction flags
    const processedResults = result.rows.map(row => ({
      ...row,
      can_auto_correct: (row.composition_count === 1) || 
                       (row.composition_count > 1 && row.unique_title_count === 1),
      suggested_title: ((row.composition_count === 1) || 
                       (row.composition_count > 1 && row.unique_title_count === 1)) 
                       ? row.common_title : null
    }));

    res.json(processedResults);
  } catch (error) {
    console.error('Error fetching groups for correction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/groups/bulk-title-correction - Apply bulk title corrections
router.post('/groups/bulk-title-correction', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { groupIds } = req.body;

    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({ error: 'Group IDs array is required' });
    }

    await client.query('BEGIN');

    const corrections = [];
    const errors = [];

    for (const groupId of groupIds) {
      try {
        // Get the group and verify it has either:
        // 1. Exactly one composition, OR
        // 2. Multiple compositions that all have the same title
        const groupResult = await client.query(`
          SELECT 
            g.id, 
            g.display_title,
            COUNT(DISTINCT c.id) as composition_count,
            COUNT(DISTINCT t.text) as unique_title_count,
            t.text as composition_title
          FROM groups g
          LEFT JOIN compositions c ON c.group_id = g.id
          LEFT JOIN titles t ON c.title_id = t.id
          WHERE g.id = $1
          GROUP BY g.id, g.display_title, t.text
          HAVING COUNT(DISTINCT c.id) >= 1 AND COUNT(DISTINCT t.text) = 1
        `, [groupId]);

        if (groupResult.rows.length === 0) {
          errors.push(`Group ${groupId}: Not found, has no compositions, or compositions have different titles`);
          continue;
        }

        const group = groupResult.rows[0];
        const oldTitle = group.display_title;
        const newTitle = group.composition_title;

        if (!newTitle) {
          errors.push(`Group ${groupId}: Composition has no title`);
          continue;
        }

        if (oldTitle === newTitle) {
          errors.push(`Group ${groupId}: Display title already matches composition title`);
          continue;
        }

        // Update the group display title
        const updateResult = await client.query(`
          UPDATE groups 
          SET display_title = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2 
          RETURNING id, display_title
        `, [newTitle.trim(), groupId]);

        if (updateResult.rowCount > 0) {
          corrections.push({
            groupId: groupId,
            oldTitle: oldTitle,
            newTitle: newTitle.trim()
          });
        } else {
          errors.push(`Group ${groupId}: Failed to update`);
        }

      } catch (error) {
        console.error(`Error processing group ${groupId}:`, error);
        errors.push(`Group ${groupId}: ${error.message}`);
      }
    }

    await client.query('COMMIT');

    // Log audit entry for successful corrections
    if (corrections.length > 0) {
      try {
        await pool.query(
          `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.user?.id || null,
            req.user?.email || 'unknown@system.local',
            'BULK_UPDATE',
            'groups',
            null, // No specific ID since it's multiple groups
            JSON.stringify({ 
              action: 'bulk_title_correction',
              corrections_before: corrections.map(c => ({ groupId: c.groupId, oldTitle: c.oldTitle }))
            }),
            JSON.stringify({ 
              action: 'bulk_title_correction',
              corrections_after: corrections,
              corrected_count: corrections.length
            })
          ]
        );
      } catch (auditError) {
        console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
      }
    }

    res.json({ 
      success: true,
      message: `Successfully corrected ${corrections.length} group title${corrections.length !== 1 ? 's' : ''}`,
      corrections: corrections,
      errors: errors,
      correctedCount: corrections.length,
      errorCount: errors.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bulk title correction error:', error);
    res.status(500).json({ error: 'Failed to apply bulk title corrections' });
  } finally {
    client.release();
  }
});

// Get data quality alerts (filtered by ignored alerts)
router.get('/data-quality-alerts', async (req, res) => {
  try {
    const alerts = [];

    // Helper function to check if alert is ignored
    const isAlertIgnored = async (alertType, entityType = 'system', entityId = 'global') => {
      try {
        const result = await pool.query(`
          SELECT 1 FROM ignored_alerts 
          WHERE alert_type = $1 AND entity_type = $2 AND entity_id = $3
        `, [alertType, entityType, entityId]);
        return result.rows.length > 0;
      } catch (error) {
        console.log('Ignored alerts check skipped (table may not exist)');
        return false;
      }
    };

    // Count clef combinations without voicings (excluding ignored items)
    try {
      if (!(await isAlertIgnored('clef_combos_no_voicings'))) {
        const clefCombosWithoutVoicingsCount = await pool.query(`
          SELECT COUNT(*) as count
          FROM clef_combinations cc
          LEFT JOIN clef_combinations_voicings ccv ON cc.id = ccv.clef_combination_id
          WHERE ccv.clef_combination_id IS NULL
          AND cc.id NOT IN (
            SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
            WHERE alert_type = 'clef_combos_no_voicings' AND entity_type = 'clef_combinations'
          )
        `);

        const clefCombosCount = parseInt(clefCombosWithoutVoicingsCount.rows[0].count);
        if (clefCombosCount > 0) {
          alerts.push({
            type: 'clef_combos_no_voicings',
            severity: 'warning',
            title: 'Clef combinations not matched to voicings',
            description: `${clefCombosCount} clef combinations are not matched to voicings`,
            count: clefCombosCount
          });
        }
      }
    } catch (error) {
      console.log('Clef combinations alerts skipped (tables may not exist):', error.message);
    }

    // Count voicings without clef combinations  
    try {
      const voicingsWithoutClefCombosCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM voicings v
        LEFT JOIN clef_combinations_voicings ccv ON v.id = ccv.voicing_id
        WHERE ccv.voicing_id IS NULL
      `);

      const voicingsCount = parseInt(voicingsWithoutClefCombosCount.rows[0].count);
      if (voicingsCount > 0) {
        alerts.push({
          type: 'voicings_no_clef_combos',
          severity: 'warning', 
          title: 'Voicings not matched to clef combinations',
          description: `${voicingsCount} voicings are not matched to clef combinations`,
          count: voicingsCount
        });
      }
    } catch (error) {
      console.log('Voicings alerts skipped (tables may not exist):', error.message);
    }

    // REMOVED: Invalid clef combinations check - handled by cleanup routines

    // Count unused titles
    const unusedTitlesCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles 
      WHERE id NOT IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
    `);

    const titlesCount = parseInt(unusedTitlesCount.rows[0].count);
    if (titlesCount > 0) {
      alerts.push({
        type: 'unused_titles',
        severity: 'info',
        title: 'Unused titles in database',
        description: `${titlesCount} titles are not linked to any compositions or functions`,
        count: titlesCount
      });
    }

    // Count empty groups
    const emptyGroupsCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM groups 
      WHERE id NOT IN (SELECT DISTINCT group_id FROM compositions WHERE group_id IS NOT NULL)
    `);

    const groupsCount = parseInt(emptyGroupsCount.rows[0].count);
    if (groupsCount > 0) {
      alerts.push({
        type: 'empty_groups',
        severity: 'warning',
        title: 'Empty groups in database',
        description: `${groupsCount} groups have no associated compositions`,
        count: groupsCount
      });
    }

    // Count functions with no titles assigned (excluding ignored items)
    if (!(await isAlertIgnored('functions_no_titles'))) {
      const functionsWithoutTitlesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM functions f
        WHERE f.id NOT IN (SELECT DISTINCT function_id FROM functions_titles WHERE function_id IS NOT NULL)
        AND f.id NOT IN (
          SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
          WHERE alert_type = 'functions_no_titles' AND entity_type = 'functions'
        )
      `);

      const functionsCount = parseInt(functionsWithoutTitlesCount.rows[0].count);
      if (functionsCount > 0) {
        alerts.push({
          type: 'functions_no_titles',
          severity: 'warning',
          title: 'Functions with no titles assigned',
          description: `${functionsCount} functions have no titles associated with them`,
          count: functionsCount
        });
      }
    }

    // Count titles with no functions assigned (excluding ignored items)
    if (!(await isAlertIgnored('titles_no_functions'))) {
      const titlesWithoutFunctionsCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM titles t
        WHERE t.id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
        AND t.id IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
        AND t.id NOT IN (
          SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
          WHERE alert_type = 'titles_no_functions' AND entity_type = 'titles'
        )
      `);

      const titlesNoFunctionsCount = parseInt(titlesWithoutFunctionsCount.rows[0].count);
      if (titlesNoFunctionsCount > 0) {
        alerts.push({
          type: 'titles_no_functions',
          severity: 'info',
          title: 'Titles with no functions assigned',
          description: `${titlesNoFunctionsCount} titles used in compositions have no liturgical functions assigned`,
          count: titlesNoFunctionsCount
        });
      }
    }

    // Count groups where display title doesn't match any composition title (excluding ignored items)
    if (!(await isAlertIgnored('groups_title_mismatch'))) {
      const groupsWithMismatchedTitlesCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM groups g
        WHERE g.display_title NOT IN (
          SELECT DISTINCT t.text
          FROM compositions c
          JOIN titles t ON c.title_id = t.id
          WHERE c.group_id = g.id
        )
        AND EXISTS (
          SELECT 1 FROM compositions c WHERE c.group_id = g.id
        )
        AND g.id NOT IN (
          SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
          WHERE alert_type = 'groups_title_mismatch' AND entity_type = 'groups'
        )
      `);

      const mismatchCount = parseInt(groupsWithMismatchedTitlesCount.rows[0].count);
      if (mismatchCount > 0) {
        alerts.push({
          type: 'groups_title_mismatch',
          severity: 'warning',
          title: 'Groups with mismatched display titles',
          description: `${mismatchCount} groups have display titles that don't match any of their compositions`,
          count: mismatchCount
        });
      }
    }

    // Count titles with no language assigned (excluding ignored items)
    if (!(await isAlertIgnored('titles_no_language'))) {
      const titlesWithoutLanguageCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM titles t
        WHERE t.language IS NULL
        AND t.id NOT IN (
          SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
          WHERE alert_type = 'titles_no_language' AND entity_type = 'titles'
        )
      `);

      const noLanguageCount = parseInt(titlesWithoutLanguageCount.rows[0].count);
      if (noLanguageCount > 0) {
        alerts.push({
          type: 'titles_no_language',
          severity: 'error',
          title: 'Titles with no language assigned',
          description: `${noLanguageCount} titles have no language assigned and must be corrected`,
          count: noLanguageCount
        });
      }
    }

    // Count composers with missing dates or country information (excluding ignored items)
    if (!(await isAlertIgnored('composers_missing_data'))) {
      const composersWithMissingDataCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM composers c
        WHERE (c.from_year IS NULL OR c.to_year IS NULL OR c.birthplace_2 IS NULL OR c.birthplace_2 = '')
        AND c.id NOT IN (
          SELECT CAST(entity_id AS INTEGER) FROM ignored_alerts 
          WHERE alert_type = 'composers_missing_data' AND entity_type = 'composers'
        )
      `);

      const missingDataCount = parseInt(composersWithMissingDataCount.rows[0].count);
      if (missingDataCount > 0) {
        alerts.push({
          type: 'composers_missing_data',
          severity: 'warning',
          title: 'Composers with missing biographical data',
          description: `${missingDataCount} composers are missing dates or birthplace information`,
          count: missingDataCount
        });
      }
    }

    // Count orphaned compositions
    const orphanedCompositionsCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM compositions 
      WHERE group_id NOT IN (SELECT id FROM groups)
    `);

    const orphanedCount = parseInt(orphanedCompositionsCount.rows[0].count);
    if (orphanedCount > 0) {
      alerts.push({
        type: 'orphaned_compositions',
        severity: 'error',
        title: 'Orphaned compositions',
        description: `${orphanedCount} compositions reference non-existent groups`,
        count: orphanedCount
      });
    }

    res.json(alerts);
  } catch (error) {
    console.error('Error fetching data quality alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ignore a data quality alert permanently
router.post('/ignore-alert', async (req, res) => {
  try {
    const { alert_type, entity_type, entity_id, reason } = req.body;
    const user_id = req.user.id;

    if (!alert_type || !entity_type || !entity_id) {
      return res.status(400).json({ error: 'alert_type, entity_type, and entity_id are required' });
    }

    const query = `
      INSERT INTO ignored_alerts (alert_type, entity_type, entity_id, ignored_by, reason)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (alert_type, entity_type, entity_id) DO UPDATE SET
        ignored_by = $4,
        ignored_at = CURRENT_TIMESTAMP,
        reason = $5
    `;
    
    await pool.query(query, [alert_type, entity_type, entity_id, user_id, reason || null]);
    res.json({ success: true, message: 'Alert ignored successfully' });
  } catch (error) {
    console.error('Error ignoring alert:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Database cleanup routines
router.post('/cleanup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { cleanup_type } = req.body;
    const results = await runDatabaseCleanup(client, cleanup_type);
    res.json({ 
      success: true, 
      message: 'Database cleanup completed successfully',
      results: results
    });
  } catch (error) {
    console.error('Error during database cleanup:', error);
    res.status(500).json({ error: 'Database cleanup failed' });
  } finally {
    client.release();
  }
});

// Preview cleanup (show what would be removed without actually removing)
router.get('/cleanup-preview', async (req, res) => {
  try {
    const preview = {};

    // 1. Unused titles = titles not referenced in compositions
    const unusedTitles = await pool.query(`
      SELECT COUNT(*) as count, 
             STRING_AGG(SUBSTRING(text, 1, 50), ', ') as examples
      FROM titles 
      WHERE id NOT IN (SELECT title_id FROM compositions WHERE title_id IS NOT NULL)
    `);
    preview.unused_titles = {
      count: parseInt(unusedTitles.rows[0].count),
      examples: unusedTitles.rows[0].examples
    };

    // 2. Empty groups = groups with no compositions
    const emptyGroups = await pool.query(`
      SELECT COUNT(*) as count,
             STRING_AGG(SUBSTRING(display_title, 1, 50), ', ') as examples
      FROM groups 
      WHERE id NOT IN (SELECT group_id FROM compositions WHERE group_id IS NOT NULL)
    `);
    preview.empty_groups = {
      count: parseInt(emptyGroups.rows[0].count),
      examples: emptyGroups.rows[0].examples
    };

    // 3. Orphaned compositions = compositions not in any inclusions
    const orphanedCompositions = await pool.query(`
      SELECT COUNT(*) as count,
             STRING_AGG(SUBSTRING(COALESCE(t.text, 'Untitled'), 1, 50), ', ') as examples
      FROM compositions c
      LEFT JOIN titles t ON c.title_id = t.id
      WHERE c.id NOT IN (SELECT composition_id FROM inclusions WHERE composition_id IS NOT NULL)
    `);
    preview.orphaned_compositions = {
      count: parseInt(orphanedCompositions.rows[0].count),
      examples: orphanedCompositions.rows[0].examples
    };

    // 4. Orphaned clef combinations = clef combinations not used in inclusions
    try {
      const orphanedClefCombos = await pool.query(`
        SELECT COUNT(*) as count,
               STRING_AGG(SUBSTRING(clef_combination, 1, 20), ', ') as examples
        FROM clef_combinations 
        WHERE clef_combination NOT IN (
          SELECT sorted_clef_combination_required FROM inclusions 
          WHERE sorted_clef_combination_required IS NOT NULL
        )
        AND clef_combination NOT IN (
          SELECT sorted_clef_combination_all FROM inclusions 
          WHERE sorted_clef_combination_all IS NOT NULL
        )
      `);
      preview.unused_clef_combinations = {
        count: parseInt(orphanedClefCombos.rows[0].count),
        examples: orphanedClefCombos.rows[0].examples
      };
    } catch (error) {
      console.log('Clef combinations cleanup preview skipped (table may not exist):', error.message);
      preview.unused_clef_combinations = { count: 0, examples: null };
    }

    res.json(preview);
  } catch (error) {
    console.error('Error generating cleanup preview:', error);
    res.status(500).json({ error: 'Failed to generate cleanup preview' });
  }
});

// GET /anonymous-voice-counts - Get available voice counts for anonymous groups
router.get('/anonymous-voice-counts', requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT
        (
          SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
          FROM compositions c2
          WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
        ) as voice_count
      FROM groups g
      WHERE NOT EXISTS (
        -- Group contains NO named composers (only anonymous compositions)
        SELECT 1 FROM compositions c
        CROSS JOIN unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS composer_id
        WHERE c.group_id = g.id
        AND c.composer_id_list IS NOT NULL
        AND array_length(c.composer_id_list, 1) > 0
        AND composer_id != 23
      )
      AND EXISTS (
        -- Group contains at least one composition with composer_id_list
        SELECT 1 FROM compositions c
        WHERE c.group_id = g.id
        AND c.composer_id_list IS NOT NULL
        AND array_length(c.composer_id_list, 1) > 0
      )
      ORDER BY voice_count;
    `;
    
    const result = await pool.query(query);
    const voiceCounts = result.rows
      .map(row => row.voice_count)
      .filter(count => count !== null && count > 0)
      .sort((a, b) => a - b);
    
    res.json(voiceCounts);
  } catch (error) {
    console.error('Error fetching anonymous voice counts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /group-suggestions - Generate composition merge suggestions
router.get('/group-suggestions', requireAdmin, async (req, res) => {
  try {
    console.log('Starting group suggestions analysis...');
    const startTime = Date.now();
    
    // Get parameters from query
    const { voices, composer, source } = req.query;
    const voiceFilter = voices ? parseInt(voices) : null;
    const composerFilter = composer ? parseInt(composer) : null;
    const sourceFilter = source ? parseInt(source) : null;
    
    if (voiceFilter) {
      console.log(`Filtering analysis to ${voiceFilter}-voice compositions only`);
    }
    if (composerFilter) {
      console.log(`Filtering analysis to composer ID ${composerFilter} only`);
    }
    if (sourceFilter) {
      console.log(`Filtering analysis to source ID ${sourceFilter} only`);
    }
    
    let anonymousQuery, allGroupsQuery, queryParams;
    
    if (sourceFilter) {
      // Source-based analysis: find potential matches for compositions in a specific source
      anonymousQuery = `
        WITH sourceGroups AS (
          SELECT DISTINCT
             g.id,
             g.display_title,
             
             -- Get voice count
             (
               SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
               FROM compositions c2
               WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
             ) as voice_count,
             
             -- Get clef combinations as text array
             (
               SELECT array_agg(i.clefs::text) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as clef_combinations,
             
             -- Get titles as simple text aggregation
             (
               SELECT string_agg(t.text, '|||') FILTER (WHERE t.text IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as composition_titles,
             
             -- Get languages as simple text aggregation
             (
               SELECT string_agg(t.language::text, '|||') FILTER (WHERE t.language IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as title_languages,
             
             -- Get tone information
             (
               SELECT array_agg(c2.tone::text) FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as tones,
             
             -- Get composer information as text aggregation
             (
               SELECT string_agg(comp.name || '::' || COALESCE(comp.from_year::text, '') || '::' || COALESCE(comp.to_year::text, ''), '|||')
               FILTER (WHERE comp.id IS NOT NULL)
               FROM compositions c2
               JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
               WHERE c2.group_id = g.id AND c2.composer_id_list IS NOT NULL
             ) as composer_details,
             
             -- Get source information as text aggregation with images, clefs, and position
             (
               SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, '') || '::' || COALESCE(s.code, '') || '::' || COALESCE(si.images, '[]') || '::' || COALESCE(i.clefs::text, '[]') || '::' || COALESCE(i.position, ''), '|||')
               FILTER (WHERE s.id IS NOT NULL)
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               JOIN sources s ON i.source_id = s.id
               LEFT JOIN (
                 SELECT si2.source_id, json_agg(json_build_object('url', si2.url, 'label', si2.label)) as images
                 FROM source_images si2
                 GROUP BY si2.source_id
               ) si ON s.id = si.source_id
               WHERE c2.group_id = g.id
             ) as source_details,
             
             -- Get composition type information from compositions table
             (
               SELECT string_agg(DISTINCT COALESCE(ct.name, 'Unknown'), '|||')
               FROM compositions c2
               LEFT JOIN composition_types ct ON c2.composition_type_id = ct.id
               WHERE c2.group_id = g.id
             ) as composition_types,
             
             -- Get tone information from compositions table
             (
               SELECT string_agg(DISTINCT c2.tone::text, '|||') FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_tones,
             
             -- Get even/odd information from compositions table
             (
               SELECT string_agg(DISTINCT c2.even_odd::text, '|||') FILTER (WHERE c2.even_odd IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_even_odd,
             
             -- Get inclusion notes for text analysis
             (
               SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as inclusion_notes,
             
             -- Get the source position for ordering
             (
               SELECT MIN(i.position) 
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id AND i.source_id = $1
             ) as source_position
             
          FROM groups g
          WHERE EXISTS (
            -- Group contains compositions from the specified source
            SELECT 1 FROM compositions c 
            JOIN inclusions i ON c.id = i.composition_id
            WHERE c.group_id = g.id 
            AND i.source_id = $1
          )
          ORDER BY source_position, g.id
        )
        SELECT * FROM sourceGroups 
        WHERE voice_count IS NOT NULL 
          AND composition_titles IS NOT NULL 
          AND composer_details IS NOT NULL
        ORDER BY source_position, id;
      `;
      
      // For source analysis, we compare against all groups (excluding self-matches)
      allGroupsQuery = `
        WITH allGroups AS (
          SELECT 
             g.id,
             g.display_title,
             
             -- Get voice count
             (
               SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
               FROM compositions c2
               WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
             ) as voice_count,
             
             -- Get clef combinations as text array
             (
               SELECT array_agg(i.clefs::text) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as clef_combinations,
             
             -- Get titles as simple text aggregation
             (
               SELECT string_agg(t.text, '|||') FILTER (WHERE t.text IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as composition_titles,
             
             -- Get languages as simple text aggregation
             (
               SELECT string_agg(t.language::text, '|||') FILTER (WHERE t.language IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as title_languages,
             
             -- Get tone information
             (
               SELECT array_agg(c2.tone::text) FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as tones,
             
             -- Get composer information as text aggregation
             (
               SELECT string_agg(comp.name || '::' || COALESCE(comp.from_year::text, '') || '::' || COALESCE(comp.to_year::text, ''), '|||')
               FILTER (WHERE comp.id IS NOT NULL)
               FROM compositions c2
               JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
               WHERE c2.group_id = g.id AND c2.composer_id_list IS NOT NULL
             ) as composer_details,
             
             -- Get source information as text aggregation with images, clefs, and position
             (
               SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, '') || '::' || COALESCE(s.code, '') || '::' || COALESCE(si.images, '[]') || '::' || COALESCE(i.clefs::text, '[]') || '::' || COALESCE(i.position, ''), '|||')
               FILTER (WHERE s.id IS NOT NULL)
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               JOIN sources s ON i.source_id = s.id
               LEFT JOIN (
                 SELECT si2.source_id, json_agg(json_build_object('url', si2.url, 'label', si2.label)) as images
                 FROM source_images si2
                 GROUP BY si2.source_id
               ) si ON s.id = si.source_id
               WHERE c2.group_id = g.id
             ) as source_details,
             
             -- Get composition type information from compositions table
             (
               SELECT string_agg(DISTINCT COALESCE(ct.name, 'Unknown'), '|||')
               FROM compositions c2
               LEFT JOIN composition_types ct ON c2.composition_type_id = ct.id
               WHERE c2.group_id = g.id
             ) as composition_types,
             
             -- Get tone information from compositions table
             (
               SELECT string_agg(DISTINCT c2.tone::text, '|||') FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_tones,
             
             -- Get even/odd information from compositions table
             (
               SELECT string_agg(DISTINCT c2.even_odd::text, '|||') FILTER (WHERE c2.even_odd IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_even_odd,
             
             -- Get inclusion notes for text analysis
             (
               SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as inclusion_notes
             
          FROM groups g
          WHERE g.id IN (
            SELECT DISTINCT c.group_id 
            FROM compositions c 
            WHERE c.group_id IS NOT NULL
          )
          ORDER BY g.id
        )
        SELECT * FROM allGroups 
        WHERE voice_count IS NOT NULL 
          AND composition_titles IS NOT NULL 
          AND composer_details IS NOT NULL
        ORDER BY id;
      `;
      
      queryParams = [sourceFilter];
      
    } else if (composerFilter) {
      // Composer-based analysis: find potential duplicates/variations for a specific composer
      anonymousQuery = `
        WITH composerGroups AS (
          SELECT DISTINCT
             g.id,
             g.display_title,
             
             -- Get voice count
             (
               SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
               FROM compositions c2
               WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
             ) as voice_count,
             
             -- Get clef combinations as text array
             (
               SELECT array_agg(i.clefs::text) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as clef_combinations,
             
             -- Get titles as simple text aggregation
             (
               SELECT string_agg(t.text, '|||') FILTER (WHERE t.text IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as composition_titles,
             
             -- Get languages as simple text aggregation
             (
               SELECT string_agg(t.language::text, '|||') FILTER (WHERE t.language IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as title_languages,
             
             -- Get tone information
             (
               SELECT array_agg(c2.tone::text) FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as tones,
             
             -- Get composer information as text aggregation
             (
               SELECT string_agg(comp.name || '::' || COALESCE(comp.from_year::text, '') || '::' || COALESCE(comp.to_year::text, ''), '|||')
               FILTER (WHERE comp.id IS NOT NULL)
               FROM compositions c2
               JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
               WHERE c2.group_id = g.id AND c2.composer_id_list IS NOT NULL
             ) as composer_details,
             
             -- Get source information as text aggregation with images, clefs, and position
             (
               SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, '') || '::' || COALESCE(s.code, '') || '::' || COALESCE(si.images, '[]') || '::' || COALESCE(i.clefs::text, '[]') || '::' || COALESCE(i.position, ''), '|||')
               FILTER (WHERE s.id IS NOT NULL)
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               JOIN sources s ON i.source_id = s.id
               LEFT JOIN (
                 SELECT si2.source_id, json_agg(json_build_object('url', si2.url, 'label', si2.label)) as images
                 FROM source_images si2
                 GROUP BY si2.source_id
               ) si ON s.id = si.source_id
               WHERE c2.group_id = g.id
             ) as source_details,
             
             -- Get composition type information from compositions table
             (
               SELECT string_agg(DISTINCT COALESCE(ct.name, 'Unknown'), '|||')
               FROM compositions c2
               LEFT JOIN composition_types ct ON c2.composition_type_id = ct.id
               WHERE c2.group_id = g.id
             ) as composition_types,
             
             -- Get tone information from compositions table
             (
               SELECT string_agg(DISTINCT c2.tone::text, '|||') FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_tones,
             
             -- Get even/odd information from compositions table
             (
               SELECT string_agg(DISTINCT c2.even_odd::text, '|||') FILTER (WHERE c2.even_odd IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_even_odd,
             
             -- Get inclusion notes for text analysis
             (
               SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as inclusion_notes
             
          FROM groups g
          WHERE EXISTS (
            -- Group contains compositions by the specified composer
            SELECT 1 FROM compositions c 
            WHERE c.group_id = g.id 
            AND c.composer_id_list IS NOT NULL 
            AND $1 = ANY(c.composer_id_list)
          )
          ORDER BY g.id
        )
        SELECT * FROM composerGroups 
        WHERE voice_count IS NOT NULL 
          AND composition_titles IS NOT NULL 
          AND composer_details IS NOT NULL
        ORDER BY voice_count, id;
      `;
      
      // For composer analysis, we compare against the same set (looking for variations)
      allGroupsQuery = anonymousQuery;
      queryParams = [composerFilter];
      
    } else {
      // Anonymous analysis (original logic)
      anonymousQuery = `
        WITH anonymousGroups AS (
          SELECT DISTINCT
             g.id,
             g.display_title,
             
             -- Get voice count
             (
               SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
               FROM compositions c2
               WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
             ) as voice_count,
             
             -- Get clef combinations as text array
             (
               SELECT array_agg(i.clefs::text) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as clef_combinations,
             
             -- Get titles as simple text aggregation
             (
               SELECT string_agg(t.text, '|||') FILTER (WHERE t.text IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as composition_titles,
             
             -- Get languages as simple text aggregation
             (
               SELECT string_agg(t.language::text, '|||') FILTER (WHERE t.language IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as title_languages,
             
             -- Get tone information
             (
               SELECT array_agg(c2.tone::text) FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as tones,
             
             -- Get composer information as text aggregation
             (
               SELECT string_agg(comp.name || '::' || COALESCE(comp.from_year::text, '') || '::' || COALESCE(comp.to_year::text, ''), '|||')
               FILTER (WHERE comp.id IS NOT NULL)
               FROM compositions c2
               JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
               WHERE c2.group_id = g.id AND c2.composer_id_list IS NOT NULL
             ) as composer_details,
             
             -- Get source information as text aggregation with images, clefs, and position
             (
               SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, '') || '::' || COALESCE(s.code, '') || '::' || COALESCE(si.images, '[]') || '::' || COALESCE(i.clefs::text, '[]') || '::' || COALESCE(i.position, ''), '|||')
               FILTER (WHERE s.id IS NOT NULL)
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               JOIN sources s ON i.source_id = s.id
               LEFT JOIN (
                 SELECT si2.source_id, json_agg(json_build_object('url', si2.url, 'label', si2.label)) as images
                 FROM source_images si2
                 GROUP BY si2.source_id
               ) si ON s.id = si.source_id
               WHERE c2.group_id = g.id
             ) as source_details,
             
             -- Get composition type information from compositions table
             (
               SELECT string_agg(DISTINCT COALESCE(ct.name, 'Unknown'), '|||')
               FROM compositions c2
               LEFT JOIN composition_types ct ON c2.composition_type_id = ct.id
               WHERE c2.group_id = g.id
             ) as composition_types,
             
             -- Get tone information from compositions table
             (
               SELECT string_agg(DISTINCT c2.tone::text, '|||') FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_tones,
             
             -- Get even/odd information from compositions table
             (
               SELECT string_agg(DISTINCT c2.even_odd::text, '|||') FILTER (WHERE c2.even_odd IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_even_odd,
             
             -- Get inclusion notes for text analysis
             (
               SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as inclusion_notes
             
          FROM groups g
          WHERE NOT EXISTS (
            -- Group contains NO named composers (only anonymous compositions)
            SELECT 1 FROM compositions c 
            CROSS JOIN unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS composer_id
            WHERE c.group_id = g.id 
            AND c.composer_id_list IS NOT NULL 
            AND array_length(c.composer_id_list, 1) > 0
            AND composer_id != 23
            ${voiceFilter ? 'AND c.number_of_voices = $1' : ''}
          )
          ORDER BY g.id
        )
        SELECT * FROM anonymousGroups 
        WHERE voice_count IS NOT NULL 
          AND composition_titles IS NOT NULL 
          AND composer_details IS NOT NULL
          ${voiceFilter ? 'AND voice_count = $1' : ''}
        ORDER BY voice_count, id;
      `;
      
      allGroupsQuery = `
        WITH allGroups AS (
          SELECT 
             g.id,
             g.display_title,
             
             -- Get voice count
             (
               SELECT MODE() WITHIN GROUP (ORDER BY c2.number_of_voices)
               FROM compositions c2
               WHERE c2.group_id = g.id AND c2.number_of_voices IS NOT NULL
             ) as voice_count,
             
             -- Get clef combinations as text array
             (
               SELECT array_agg(i.clefs::text) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as clef_combinations,
             
             -- Get titles as simple text aggregation
             (
               SELECT string_agg(t.text, '|||') FILTER (WHERE t.text IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as composition_titles,
             
             -- Get languages as simple text aggregation
             (
               SELECT string_agg(t.language::text, '|||') FILTER (WHERE t.language IS NOT NULL)
               FROM compositions c2
               JOIN titles t ON c2.title_id = t.id
               WHERE c2.group_id = g.id
             ) as title_languages,
             
             -- Get tone information
             (
               SELECT array_agg(c2.tone::text) FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as tones,
             
             -- Get composer information as text aggregation
             (
               SELECT string_agg(comp.name || '::' || COALESCE(comp.from_year::text, '') || '::' || COALESCE(comp.to_year::text, ''), '|||')
               FILTER (WHERE comp.id IS NOT NULL)
               FROM compositions c2
               JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
               WHERE c2.group_id = g.id AND c2.composer_id_list IS NOT NULL
             ) as composer_details,
             
             -- Get source information as text aggregation with images, clefs, and position
             (
               SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, '') || '::' || COALESCE(s.code, '') || '::' || COALESCE(si.images, '[]') || '::' || COALESCE(i.clefs::text, '[]') || '::' || COALESCE(i.position, ''), '|||')
               FILTER (WHERE s.id IS NOT NULL)
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               JOIN sources s ON i.source_id = s.id
               LEFT JOIN (
                 SELECT si2.source_id, json_agg(json_build_object('url', si2.url, 'label', si2.label)) as images
                 FROM source_images si2
                 GROUP BY si2.source_id
               ) si ON s.id = si.source_id
               WHERE c2.group_id = g.id
             ) as source_details,
             
             -- Get composition type information from compositions table
             (
               SELECT string_agg(DISTINCT COALESCE(ct.name, 'Unknown'), '|||')
               FROM compositions c2
               LEFT JOIN composition_types ct ON c2.composition_type_id = ct.id
               WHERE c2.group_id = g.id
             ) as composition_types,
             
             -- Get tone information from compositions table
             (
               SELECT string_agg(DISTINCT c2.tone::text, '|||') FILTER (WHERE c2.tone IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_tones,
             
             -- Get even/odd information from compositions table
             (
               SELECT string_agg(DISTINCT c2.even_odd::text, '|||') FILTER (WHERE c2.even_odd IS NOT NULL)
               FROM compositions c2
               WHERE c2.group_id = g.id
             ) as composition_even_odd,
             
             -- Get inclusion notes for text analysis
             (
               SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
               FROM compositions c2
               JOIN inclusions i ON c2.id = i.composition_id
               WHERE c2.group_id = g.id
             ) as inclusion_notes
             
          FROM groups g
          WHERE g.id IN (
            SELECT DISTINCT c.group_id 
            FROM compositions c 
            WHERE c.group_id IS NOT NULL
            ${voiceFilter ? 'AND c.number_of_voices = $1' : ''}
          )
          ORDER BY g.id
        )
        SELECT * FROM allGroups 
        WHERE voice_count IS NOT NULL 
          AND composition_titles IS NOT NULL 
          AND composer_details IS NOT NULL
          ${voiceFilter ? 'AND voice_count = $1' : ''}
        ORDER BY voice_count, id;
      `;
      
      queryParams = voiceFilter ? [voiceFilter] : [];
    }
    
    // Execute both queries with appropriate parameters
    const [anonymousResult, allGroupsResult] = await Promise.all([
      pool.query(anonymousQuery, queryParams),
      pool.query(allGroupsQuery, sourceFilter ? [] : queryParams) // Source analysis allGroupsQuery needs no params
    ]);
    
    const anonymousGroups = anonymousResult.rows.map(parseGroupData);
    const allGroups = allGroupsResult.rows.map(parseGroupData);
    
    if (sourceFilter) {
      console.log(`Loaded ${anonymousGroups.length} groups from source for analysis against ${allGroups.length} total groups`);
    } else if (composerFilter) {
      console.log(`Loaded ${anonymousGroups.length} groups by composer for analysis against ${allGroups.length} total groups`);
    } else {
      console.log(`Loaded ${anonymousGroups.length} anonymous groups and ${allGroups.length} total groups for comparison`);
    }
    
    if (anonymousGroups.length === 0) {
      return res.json({
        suggestions: [],
        stats: {
          totalAnonymousGroups: sourceFilter || composerFilter ? 0 : anonymousGroups.length,
          totalGroups: allGroups.length,
          composerGroups: composerFilter ? anonymousGroups.length : 0,
          sourceGroups: sourceFilter ? anonymousGroups.length : 0,
          suggestionsFound: 0,
          groupedSuggestions: 0,
          highConfidence: 0,
          mediumConfidence: 0,
          lowConfidence: 0,
          analysisTime: Date.now() - startTime,
          analysisType: sourceFilter ? 'source' : (composerFilter ? 'composer' : 'anonymous')
        }
      });
    }
    
    const suggestions = [];
    const maxSuggestions = 500; // Increased since we're being more targeted
    
    // Group both sets by voice count for efficient comparison
    const primaryGroupsByVoices = {};
    const allGroupsByVoices = {};
    
    for (const group of anonymousGroups) {
      const voices = group.voice_count;
      if (!primaryGroupsByVoices[voices]) {
        primaryGroupsByVoices[voices] = [];
      }
      primaryGroupsByVoices[voices].push(group);
    }
    
    for (const group of allGroups) {
      const voices = group.voice_count;
      if (!allGroupsByVoices[voices]) {
        allGroupsByVoices[voices] = [];
      }
      allGroupsByVoices[voices].push(group);
    }
    
    // Track compared pairs to avoid A=B and B=A duplicates
    const comparedPairs = new Set();
    
    // COMPREHENSIVE SEARCH: Since we only show 2-3 results, we can afford to check more thoroughly
    // Only limit if datasets are extremely large to prevent total memory exhaustion
    for (const [voiceCount, groups] of Object.entries(primaryGroupsByVoices)) {
      const limit = parseInt(voiceCount) >= 5 ? 200 : 400; // More generous limits since we show fewer results
      if (groups.length > limit) {
        console.log(`Voice count ${voiceCount} has ${groups.length} groups - limiting to first ${limit} for comprehensive search`);
        primaryGroupsByVoices[voiceCount] = groups.slice(0, limit);
      }
    }
    
    for (const [voiceCount, groups] of Object.entries(allGroupsByVoices)) {
      const limit = parseInt(voiceCount) >= 5 ? 800 : 1200; // Much more generous for comparison sets
      if (groups.length > limit) {
        console.log(`Voice count ${voiceCount} comparison set has ${groups.length} groups - limiting to first ${limit} for comprehensive search`);
        allGroupsByVoices[voiceCount] = groups.slice(0, limit);
      }
    }
    
    // Compare primary groups against all groups with same voice count
    for (const [voiceCount, anonGroups] of Object.entries(primaryGroupsByVoices)) {
      const compareGroups = allGroupsByVoices[voiceCount] || [];
      
      if (compareGroups.length === 0) continue;
      
      const analysisType = sourceFilter ? 'source' : (composerFilter ? 'composer' : 'anonymous');
      console.log(`Analyzing ${anonGroups.length} ${analysisType} groups against ${compareGroups.length} total groups with ${voiceCount} voices`);
      
      for (const anonGroup of anonGroups) {
        // DISPLAY LIMIT: Only show 2-3 primary records per page for focused review
        if (suggestions.length >= 3) break;
        
        // Extended timeout since we're doing more comprehensive search but showing fewer results
        const timeLimit = 45000; // 45 seconds for comprehensive analysis
        if (Date.now() - startTime > timeLimit) {
          console.log(`Analysis timeout reached after ${timeLimit}ms, stopping with ${suggestions.length} suggestions`);
          break;
        }
        
        for (const compareGroup of compareGroups) {
          // DISPLAY LIMIT: Only show 2-3 primary records per page for focused review
        if (suggestions.length >= 3) break;
          
          // Don't compare group to itself
          if (anonGroup.id === compareGroup.id) continue;
          
          // Consolidate A=B and B=A duplicates
          const pairKey = `${Math.min(anonGroup.id, compareGroup.id)}-${Math.max(anonGroup.id, compareGroup.id)}`;
          if (comparedPairs.has(pairKey)) continue;
          comparedPairs.add(pairKey);
          
          // ===============================
          // SMART PRE-FILTERING - ELIMINATE OBVIOUS NON-MATCHES EARLY
          // ===============================
          
          // 1. QUICK CLEF CHECK - if clef sets have no overlap, skip expensive analysis
          const clefs1 = new Set((anonGroup.clef_combination || '').split(/[,\s]+/).filter(Boolean));
          const clefs2 = new Set((compareGroup.clef_combination || '').split(/[,\s]+/).filter(Boolean));
          if (clefs1.size > 0 && clefs2.size > 0) {
            const hasCommonClef = [...clefs1].some(c => clefs2.has(c));
            if (!hasCommonClef) continue; // No clef overlap = definitely different
          }
          
          // 2. BASIC TITLE LENGTH CHECK - very different lengths unlikely to match
          const titles1 = anonGroup.all_titles || [];
          const titles2 = compareGroup.all_titles || [];
          if (titles1.length > 0 && titles2.length > 0) {
            let hasReasonableMatch = false;
            for (const t1 of titles1) {
              for (const t2 of titles2) {
                const len1 = (t1.text || '').length;
                const len2 = (t2.text || '').length;
                if (len1 > 0 && len2 > 0) {
                  const ratio = Math.min(len1, len2) / Math.max(len1, len2);
                  if (ratio >= 0.3) { // Titles within reasonable length ratio
                    hasReasonableMatch = true;
                    break;
                  }
                }
              }
              if (hasReasonableMatch) break;
            }
            if (!hasReasonableMatch) continue; // All titles have very different lengths
          }
          
          // 3. OBVIOUS TITLE MISMATCH - simple word check before expensive analysis
          if (titles1.length > 0 && titles2.length > 0) {
            let hasWordOverlap = false;
            for (const t1 of titles1) {
              for (const t2 of titles2) {
                const words1 = (t1.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
                const words2 = (t2.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
                if (words1.some(w => words2.includes(w))) {
                  hasWordOverlap = true;
                  break;
                }
              }
              if (hasWordOverlap) break;
            }
            if (!hasWordOverlap && titles1.some(t => (t.text || '').length > 5) && titles2.some(t => (t.text || '').length > 5)) {
              continue; // No word overlap in substantial titles
            }
          }
          
          // ===============================
          // MEMORY-EFFICIENT PRE-FILTERING - ELIMINATE BEFORE EXPENSIVE OPERATIONS
          // ===============================
          
          // 4. FAST PROPERTY CONFLICTS CHECK
          if (hasConflictingProperties(anonGroup, compareGroup)) {
            continue; // Skip if fundamental properties don't match
          }
          
          // 5. QUICK COMPOSER MISMATCH - if both have same named composer, probably different works
          const composers1 = (anonGroup.composer_details || []).filter(c => c.name && c.name !== 'Anon');
          const composers2 = (compareGroup.composer_details || []).filter(c => c.name && c.name !== 'Anon');
          if (composers1.length > 0 && composers2.length > 0) {
            const sameComposer = composers1.some(c1 => composers2.some(c2 => c1.name === c2.name));
            if (sameComposer) continue; // Same composer = likely different works, low priority
          }
          
          // 6. MEMORY-SAVING: Don't load full details for obviously bad matches
          let quickScore = 0;
          
          // Quick clef scoring (no expensive analysis)
          if (clefs1.size > 0 && clefs2.size > 0) {
            const intersection = [...clefs1].filter(c => clefs2.has(c)).length;
            const union = new Set([...clefs1, ...clefs2]).size;
            quickScore += Math.floor((intersection / union) * 30); // Max 30 points for clefs
          }
          
          // Quick title word count
          if (titles1.length > 0 && titles2.length > 0) {
            let bestWordOverlap = 0;
            for (const t1 of titles1.slice(0, 2)) { // Only check first 2 titles
              for (const t2 of titles2.slice(0, 2)) {
                const words1 = (t1.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
                const words2 = (t2.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
                const overlap = words1.filter(w => words2.includes(w)).length;
                bestWordOverlap = Math.max(bestWordOverlap, overlap);
              }
            }
            quickScore += Math.min(bestWordOverlap * 8, 25); // Max 25 points for word overlap
          }
          
          // 7. EARLY REJECTION: If quick score is too low, skip expensive analysis
          if (quickScore < 15) { // Minimum threshold for proceeding
            continue; // Not worth the expensive analysis
          }
          
          // Skip if this pair has been flagged as "not the same"
          try {
            const flagQuery = `
              SELECT 1 FROM suggestion_flags 
              WHERE ((group1_id = $1 AND group2_id = $2) OR (group1_id = $2 AND group2_id = $1))
              AND flag_type = 'not_same'
              LIMIT 1
            `;
            const flagResult = await client.query(flagQuery, [anonGroup.id, compareGroup.id]);
            if (flagResult.rows.length > 0) continue;
          } catch (flagError) {
            console.error('Flag check error:', flagError);
            // Continue processing if flag check fails
          }
          
          // Check if both groups share any sources (reject same-source suggestions)
          const sourceIds1 = new Set();
          const sourceIds2 = new Set();
          
          if (anonGroup.source_details) {
            anonGroup.source_details.forEach(source => {
              if (source.id) sourceIds1.add(source.id);
            });
          }
          
          if (compareGroup.source_details) {
            compareGroup.source_details.forEach(source => {
              if (source.id) sourceIds2.add(source.id);
            });
          }
          
          const hasCommonSource = [...sourceIds1].some(id => sourceIds2.has(id));
          if (hasCommonSource) continue;
          
          // STRICT ELIMINATION: Different composition properties = different works
          if (hasConflictingProperties(anonGroup, compareGroup)) {
            continue; // Skip this comparison entirely
          }
          
          // Quick pre-filter: skip if no title overlap potential
          if (!hasQuickTitleOverlap(anonGroup, compareGroup)) continue;
          
          const matchResult = analyzeGroupMatch(anonGroup, compareGroup);
          
          // Lower threshold for anonymous matches since they're inherently valuable
          // BUT with stricter algorithm, we can raise the threshold
          // Also filter out low confidence results (only show Medium and High)
          
          // Filter out suggestions where titles only differ by Roman numerals in square brackets
          // These likely represent already-reviewed distinct compositions (different settings of same text)
          const shouldFilterRomanNumeralDifference = (group1, group2) => {
            const titles1 = group1.title_language_pairs?.map(p => p.text) || [];
            const titles2 = group2.title_language_pairs?.map(p => p.text) || [];
            
            for (const title1 of titles1) {
              for (const title2 of titles2) {
                // Remove Roman numeral annotations in square brackets - handles any combination of I, V, X, L, C, D, M
                // Examples: [I], [II], [III], [IV], [V], [VI], [VII], [VIII], [IX], [X], [XI], [XII], [XXXII], [XXXIII], etc.
                const cleanTitle1 = title1.replace(/\s*\[[IVXLCDM]+\]\s*$/gi, '').trim();
                const cleanTitle2 = title2.replace(/\s*\[[IVXLCDM]+\]\s*$/gi, '').trim();
                
                // If titles are identical after removing Roman numerals, this is likely
                // an already-reviewed distinction between movements/sections/settings
                if (cleanTitle1.toLowerCase() === cleanTitle2.toLowerCase() && 
                    cleanTitle1.length > 0 && 
                    title1 !== title2) {
                  return true; // Should filter out
                }
              }
            }
            return false; // Don't filter
          };
          
          if (matchResult.totalScore >= 40 && !shouldFilterRomanNumeralDifference(anonGroup, compareGroup)) {
            suggestions.push({
              group1: {
                id: anonGroup.id,
                name: anonGroup.display_title,
                voice_count: anonGroup.voice_count,
                titles: anonGroup.title_language_pairs?.map(p => p.text) || [],
                composers: anonGroup.composer_details?.map(c => c.name) || [],
                types: anonGroup.composition_types || [],
                tones: anonGroup.composition_tones || [],
                evenOdd: anonGroup.composition_even_odd || [],
                sources: anonGroup.source_details || [],
                clef_combinations: anonGroup.clef_combinations || [],
                inclusionNotes: anonGroup.inclusion_notes || '',
                position: anonGroup.position || null,
                isAnonymous: sourceFilter || composerFilter ? false : true // Only anonymous for voice analysis
              },
              group2: {
                id: compareGroup.id,
                name: compareGroup.display_title,
                voice_count: compareGroup.voice_count,
                titles: compareGroup.title_language_pairs?.map(p => p.text) || [],
                composers: compareGroup.composer_details?.map(c => c.name) || [],
                types: compareGroup.composition_types || [],
                tones: compareGroup.composition_tones || [],
                evenOdd: compareGroup.composition_even_odd || [],
                sources: compareGroup.source_details || [],
                clef_combinations: compareGroup.clef_combinations || [],
                inclusionNotes: compareGroup.inclusion_notes || '',
                isAnonymous: false
              },
              matchScore: matchResult.totalScore,
              confidence: getConfidenceLevel(matchResult.totalScore),
              factors: matchResult.factors,
              notes: generateMatchNotes(anonGroup, compareGroup, matchResult.totalScore),
              potentialAttribution: !sourceFilter && !composerFilter // Flag anonymous analysis as potential attribution resolution
            });
          }
        }
      }
    }
    
    // Group suggestions by primary group for better UX
    const groupedSuggestions = [];
    const suggestionsByPrimaryGroup = {};
    
    // For composer analysis, group by composer's works (group1)
    // For anonymous analysis, group by anonymous works
    for (const suggestion of suggestions) {
      const primaryGroupId = composerFilter ? suggestion.group1.id : 
                            (suggestion.group1.isAnonymous ? suggestion.group1.id : suggestion.group2.id);
      
      if (!suggestionsByPrimaryGroup[primaryGroupId]) {
        suggestionsByPrimaryGroup[primaryGroupId] = {
          primaryGroup: composerFilter ? suggestion.group1 : 
                       (suggestion.group1.isAnonymous ? suggestion.group1 : suggestion.group2),
          potentialMatches: []
        };
      }
      
      // Add the comparison group as a potential match
      const matchGroup = composerFilter ? suggestion.group2 : 
                         (suggestion.group1.isAnonymous ? suggestion.group2 : suggestion.group1);
      
      suggestionsByPrimaryGroup[primaryGroupId].potentialMatches.push({
        namedGroup: matchGroup,
        matchScore: suggestion.matchScore,
        confidence: suggestion.confidence,
        factors: suggestion.factors,
        notes: suggestion.notes
      });
    }
    
    // Convert to array and sort each group's matches by score
    for (const primaryGroupId in suggestionsByPrimaryGroup) {
      const groupData = suggestionsByPrimaryGroup[primaryGroupId];
      // Sort matches by score (highest first)
      groupData.potentialMatches.sort((a, b) => b.matchScore - a.matchScore);
      groupedSuggestions.push(groupData);
    }
    
    // Sort primary groups by their best match score
    groupedSuggestions.sort((a, b) => {
      const bestScoreA = a.potentialMatches.length > 0 ? a.potentialMatches[0].matchScore : 0;
      const bestScoreB = b.potentialMatches.length > 0 ? b.potentialMatches[0].matchScore : 0;
      return bestScoreB - bestScoreA;
    });
    
    const totalSuggestions = suggestions.length;
    const stats = {
      totalAnonymousGroups: sourceFilter || composerFilter ? 0 : anonymousGroups.length,
      totalGroups: allGroups.length,
      composerGroups: composerFilter ? anonymousGroups.length : 0,
      sourceGroups: sourceFilter ? anonymousGroups.length : 0,
      suggestionsFound: totalSuggestions,
      groupedSuggestions: groupedSuggestions.length,
      highConfidence: suggestions.filter(s => s.confidence === 'High').length,
      mediumConfidence: suggestions.filter(s => s.confidence === 'Medium').length,
      lowConfidence: suggestions.filter(s => s.confidence === 'Low').length,
      analysisTime: Date.now() - startTime,
      analysisType: sourceFilter ? 'source' : (composerFilter ? 'composer' : 'anonymous')
    };
    
    if (sourceFilter) {
      console.log(`Analysis complete. Found ${totalSuggestions} potential concordances/matches for ${groupedSuggestions.length} source compositions in ${stats.analysisTime}ms`);
    } else if (composerFilter) {
      console.log(`Analysis complete. Found ${totalSuggestions} potential title variations/duplicates for composer in ${stats.analysisTime}ms`);
    } else {
      console.log(`Analysis complete. Found ${totalSuggestions} potential attribution resolutions for ${groupedSuggestions.length} anonymous groups in ${stats.analysisTime}ms`);
    }
    
    res.json({ suggestions: groupedSuggestions, stats });
  } catch (error) {
    console.error('Error generating group suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// Helper function to parse text-based aggregated data back to structured format
function parseGroupData(row) {
  // Parse titles and languages
  const titles = row.composition_titles ? row.composition_titles.split('|||') : [];
  const languages = row.title_languages ? row.title_languages.split('|||') : [];
  
  // Create title-language pairs
  const title_language_pairs = titles.map((title, index) => ({
    text: title,
    language: languages[index] || null
  }));
  
  // Parse composer details
  const composer_details = [];
  if (row.composer_details) {
    const composerStrings = row.composer_details.split('|||');
    for (const composerStr of composerStrings) {
      const [name, from_year, to_year] = composerStr.split('::');
      composer_details.push({
        id: name === 'Anonymous' ? 23 : null, // Simple anonymous detection
        name: name,
        from_year: from_year ? parseInt(from_year) : null,
        to_year: to_year ? parseInt(to_year) : null
      });
    }
  }
  
  // Parse source details with images, clefs, and position
  const source_details = [];
  const source_clefs = [];
  if (row.source_details) {
    const sourceStrings = row.source_details.split('|||');
    for (const sourceStr of sourceStrings) {
      const [title, location, from_year, to_year, code, imagesJson, clefsJson, position] = sourceStr.split('::');
      let images = [];
      let clefs = [];
      
      try {
        if (imagesJson && imagesJson !== '[]') {
          images = JSON.parse(imagesJson);
        }
      } catch (e) {
        console.warn('Failed to parse source images:', e);
      }
      
      try {
        if (clefsJson && clefsJson !== '[]') {
          const parsedClefs = JSON.parse(clefsJson);
          if (Array.isArray(parsedClefs)) {
            clefs = parsedClefs;
          }
        }
      } catch (e) {
        console.warn('Failed to parse source clefs:', e);
      }
      
      source_details.push({
        id: null, // We don't have source IDs in this format
        name: title,
        location: location || null,
        from_year: from_year ? parseInt(from_year) : null,
        to_year: to_year ? parseInt(to_year) : null,
        code: code || null,
        position: position || null,
        images: images
      });
      
      source_clefs.push(clefs);
    }
  }
  
  // Parse composition types
  const composition_types = row.composition_types ? 
    row.composition_types.split('|||').filter(t => t && t !== 'Unknown') : [];
  
  // Parse composition tones
  const composition_tones = row.composition_tones ? 
    row.composition_tones.split('|||') : [];
  
  // Parse composition even/odd
  const composition_even_odd = row.composition_even_odd ? 
    row.composition_even_odd.split('|||').map(eo => {
      if (eo === '0') return 'even';
      if (eo === '1') return 'odd';
      if (eo === '2') return 'both';
      return eo;
    }) : [];
  
  // Parse clef combinations - they come as array of JSON strings
  const parsed_clef_combinations = [];
  if (row.clef_combinations && Array.isArray(row.clef_combinations)) {
    for (const clefString of row.clef_combinations) {
      try {
        if (clefString && clefString !== '[]') {
          const parsed = JSON.parse(clefString);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed_clef_combinations.push(parsed);
          }
        }
      } catch (e) {
        console.warn('Failed to parse clef combination:', e);
      }
    }
  }
  
  return {
    ...row,
    title_language_pairs,
    composer_details,
    source_details,
    source_clefs,
    composition_types,
    composition_tones,
    composition_even_odd,
    clef_combinations: source_clefs, // Use source-specific clefs instead of group-level
    position: row.source_position || null // For source analysis ordering
  };
}

// Helper function to analyze potential matches between two groups
function analyzeGroupMatch(group1, group2) {
  const matchingFactors = [];
  let totalScore = 0;
  
  // 1. Voice count and clef combination analysis (30 points max) - CLEF-FOCUSED
  const voiceScore = analyzeVoices(group1, group2, matchingFactors);
  totalScore += voiceScore;
  
  // 2. Title similarity analysis (25 points max) - STRICTER
  const titleScore = analyzeTitles(group1, group2, matchingFactors);
  totalScore += titleScore;
  
  // 3. Composition properties analysis (25 points max) - NEW
  const propertiesScore = analyzeCompositionProperties(group1, group2, matchingFactors);
  totalScore += propertiesScore;
  
  // 4. Composer attribution analysis (15 points max) - REDUCED
  const composerScore = analyzeComposers(group1, group2, matchingFactors);
  totalScore += composerScore;
  
  // 5. Source geographical and temporal analysis (10 points max) - REDUCED
  const sourceScore = analyzeSources(group1, group2, matchingFactors);
  totalScore += sourceScore;
  
  // 6. Inclusion notes similarity (5 points max) - REDUCED
  const notesScore = analyzeInclusionNotes(group1, group2, matchingFactors);
  totalScore += notesScore;
  
  // Cap the total score at 100
  const finalScore = Math.min(Math.round(totalScore), 100);
  
  return {
    totalScore: finalScore,
    factors: matchingFactors
  };
}

function analyzeVoices(group1, group2, factors) {
  let score = 0;
  
  // Voice count must match (prerequisite, not scoring factor)
  if (!group1.voice_count || !group2.voice_count || group1.voice_count !== group2.voice_count) {
    return 0; // No points if voice counts don't match
  }
  
  // NO POINTS for matching voice count - it's a prerequisite only
  
  // CLEF COMBINATION IS THE MAIN FACTOR (up to 30 points) - STRICT BLACK AND WHITE APPROACH
  if (group1.clef_combinations && group2.clef_combinations && 
      group1.clef_combinations.length > 0 && group2.clef_combinations.length > 0) {
    
    // Parse and normalize clef combinations, handling optional clefs
    const parseClefCombination = (clefCombo) => {
      try {
        const parsed = typeof clefCombo === 'string' ? JSON.parse(clefCombo) : clefCombo;
        if (Array.isArray(parsed)) {
          return parsed.map(clef => {
            if (typeof clef === 'string') return clef;
            if (clef && clef.clef) return clef.clef;
            return String(clef);
          });
        }
        return [];
      } catch (e) {
        return [];
      }
    };
    
    const clefs1 = group1.clef_combinations.flatMap(parseClefCombination).filter(Boolean);
    const clefs2 = group2.clef_combinations.flatMap(parseClefCombination).filter(Boolean);
    
    // Separate optional clefs (if marked - this would need database schema update)
    // For now, treat all clefs as required
    const requiredClefs1 = new Set(clefs1);
    const requiredClefs2 = new Set(clefs2);
    
    // BLACK AND WHITE APPROACH:
    if (requiredClefs1.size === requiredClefs2.size && 
        [...requiredClefs1].every(clef => requiredClefs2.has(clef))) {
      
      // EXACT MATCH - Full 30 points
      score += 30;
      factors.push({
        description: `Identical clef combinations: [${[...requiredClefs1].sort().join(', ')}]`,
        score: 30,
        strength: 'strong',
        clefData: {
          group1Clefs: [...requiredClefs1].sort(),
          group2Clefs: [...requiredClefs2].sort(),
          match: 'exact'
        }
      });
      
    } else {
      // ANY DIFFERENCE - Severely penalized (max 5 points for partial overlap)
      const intersection = new Set([...requiredClefs1].filter(clef => requiredClefs2.has(clef)));
      
      if (intersection.size > 0) {
        const overlapRatio = intersection.size / Math.max(requiredClefs1.size, requiredClefs2.size);
        const clefScore = Math.min(Math.round(overlapRatio * 5), 5);
        
        score += clefScore;
        factors.push({
          description: `Partial clef overlap: ${intersection.size}/${Math.max(requiredClefs1.size, requiredClefs2.size)} clefs match - likely different works`,
          score: clefScore,
          strength: 'weak',
          clefData: {
            group1Clefs: [...requiredClefs1].sort(),
            group2Clefs: [...requiredClefs2].sort(),
            overlap: [...intersection].sort(),
            match: 'partial'
          }
        });
      } else {
        // No clef overlap - negative score
        score -= 5;
        factors.push({
          description: `No clef overlap: [${[...requiredClefs1].sort().join(', ')}] vs [${[...requiredClefs2].sort().join(', ')}] - different works`,
          score: -5,
          strength: 'strong',
          clefData: {
            group1Clefs: [...requiredClefs1].sort(),
            group2Clefs: [...requiredClefs2].sort(),
            match: 'none'
          }
        });
      }
    }
  }
  
  return score;
}

function analyzeTitles(group1, group2, factors) {
  let score = 0;
  
  if (!group1.title_language_pairs || !group2.title_language_pairs) {
    return 0;
  }
  
  const titlePairs1 = group1.title_language_pairs || [];
  const titlePairs2 = group2.title_language_pairs || [];
  
  // Extract just the titles for backward compatibility
  const titles1 = titlePairs1.map(pair => pair.text);
  const titles2 = titlePairs2.map(pair => pair.text);
  
  // Initialize variables at function scope
  let bestSimilarity = 0;
  let bestMatch = null;
  
  // SIMPLIFIED TITLE MATCHING FOR PERFORMANCE
  
  // 1. Exact title match (very high score)
  const exactMatches = titles1.filter(t1 => 
    titles2.some(t2 => t1.toLowerCase().trim() === t2.toLowerCase().trim())
  );
  
  if (exactMatches.length > 0) {
    score += 25;
    factors.push({
      description: `Exact title match: "${exactMatches[0]}"`,
      score: 25,
      strength: 'strong'
    });
  } else {
    // 2. Check for "starts with" relationships (e.g., "Missa" -> "Missa Sine nomine")
    let startsWithMatch = null;
    for (const title1 of titles1) {
      for (const title2 of titles2) {
        const t1_clean = title1.toLowerCase().trim();
        const t2_clean = title2.toLowerCase().trim();
        
        if (t1_clean.length >= 4 && t2_clean.startsWith(t1_clean)) {
          startsWithMatch = { shorter: title1, longer: title2 };
          break;
        } else if (t2_clean.length >= 4 && t1_clean.startsWith(t2_clean)) {
          startsWithMatch = { shorter: title2, longer: title1 };
          break;
        }
      }
      if (startsWithMatch) break;
    }
    
    if (startsWithMatch) {
      score += 18;
      factors.push({
        description: `Title extension match: "${startsWithMatch.shorter}" extends to "${startsWithMatch.longer}"`,
        score: 18,
        strength: 'strong'
      });
    } else {
    // MUCH STRICTER fuzzy title matching
    let isPotentialTranslation = false;
    
    for (const pair1 of titlePairs1) {
      for (const pair2 of titlePairs2) {
        // Check for substantial word overlap (stricter requirement)
        const wordOverlap = calculateWordOverlap(pair1.text, pair2.text);
        const similarity = calculateTitleSimilarity(pair1.text, pair2.text);
        
        // Require at least 2 common words for longer titles, but allow 1 for very short titles
        const title1Words = pair1.text.split(' ').length;
        const title2Words = pair2.text.split(' ').length;
        const avgTitleLength = (title1Words + title2Words) / 2;
        const minCommonWords = avgTitleLength <= 3 ? 1 : 2;
        
        if (similarity > bestSimilarity && wordOverlap.commonWords >= minCommonWords) {
          bestSimilarity = similarity;
          bestMatch = { 
            title1: pair1.text, 
            title2: pair2.text, 
            lang1: pair1.language, 
            lang2: pair2.language,
            wordOverlap: wordOverlap
          };
          
          // Check if this might be a translation (different languages, high similarity)
          isPotentialTranslation = pair1.language && pair2.language && 
            pair1.language !== pair2.language && 
            similarity >= 0.85 && wordOverlap.commonWords >= 3;
        }
      }
    }
    
    // MUCH STRICTER thresholds with length-based weighting
    if (bestSimilarity >= 0.85 && bestMatch.wordOverlap.commonWords >= 3) {
      let similarityScore = Math.round(bestSimilarity * 20);
      
      // Length-based weighting: longer common words get bonus points
      const avgCommonWordLength = bestMatch.wordOverlap.overlap.reduce((sum, word) => sum + word.length, 0) / bestMatch.wordOverlap.overlap.length;
      const lengthBonus = avgCommonWordLength >= 6 ? 3 : (avgCommonWordLength >= 4 ? 1 : 0);
      
      // More words = higher bonus
      const wordCountBonus = Math.min((bestMatch.wordOverlap.commonWords - 2) * 2, 5);
      
      // Bonus for potential translations/contrafacta
      if (isPotentialTranslation) {
        const translationBonus = 5;
        score += similarityScore + translationBonus + lengthBonus + wordCountBonus;
        
        factors.push({
          description: `Potential translation/contrafactum: "${bestMatch.title1}" ≈ "${bestMatch.title2}" (${bestMatch.wordOverlap.commonWords} common words, avg length ${Math.round(avgCommonWordLength)})`,
          score: similarityScore + translationBonus + lengthBonus + wordCountBonus,
          strength: 'strong'
        });
      } else {
        score += similarityScore + lengthBonus + wordCountBonus;
        factors.push({
          description: `Very similar titles: "${bestMatch.title1}" ≈ "${bestMatch.title2}" (${bestMatch.wordOverlap.commonWords} common words, avg length ${Math.round(avgCommonWordLength)}, ${Math.round(bestSimilarity * 100)}% similarity)`,
          score: similarityScore + lengthBonus + wordCountBonus,
          strength: bestSimilarity >= 0.9 ? 'strong' : 'medium'
        });
      }
    } else if (bestSimilarity >= 0.85 && bestMatch.wordOverlap.commonWords >= 2) {
      // Still high similarity but fewer words - require longer titles to qualify
      const title1Length = bestMatch.title1.split(' ').length;
      const title2Length = bestMatch.title2.split(' ').length;
      const avgTitleLength = (title1Length + title2Length) / 2;
      
      if (avgTitleLength <= 4) { // Short titles can match with 2 words
        const similarityScore = Math.round(bestSimilarity * 12);
        score += similarityScore;
        factors.push({
          description: `Similar short titles: "${bestMatch.title1}" ≈ "${bestMatch.title2}" (${bestMatch.wordOverlap.commonWords} common words)`,
          score: similarityScore,
          strength: 'medium'
        });
      }
    }
    }
  }
  
  return score;
}

function analyzeComposers(group1, group2, factors) {
  let score = 0;
  
  const composers1 = group1.composer_details || [];
  const composers2 = group2.composer_details || [];
  
  // Check if groups have anonymous compositions
  const hasAnon1 = composers1.some(c => c.id === 23);
  const hasAnon2 = composers2.some(c => c.id === 23);
  
  // Get named composers (excluding anonymous)
  const named1 = composers1.filter(c => c.id !== 23);
  const named2 = composers2.filter(c => c.id !== 23);
  
  if (hasAnon1 && !hasAnon2) {
    // Anonymous vs named - excellent for attribution resolution
    score += 12;
    const namedComposer = named2.length > 0 ? named2[0].name : 'Named composer';
    factors.push({
      description: `Anonymous vs. named (${namedComposer}) - potential attribution resolution`,
      score: 12,
      strength: 'strong'
    });
  } else if (!hasAnon1 && hasAnon2) {
    // Named vs anonymous - excellent for attribution resolution
    score += 12;
    const namedComposer = named1.length > 0 ? named1[0].name : 'Named composer';
    factors.push({
      description: `Named (${namedComposer}) vs. anonymous - potential attribution resolution`,
      score: 12,
      strength: 'strong'
    });
  } else if (hasAnon1 && hasAnon2) {
    // Both anonymous - this gives no useful attribution information, so no points
    // The fact that both are anonymous is not evidence they are the same work
    // In fact, it slightly reduces confidence since we can't use attribution to help
    score -= 2;
    factors.push({
      description: 'Both compositions anonymous - no attribution evidence available',
      score: -2,
      strength: 'weak'
    });
  } else if (named1.length > 0 && named2.length > 0) {
    // Both have named composers
    if (named1[0].name === named2[0].name) {
      // Same composer - this suggests we may have miscatalogued or have similar works by same composer
      // Score lower since it's more likely to be different compositions by same composer
      score += 3;
      factors.push({
        description: `Same composer (${named1[0].name}) - likely different compositions or cataloguing issue`,
        score: 3,
        strength: 'weak'
      });
    } else {
      // Different named composers - check chronological compatibility
      const areChronologicallyCompatible = checkComposerChronology(named1, named2);
      
      if (areChronologicallyCompatible === false) {
        score -= 8;
        factors.push({
          description: 'Chronologically incompatible composers (different eras)',
          score: -8,
          strength: 'medium'
        });
      } else if (areChronologicallyCompatible === true) {
        score += 5;
        factors.push({
          description: `Contemporary composers with different attributions - potential misattribution case`,
          score: 5,
          strength: 'medium'
        });
      }
    }
  }
  
  return Math.max(score, 0);
}

function analyzeSources(group1, group2, factors) {
  let score = 0;
  
  if (!group1.source_details || !group2.source_details) {
    return 0;
  }
  
  const sources1 = group1.source_details;
  const sources2 = group2.source_details;
  
  // Check for geographical proximity (reduced weight)
  const locations1 = sources1.map(s => s.location).filter(Boolean);
  const locations2 = sources2.map(s => s.location).filter(Boolean);
  
  const commonLocations = locations1.filter(loc => 
    locations2.some(loc2 => loc2 && loc.toLowerCase() === loc2.toLowerCase())
  );
  
  if (commonLocations.length > 0) {
    score += 3; // Reduced from 8 to 3
    factors.push({
      description: `Same geographical area: ${commonLocations[0]} (interesting but not strong evidence)`,
      score: 3,
      strength: 'weak'
    });
  }
  
  // ELIMINATION CHECK: Composer birth vs source dates
  // This will be implemented at the group comparison level to eliminate impossible matches
  
  return score;
}

function analyzeInclusionNotes(group1, group2, factors) {
  let score = 0;
  
  if (!group1.inclusion_notes || !group2.inclusion_notes) {
    return 0;
  }
  
  const notes1 = group1.inclusion_notes.toLowerCase();
  const notes2 = group2.inclusion_notes.toLowerCase();
  
  // Look for common significant words (ignoring common stopwords)
  const stopwords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an']);
  
  const words1 = notes1.split(/\W+/).filter(w => w.length > 3 && !stopwords.has(w));
  const words2 = notes2.split(/\W+/).filter(w => w.length > 3 && !stopwords.has(w));
  
  if (words1.length > 0 && words2.length > 0) {
    const commonWords = words1.filter(w => words2.includes(w));
    
    if (commonWords.length >= 2) {
      score += Math.min(commonWords.length * 2, 5);
      factors.push({
        description: `Similar inclusion notes (${commonWords.length} common terms): "${group1.inclusion_notes.substring(0, 100)}${group1.inclusion_notes.length > 100 ? '...' : ''}" vs "${group2.inclusion_notes.substring(0, 100)}${group2.inclusion_notes.length > 100 ? '...' : ''}"`,
        score: Math.min(commonWords.length * 2, 5),
        strength: 'weak',
        notes1: group1.inclusion_notes,
        notes2: group2.inclusion_notes
      });
    }
  }
  
  return score;
}

function calculateTitleSimilarity(title1, title2) {
  if (!title1 || !title2) return 0;
  
  // Normalize titles for comparison
  const normalize = (title) => {
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim()
      // Historical character substitutions
      .replace(/[ij]/g, 'i')   // i/j interchangeability
      .replace(/[uv]/g, 'u');  // u/v interchangeability
  };
  
  const norm1 = normalize(title1);
  const norm2 = normalize(title2);
  
  if (norm1 === norm2) return 1.0;
  
  // Calculate Levenshtein distance ratio
  const distance = levenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);
  
  if (maxLength === 0) return 0;
  
  return 1 - (distance / maxLength);
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function datesOverlap(date1, date2) {
  // Handle cases where we only have partial date information
  const start1 = date1.from || date1.to || 0;
  const end1 = date1.to || date1.from || 9999;
  const start2 = date2.from || date2.to || 0;
  const end2 = date2.to || date2.from || 9999;
  
  // Allow for 50-year overlap window to account for manuscript copying periods
  const buffer = 50;
  
  return (start1 <= end2 + buffer) && (start2 <= end1 + buffer);
}

function generateMatchNotes(group1, group2, score) {
  if (score >= 80) {
    return 'Very high confidence match. Likely duplicates or closely related compositions that should be reviewed for potential merging.';
  } else if (score >= 60) {
    return 'Moderate confidence match. These compositions share several characteristics and may represent the same work in different sources.';
  } else if (score >= 40) {
    return 'Possible relationship. Worth investigating further, especially if resolving anonymous attributions.';
  } else {
    return 'Weak similarity. May share some characteristics but likely different compositions.';
  }
}

// Helper function to check if composers are chronologically compatible
function checkComposerChronology(composerDetails1, composerDetails2) {
  if (!composerDetails1 || !composerDetails2) {
    return null; // Insufficient data
  }
  
  // Extract composers (excluding anonymous - ID 23)
  const composers1 = composerDetails1.filter(c => c.id !== 23);
  const composers2 = composerDetails2.filter(c => c.id !== 23);
  
  if (composers1.length === 0 || composers2.length === 0) {
    return null; // No named composers to compare
  }
  
  // For each composer in group1, check compatibility with composers in group2
  for (const comp1 of composers1) {
    for (const comp2 of composers2) {
      // If either composer lacks date information, we can't determine compatibility
      if (!comp1.from_year || !comp1.to_year || !comp2.from_year || !comp2.to_year) {
        continue;
      }
      
      // Check if their lifespans overlap or are within 10 years of each other
      const comp1Start = comp1.from_year;
      const comp1End = comp1.to_year;
      const comp2Start = comp2.from_year;
      const comp2End = comp2.to_year;
      
      // Allow 10-year buffer on either side for potential misattributions
      const buffer = 10;
      
      // Check if lifespans overlap or are close enough
      const compatible = (comp1Start <= comp2End + buffer) && (comp2Start <= comp1End + buffer);
      
      if (compatible) {
        return true; // Found at least one compatible pair
      } else {
        // If we find a clearly incompatible pair (more than 10 years apart), that's evidence against
        const gap = Math.min(
          Math.abs(comp1Start - comp2End),
          Math.abs(comp2Start - comp1End)
        );
        
        if (gap > 20) { // Significant chronological gap
          return false;
        }
      }
    }
  }
  
  // If we get here, we had date data but couldn't determine clear compatibility
  return null;
}

// Helper function to find cross-language title matches for translation detection
function findCrossLanguageMatches(group1, group2) {
  const matches = [];
  
  if (!group1.title_language_pairs || !group2.title_language_pairs) {
    return matches;
  }
  
  const titlePairs1 = group1.title_language_pairs || [];
  const titlePairs2 = group2.title_language_pairs || [];
  
  // Check each title in group1 against each title in group2
  for (const pair1 of titlePairs1) {
    for (const pair2 of titlePairs2) {
      // Different languages but similar titles
      if (pair1.language && pair2.language && pair1.language !== pair2.language) {
        const similarity = calculateTitleSimilarity(pair1.text, pair2.text);
        
        // Lower threshold for cross-language matches since they're inherently valuable
        if (similarity >= 0.6) {
          matches.push({
            title1: pair1.text,
            title2: pair2.text,
            lang1: pair1.language,
            lang2: pair2.language,
            similarity
          });
        }
      }
    }
  }
  
  // Return the best match if any
  if (matches.length > 0) {
    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 1);
  }
  
  return matches;
}

// Helper function for quick pre-filtering - MUCH STRICTER
function hasQuickTitleOverlap(group1, group2) {
  if (!group1.title_language_pairs || !group2.title_language_pairs) {
    return false;
  }
  
  const titles1 = group1.title_language_pairs.map(p => p.text);
  const titles2 = group2.title_language_pairs.map(p => p.text);
  
  // Check for meaningful word overlap (stricter pre-filter)
  for (const title1 of titles1) {
    for (const title2 of titles2) {
      // Exact match
      if (title1.toLowerCase().trim() === title2.toLowerCase().trim()) {
        return true;
      }
      
      // Check for substantial word overlap
      const wordOverlap = calculateWordOverlap(title1, title2);
      if (wordOverlap.commonWords >= 2) {
        return true;
      }
      
      // For very short titles, allow single meaningful word match
      if (wordOverlap.words1.length <= 2 && wordOverlap.words2.length <= 2 && 
          wordOverlap.commonWords >= 1 && wordOverlap.overlap[0].length >= 4) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function to determine confidence level based on match score
function getConfidenceLevel(score) {
  if (score >= 50) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

function analyzeCompositionProperties(group1, group2, factors) {
  let score = 0;
  
  // Tone mapping for display (same as frontend)
  const toneMapping = {
    "1": "primi toni",
    "2": "secundi toni",
    "3": "tertii toni",
    "4": "quarti toni",
    "5": "quinti toni",
    "6": "sexti toni",
    "7": "septimi toni",
    "8": "octavi toni",
    "9": "noni toni",
    "12": "duodecimi toni",
    "mix": "mixti toni",
    "per": "peregrini toni",
    "pro": "proprii toni"
  };
  
  // Use the directly parsed composition data
  const types1 = group1.composition_types || [];
  const types2 = group2.composition_types || [];
  const tones1 = group1.composition_tones || [];
  const tones2 = group2.composition_tones || [];
  
  // COMPOSITION TYPE ANALYSIS (up to 12 points)
  if (types1.length > 0 && types2.length > 0) {
    const type1Set = new Set(types1);
    const type2Set = new Set(types2);
    const commonTypes = [...type1Set].filter(t => type2Set.has(t));
    
    if (commonTypes.length > 0) {
      score += 12;
      factors.push({
        description: `Same composition type: ${commonTypes.join(', ')}`,
        score: 12,
        strength: 'strong'
      });
    }
  }
  
  // TONE ANALYSIS (up to 10 points)
  if (tones1.length > 0 && tones2.length > 0) {
    const tone1Set = new Set(tones1);
    const tone2Set = new Set(tones2);
    const commonTones = [...tone1Set].filter(t => tone2Set.has(t));
    
    if (commonTones.length > 0) {
      // Format tones for display using the mapping
      const displayTones = commonTones.map(tone => toneMapping[tone] || tone);
      score += 10;
      factors.push({
        description: `Same musical tone/mode: ${displayTones.join(', ')}`,
        score: 10,
        strength: 'strong'
      });
    }
  }
  
  // EVEN/ODD ANALYSIS (up to 3 points)
  const evenOddMapping = {
    0: "pares",
    1: "impares", 
    2: "pares et impares"
  };
  
  const evenOdd1 = group1.composition_even_odd || [];
  const evenOdd2 = group2.composition_even_odd || [];
  
  if (evenOdd1.length > 0 && evenOdd2.length > 0) {
    const eo1Set = new Set(evenOdd1);
    const eo2Set = new Set(evenOdd2);
    const commonEvenOdd = [...eo1Set].filter(eo => eo2Set.has(eo));
    
    if (commonEvenOdd.length > 0) {
      // Format even/odd for display using the mapping
      const displayEvenOdd = commonEvenOdd.map(eo => evenOddMapping[eo] || eo);
      score += 3;
      factors.push({
        description: `Same even/odd: ${displayEvenOdd.join(', ')}`,
        score: 3,
        strength: 'weak'
      });
    }
  }
  
  return score;
}

// Helper function to calculate meaningful word overlap between titles
function calculateWordOverlap(title1, title2) {
  if (!title1 || !title2) return { commonWords: 0, words1: [], words2: [], overlap: [] };
  
  // Normalize and split into words
  const normalize = (title) => {
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim()
      // Historical character substitutions
      .replace(/[ij]/g, 'i')   // i/j interchangeability
      .replace(/[uv]/g, 'u');  // u/v interchangeability
  };
  
  const words1 = normalize(title1).split(' ').filter(w => w.length > 2); // Ignore very short words
  const words2 = normalize(title2).split(' ').filter(w => w.length > 2);
  
  // Find common words (excluding very common Latin/music terms that don't add meaning)
  const stopwords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an', 'de', 'la', 'le', 'il', 'del', 'della', 'von', 'van', 'da', 'di']);
  
  const meaningfulWords1 = words1.filter(w => !stopwords.has(w));
  const meaningfulWords2 = words2.filter(w => !stopwords.has(w));
  
  const overlap = meaningfulWords1.filter(w => meaningfulWords2.includes(w));
  
  return {
    commonWords: overlap.length,
    words1: meaningfulWords1,
    words2: meaningfulWords2,
    overlap: overlap
  };
}

// Helper function to check for conflicting composition properties
function hasConflictingProperties(group1, group2) {
  // STRICT PREREQUISITE: Check composition types - MUST match if both have values
  const types1 = new Set(group1.composition_types || []);
  const types2 = new Set(group2.composition_types || []);
  
  if (types1.size > 0 && types2.size > 0) {
    const hasCommonType = [...types1].some(t => types2.has(t));
    if (!hasCommonType) {
      return true; // Different types = different works (PREREQUISITE)
    }
  }
  
  // Check tones (modes) - only reject if both have values that don't match
  const tones1 = new Set(group1.composition_tones || []);
  const tones2 = new Set(group2.composition_tones || []);
  
  if (tones1.size > 0 && tones2.size > 0) {
    const hasCommonTone = [...tones1].some(t => tones2.has(t));
    if (!hasCommonTone) {
      return true; // Different modes = different works
    }
  }
  
  // Check even/odd - only reject if both have values that don't match
  const evenOdd1 = new Set(group1.composition_even_odd || []);
  const evenOdd2 = new Set(group2.composition_even_odd || []);
  
  if (evenOdd1.size > 0 && evenOdd2.size > 0) {
    const hasCommonEvenOdd = [...evenOdd1].some(eo => evenOdd2.has(eo));
    if (!hasCommonEvenOdd) {
      return true; // Different even/odd = different works
    }
  }
  
  // CRITICAL ELIMINATION: Check composer birth dates vs source dates
  const composers1 = group1.composer_details || [];
  const composers2 = group2.composer_details || [];
  const sources1 = group1.source_details || [];
  const sources2 = group2.source_details || [];
  
  // Check if any composer from group1 was born after sources in group2
  for (const composer of composers1) {
    if (composer.from_year && composer.id !== 23) { // Skip anonymous
      for (const source of sources2) {
        if (source.to_year && composer.from_year > source.to_year + 10) {
          return true; // Composer born after source was created - impossible match
        }
      }
    }
  }
  
  // Check if any composer from group2 was born after sources in group1
  for (const composer of composers2) {
    if (composer.from_year && composer.id !== 23) { // Skip anonymous
      for (const source of sources1) {
        if (source.to_year && composer.from_year > source.to_year + 10) {
          return true; // Composer born after source was created - impossible match
        }
      }
    }
  }
  
  return false; // No conflicts found
}

// POST /flag-suggestion - Flag a suggestion as "not the same"
router.post('/flag-suggestion', requireAdmin, async (req, res) => {
  try {
    const { group1_id, group2_id, flag_type = 'not_same' } = req.body;
    
    if (!group1_id || !group2_id) {
      return res.status(400).json({ error: 'Both group1_id and group2_id are required' });
    }
    
    const userId = req.user.id;
    
    // Insert flag (ignore if already exists due to UNIQUE constraint)
    const insertQuery = `
      INSERT INTO suggestion_flags (group1_id, group2_id, flag_type, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (group1_id, group2_id, flag_type) DO NOTHING
      RETURNING id;
    `;
    
    const result = await client.query(insertQuery, [group1_id, group2_id, flag_type, userId]);
    
    res.json({ 
      success: true, 
      flagged: result.rows.length > 0,
      message: result.rows.length > 0 ? 'Suggestion flagged successfully' : 'Suggestion was already flagged'
    });
    
  } catch (error) {
    console.error('Error flagging suggestion:', error);
    res.status(500).json({ error: 'Failed to flag suggestion' });
  }
});

export default router; 