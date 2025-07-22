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

// GET /group-suggestions - Generate composition merge suggestions
router.get('/group-suggestions', requireAdmin, async (req, res) => {
  try {
    console.log('Starting group suggestions analysis...');
    const startTime = Date.now();
    
    // Get voice count filter from query parameter
    const { voices } = req.query;
    const voiceFilter = voices ? parseInt(voices) : null;
    
    if (voiceFilter) {
      console.log(`Filtering analysis to ${voiceFilter}-voice compositions only`);
    }
    
    // Query to get Anonymous groups (groups containing anonymous compositions)
    const anonymousGroupsQuery = `
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
             SELECT array_agg(i.clefs) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
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
             SELECT string_agg(t.language, '|||') FILTER (WHERE t.language IS NOT NULL)
             FROM compositions c2
             JOIN titles t ON c2.title_id = t.id
             WHERE c2.group_id = g.id
           ) as title_languages,
           
           -- Get tone information
           (
             SELECT array_agg(c2.tone) FILTER (WHERE c2.tone IS NOT NULL)
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
           
           -- Get source information as text aggregation
           (
             SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, ''), '|||')
             FILTER (WHERE s.id IS NOT NULL)
             FROM compositions c2
             JOIN inclusions i ON c2.id = i.composition_id
             JOIN sources s ON i.source_id = s.id
             WHERE c2.group_id = g.id
           ) as source_details,
           
           -- Get inclusion notes for text analysis
           (
             SELECT string_agg(i.notes, ' ') FILTER (WHERE i.notes IS NOT NULL AND i.notes != '')
             FROM compositions c2
             JOIN inclusions i ON c2.id = i.composition_id
             WHERE c2.group_id = g.id
           ) as inclusion_notes
           
         FROM groups g
         WHERE EXISTS (
           -- Group contains at least one anonymous composition
           SELECT 1 FROM compositions c 
           WHERE c.group_id = g.id 
           AND c.composer_id_list IS NOT NULL 
           AND 23 = ANY(c.composer_id_list)
           ${voiceFilter ? `AND c.number_of_voices = ${voiceFilter}` : ''}
         )
         ORDER BY g.id
       )
       SELECT * FROM anonymousGroups 
       WHERE voice_count IS NOT NULL 
         AND composition_titles IS NOT NULL 
         AND composer_details IS NOT NULL
         ${voiceFilter ? `AND voice_count = ${voiceFilter}` : ''}
       ORDER BY voice_count, id;
     `;
     
     // Query to get ALL other groups (potential matches for anonymous groups)
     const allGroupsQuery = `
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
              SELECT array_agg(i.clefs) FILTER (WHERE i.clefs IS NOT NULL AND i.clefs != '[]')
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
              SELECT string_agg(t.language, '|||') FILTER (WHERE t.language IS NOT NULL)
              FROM compositions c2
              JOIN titles t ON c2.title_id = t.id
              WHERE c2.group_id = g.id
            ) as title_languages,
            
            -- Get tone information
            (
              SELECT array_agg(c2.tone) FILTER (WHERE c2.tone IS NOT NULL)
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
            
            -- Get source information as text aggregation
            (
              SELECT string_agg(s.title || '::' || COALESCE(s.town, '') || '::' || COALESCE(s.from_year::text, '') || '::' || COALESCE(s.to_year::text, ''), '|||')
              FILTER (WHERE s.id IS NOT NULL)
              FROM compositions c2
              JOIN inclusions i ON c2.id = i.composition_id
              JOIN sources s ON i.source_id = s.id
              WHERE c2.group_id = g.id
            ) as source_details,
            
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
           ${voiceFilter ? `AND c.number_of_voices = ${voiceFilter}` : ''}
         )
         ORDER BY g.id
       )
       SELECT * FROM allGroups 
       WHERE voice_count IS NOT NULL 
         AND composition_titles IS NOT NULL 
         AND composer_details IS NOT NULL
         ${voiceFilter ? `AND voice_count = ${voiceFilter}` : ''}
       ORDER BY voice_count, id;
     `;

    // Execute both queries
    const [anonymousResult, allGroupsResult] = await Promise.all([
      pool.query(anonymousGroupsQuery),
      pool.query(allGroupsQuery)
    ]);
    
    const anonymousGroups = anonymousResult.rows.map(parseGroupData);
    const allGroups = allGroupsResult.rows.map(parseGroupData);
    
    console.log(`Loaded ${anonymousGroups.length} anonymous groups and ${allGroups.length} total groups for comparison`);
    
    if (anonymousGroups.length === 0) {
      return res.json({
        suggestions: [],
        stats: {
          totalAnonymousGroups: 0,
          totalGroups: allGroups.length,
          suggestionsFound: 0,
          highConfidence: 0,
          mediumConfidence: 0,
          lowConfidence: 0,
          analysisTime: Date.now() - startTime
        }
      });
    }
    
    const suggestions = [];
    const maxSuggestions = 500; // Increased since we're being more targeted
    
    // Group both sets by voice count for efficient comparison
    const anonymousByVoices = {};
    const allGroupsByVoices = {};
    
    for (const group of anonymousGroups) {
      const voices = group.voice_count;
      if (!anonymousByVoices[voices]) {
        anonymousByVoices[voices] = [];
      }
      anonymousByVoices[voices].push(group);
    }
    
    for (const group of allGroups) {
      const voices = group.voice_count;
      if (!allGroupsByVoices[voices]) {
        allGroupsByVoices[voices] = [];
      }
      allGroupsByVoices[voices].push(group);
    }
    
    // Compare anonymous groups against all groups with same voice count
    for (const [voiceCount, anonGroups] of Object.entries(anonymousByVoices)) {
      const compareGroups = allGroupsByVoices[voiceCount] || [];
      
      if (compareGroups.length === 0) continue;
      
      console.log(`Analyzing ${anonGroups.length} anonymous groups against ${compareGroups.length} total groups with ${voiceCount} voices`);
      
      for (const anonGroup of anonGroups) {
        if (suggestions.length >= maxSuggestions) break;
        
        for (const compareGroup of compareGroups) {
          if (suggestions.length >= maxSuggestions) break;
          
          // Don't compare group to itself
          if (anonGroup.id === compareGroup.id) continue;
          
          // Quick pre-filter: skip if no title overlap potential
          if (!hasQuickTitleOverlap(anonGroup, compareGroup)) continue;
          
          const matchResult = analyzeGroupMatch(anonGroup, compareGroup);
          
          // Lower threshold for anonymous matches since they're inherently valuable
          if (matchResult.totalScore >= 12) {
            suggestions.push({
              group1: {
                id: anonGroup.id,
                name: anonGroup.display_title,
                voice_count: anonGroup.voice_count,
                titles: anonGroup.title_language_pairs?.map(p => p.text) || [],
                composers: anonGroup.composer_details?.map(c => c.name) || [],
                isAnonymous: true
              },
              group2: {
                id: compareGroup.id,
                name: compareGroup.display_title,
                voice_count: compareGroup.voice_count,
                titles: compareGroup.title_language_pairs?.map(p => p.text) || [],
                composers: compareGroup.composer_details?.map(c => c.name) || [],
                isAnonymous: false
              },
              matchScore: matchResult.totalScore,
              confidence: getConfidenceLevel(matchResult.totalScore),
              factors: matchResult.factors,
              notes: generateMatchNotes(anonGroup, compareGroup, matchResult.totalScore),
              potentialAttribution: true // Flag this as potential attribution resolution
            });
          }
        }
      }
    }
    
    // Sort by score and limit results
    suggestions.sort((a, b) => b.matchScore - a.matchScore);
    
    const stats = {
      totalAnonymousGroups: anonymousGroups.length,
      totalGroups: allGroups.length,
      suggestionsFound: suggestions.length,
      highConfidence: suggestions.filter(s => s.confidence === 'High').length,
      mediumConfidence: suggestions.filter(s => s.confidence === 'Medium').length,
      lowConfidence: suggestions.filter(s => s.confidence === 'Low').length,
      analysisTime: Date.now() - startTime
    };
    
    console.log(`Analysis complete. Found ${suggestions.length} potential attribution resolutions in ${stats.analysisTime}ms`);
    
    res.json({ suggestions, stats });
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
  
  // Parse source details
  const source_details = [];
  if (row.source_details) {
    const sourceStrings = row.source_details.split('|||');
    for (const sourceStr of sourceStrings) {
      const [title, location, from_year, to_year] = sourceStr.split('::');
      source_details.push({
        id: null, // We don't have source IDs in this format
        name: title,
        location: location || null,
        from_year: from_year ? parseInt(from_year) : null,
        to_year: to_year ? parseInt(to_year) : null
      });
    }
  }
  
  return {
    ...row,
    title_language_pairs,
    composer_details,
    source_details
  };
}

// Helper function to analyze potential matches between two groups
function analyzeGroupMatch(group1, group2) {
  const matchingFactors = [];
  let totalScore = 0;
  
  // 1. Voice count and clef combination analysis (25 points max)
  const voiceScore = analyzeVoices(group1, group2, matchingFactors);
  totalScore += voiceScore;
  
  // 2. Title similarity analysis (30 points max)
  const titleScore = analyzeTitles(group1, group2, matchingFactors);
  totalScore += titleScore;
  
  // 3. Composer attribution analysis (20 points max)
  const composerScore = analyzeComposers(group1, group2, matchingFactors);
  totalScore += composerScore;
  
  // 4. Source geographical and temporal analysis (15 points max)
  const sourceScore = analyzeSources(group1, group2, matchingFactors);
  totalScore += sourceScore;
  
  // 5. Inclusion notes similarity (10 points max)
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
  
  // Exact voice count match (high value)
  if (group1.voice_count && group2.voice_count && group1.voice_count === group2.voice_count) {
    score += 15;
    factors.push({
      description: `Same voice count (${group1.voice_count})`,
      score: 15,
      strength: 'strong'
    });
    
    // Bonus for clef combination similarity
    if (group1.clef_combinations && group2.clef_combinations) {
      const clef1Set = new Set(group1.clef_combinations.map(c => JSON.stringify(c)));
      const clef2Set = new Set(group2.clef_combinations.map(c => JSON.stringify(c)));
      
      const intersection = new Set([...clef1Set].filter(x => clef2Set.has(x)));
      const union = new Set([...clef1Set, ...clef2Set]);
      
      if (intersection.size > 0 && union.size > 0) {
        const similarity = intersection.size / union.size;
        if (similarity >= 0.5) {
          const bonusScore = Math.round(similarity * 10);
          score += bonusScore;
          factors.push({
            description: `Similar clef combinations (${Math.round(similarity * 100)}% overlap)`,
            score: bonusScore,
            strength: similarity >= 0.8 ? 'strong' : 'medium'
          });
        }
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
  
  // Exact title match (very high score)
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
    // Enhanced fuzzy title matching with translation/contrafacta detection
    let isPotentialTranslation = false;
    
    for (const pair1 of titlePairs1) {
      for (const pair2 of titlePairs2) {
        const similarity = calculateTitleSimilarity(pair1.text, pair2.text);
        
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = { 
            title1: pair1.text, 
            title2: pair2.text, 
            lang1: pair1.language, 
            lang2: pair2.language 
          };
          
          // Check if this might be a translation (different languages, high similarity)
          isPotentialTranslation = pair1.language && pair2.language && 
            pair1.language !== pair2.language && 
            similarity >= 0.75;
        }
      }
    }
    
    if (bestSimilarity >= 0.7) {
      let similarityScore = Math.round(bestSimilarity * 20);
      
      // Bonus for potential translations/contrafacta
      if (isPotentialTranslation) {
        const translationBonus = 8;
        score += similarityScore + translationBonus;
        
        factors.push({
          description: `Potential translation/contrafactum: "${bestMatch.title1}" ≈ "${bestMatch.title2}" (different languages)`,
          score: similarityScore + translationBonus,
          strength: 'strong'
        });
      } else {
        score += similarityScore;
        factors.push({
          description: `Similar titles: "${bestMatch.title1}" ≈ "${bestMatch.title2}" (${Math.round(bestSimilarity * 100)}%)`,
          score: similarityScore,
          strength: bestSimilarity >= 0.85 ? 'strong' : 'medium'
        });
      }
    }
  }
  
  // Additional check: very similar titles but different languages (even if not caught above)
  if (!exactMatches.length && bestSimilarity < 0.7) {
    const crossLanguageMatches = findCrossLanguageMatches(group1, group2);
    if (crossLanguageMatches.length > 0) {
      const crossLangScore = 12;
      score += crossLangScore;
      
      factors.push({
        description: `Cross-language title similarity - potential translation: "${crossLanguageMatches[0].title1}" / "${crossLanguageMatches[0].title2}"`,
        score: crossLangScore,
        strength: 'strong'
      });
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
    // Both anonymous
    score += 8;
    factors.push({
      description: 'Both have anonymous attributions',
      score: 8,
      strength: 'medium'
    });
  } else if (named1.length > 0 && named2.length > 0) {
    // Both have named composers
    if (named1[0].name === named2[0].name) {
      score += 15;
      factors.push({
        description: `Same composer: ${named1[0].name}`,
        score: 15,
        strength: 'strong'
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
  
  // Check for geographical proximity
  const locations1 = sources1.map(s => s.location).filter(Boolean);
  const locations2 = sources2.map(s => s.location).filter(Boolean);
  
  const commonLocations = locations1.filter(loc => 
    locations2.some(loc2 => loc2 && loc.toLowerCase() === loc2.toLowerCase())
  );
  
  if (commonLocations.length > 0) {
    score += 8;
    factors.push({
      description: `Same geographical area: ${commonLocations[0]}`,
      score: 8,
      strength: 'medium'
    });
  }
  
  // Check for temporal proximity
  const dates1 = sources1.map(s => ({ from: s.from_year, to: s.to_year })).filter(d => d.from || d.to);
  const dates2 = sources2.map(s => ({ from: s.from_year, to: s.to_year })).filter(d => d.from || d.to);
  
  if (dates1.length > 0 && dates2.length > 0) {
    let temporalOverlap = false;
    
    for (const date1 of dates1) {
      for (const date2 of dates2) {
        if (datesOverlap(date1, date2)) {
          temporalOverlap = true;
          break;
        }
      }
      if (temporalOverlap) break;
    }
    
    if (temporalOverlap) {
      score += 7;
      factors.push({
        description: 'Contemporary sources (overlapping dates)',
        score: 7,
        strength: 'medium'
      });
    }
  }
  
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
      score += Math.min(commonWords.length * 2, 10);
      factors.push({
        description: `Similar inclusion notes (${commonWords.length} common terms)`,
        score: Math.min(commonWords.length * 2, 10),
        strength: 'weak'
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

// Helper function for quick pre-filtering
function hasQuickTitleOverlap(group1, group2) {
  if (!group1.title_language_pairs || !group2.title_language_pairs) {
    return false;
  }
  
  const titles1 = group1.title_language_pairs.map(p => p.text.toLowerCase().trim());
  const titles2 = group2.title_language_pairs.map(p => p.text.toLowerCase().trim());
  
  // Quick check for exact matches or similar first words
  for (const title1 of titles1) {
    for (const title2 of titles2) {
      // Exact match
      if (title1 === title2) return true;
      
      // Similar length and first word
      const words1 = title1.split(' ');
      const words2 = title2.split(' ');
      
      if (words1.length > 0 && words2.length > 0) {
        const firstWord1 = words1[0];
        const firstWord2 = words2[0];
        
        // Same first word (at least 3 chars)
        if (firstWord1.length >= 3 && firstWord1 === firstWord2) {
          return true;
        }
        
        // Very similar length titles (potential translations)
        if (Math.abs(title1.length - title2.length) <= 5 && 
            Math.min(title1.length, title2.length) >= 8) {
          return true;
        }
      }
    }
  }
  
  return false;
}

export default router; 