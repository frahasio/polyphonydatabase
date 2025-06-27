import express from 'express';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

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

// Get recent activity/audit trail from audit_log table
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
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
    
    // Get detailed audit log entries
    const auditActivity = await pool.query(`
      SELECT 
        al.id,
        al.action,
        al.table_name as type,
        al.record_id,
        al.record_title as title,
        al.user_email,
        al.changes,
        al.created_at,
        al.ip_address,
        CASE 
          WHEN al.action = 'CREATE' THEN 'created'
          WHEN al.action = 'UPDATE' THEN 'updated'
          WHEN al.action = 'DELETE' THEN 'deleted'
          ELSE 'modified'
        END as action_desc
      FROM audit_log al
      WHERE al.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY al.created_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ activity: auditActivity.rows });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get data quality alerts
router.get('/data-quality-alerts', async (req, res) => {
  try {
    const alerts = [];

    // Count clef combinations without voicings
    try {
      const clefCombosWithoutVoicingsCount = await pool.query(`
        SELECT COUNT(*) as count
        FROM clef_combinations cc
        LEFT JOIN clef_combinations_voicings ccv ON cc.id = ccv.clef_combination_id
        WHERE ccv.clef_combination_id IS NULL
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

    // Count invalid clef combinations
    try {
      const validClefs = ['g1', 'g2', 'g3', 'c1', 'g4', 'c2', 'g5', 'c3', 'f1', 'g28', 'c4', 'f2', 'c5', 'd1', 'f3', 'd2', 'f4', 'd3', 'y1', 'f5', 'd4', 'y2', 'd5', 'y3', 'y4', 'y5', 'x1', 'x2', 'x3', 'x4', 'x5', 'org', 'bc', 'lut'];
      
      const allClefCombos = await pool.query(`
        SELECT id, clef_combination FROM clef_combinations
      `);
      
      let invalidCount = 0;
      for (const combo of allClefCombos.rows) {
        const clefArray = combo.clef_combination.match(/(g[0-9]|c[0-9]|f[0-9]|x[0-9]|y[0-9]|d[0-9]|lut|org|bc)/g) || [];
        const hasInvalidClef = clefArray.some(clef => !validClefs.includes(clef));
        
        if (hasInvalidClef || clefArray.length === 0) {
          invalidCount++;
        }
      }

      if (invalidCount > 0) {
        alerts.push({
          type: 'invalid_clef_combinations',
          severity: 'warning',
          title: 'Invalid clef combinations',
          description: `${invalidCount} clef combinations contain invalid or non-existent clefs`,
          count: invalidCount
        });
      }
    } catch (error) {
      console.log('Invalid clef combinations alerts skipped (tables may not exist):', error.message);
    }

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

    // Count functions with no titles assigned
    const functionsWithoutTitlesCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM functions f
      WHERE f.id NOT IN (SELECT DISTINCT function_id FROM functions_titles WHERE function_id IS NOT NULL)
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

    // Count titles with no functions assigned
    const titlesWithoutFunctionsCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles t
      WHERE t.id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
      AND t.id IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
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

    // Count groups where display title doesn't match any composition title
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
    await client.query('BEGIN');
    
    const { cleanup_type } = req.body;
    let results = {};

    if (!cleanup_type || cleanup_type === 'all') {
      // Clean up unused titles
      const unusedTitles = await client.query(`
        DELETE FROM titles 
        WHERE id NOT IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
        RETURNING id, text
      `);
      results.removed_titles = unusedTitles.rowCount;

      // Clean up empty groups (groups with no compositions)
      const emptyGroups = await client.query(`
        DELETE FROM groups 
        WHERE id NOT IN (SELECT DISTINCT group_id FROM compositions WHERE group_id IS NOT NULL)
        RETURNING id, display_title
      `);
      results.removed_groups = emptyGroups.rowCount;

      // Clean up orphaned compositions (compositions pointing to non-existent groups)
      const orphanedCompositions = await client.query(`
        DELETE FROM compositions 
        WHERE group_id NOT IN (SELECT id FROM groups)
        RETURNING id
      `);
      results.removed_compositions = orphanedCompositions.rowCount;

    } else if (cleanup_type === 'titles') {
      const unusedTitles = await client.query(`
        DELETE FROM titles 
        WHERE id NOT IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
        RETURNING id, text
      `);
      results.removed_titles = unusedTitles.rowCount;

    } else if (cleanup_type === 'groups') {
      const emptyGroups = await client.query(`
        DELETE FROM groups 
        WHERE id NOT IN (SELECT DISTINCT group_id FROM compositions WHERE group_id IS NOT NULL)
        RETURNING id, display_title
      `);
      results.removed_groups = emptyGroups.rowCount;

    } else if (cleanup_type === 'voicings') {
      // Remove orphaned clef combinations and voicings
      const orphanedVoicings = await client.query(`
        DELETE FROM voicings
        WHERE id NOT IN (SELECT DISTINCT voicing_id FROM clef_combinations_voicings WHERE voicing_id IS NOT NULL)
        RETURNING id, voicing
      `);
      results.removed_voicings = orphanedVoicings.rowCount;

      const orphanedClefCombos = await client.query(`
        DELETE FROM clef_combinations
        WHERE id NOT IN (SELECT DISTINCT clef_combination_id FROM clef_combinations_voicings WHERE clef_combination_id IS NOT NULL)
        RETURNING id, clef_combination
      `);
      results.removed_clef_combinations = orphanedClefCombos.rowCount;
    }

    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: 'Database cleanup completed successfully',
      results: results
    });

  } catch (error) {
    await client.query('ROLLBACK');
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

    // Preview unused titles
    const unusedTitles = await pool.query(`
      SELECT COUNT(*) as count, 
             STRING_AGG(SUBSTRING(text, 1, 50), ', ') as examples
      FROM titles 
      WHERE id NOT IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
    `);
    preview.unused_titles = {
      count: parseInt(unusedTitles.rows[0].count),
      examples: unusedTitles.rows[0].examples
    };

    // Preview empty groups
    const emptyGroups = await pool.query(`
      SELECT COUNT(*) as count,
             STRING_AGG(SUBSTRING(display_title, 1, 50), ', ') as examples
      FROM groups 
      WHERE id NOT IN (SELECT DISTINCT group_id FROM compositions WHERE group_id IS NOT NULL)
    `);
    preview.empty_groups = {
      count: parseInt(emptyGroups.rows[0].count),
      examples: emptyGroups.rows[0].examples
    };

    // Preview orphaned compositions
    const orphanedCompositions = await pool.query(`
      SELECT COUNT(*) as count
      FROM compositions 
      WHERE group_id NOT IN (SELECT id FROM groups)
    `);
    preview.orphaned_compositions = {
      count: parseInt(orphanedCompositions.rows[0].count)
    };

    res.json(preview);
  } catch (error) {
    console.error('Error generating cleanup preview:', error);
    res.status(500).json({ error: 'Failed to generate cleanup preview' });
  }
});

export default router; 