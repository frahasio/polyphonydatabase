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
      SELECT id, clefcombo
      FROM clef_combinations
      ORDER BY clefcombo
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
      SELECT clef_combo_id, voicing_id
      FROM clef_combos_voicings
      ORDER BY clef_combo_id, voicing_id
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
    const { clef_combo_id, voicing_id } = req.body;

    if (!clef_combo_id || !voicing_id) {
      return res.status(400).json({ error: 'clef_combo_id and voicing_id are required' });
    }

    const query = `
      INSERT INTO clef_combos_voicings (clef_combo_id, voicing_id)
      VALUES ($1, $2)
      ON CONFLICT (clef_combo_id, voicing_id) DO NOTHING
    `;
    
    await pool.query(query, [clef_combo_id, voicing_id]);
    res.json({ success: true, message: 'Mapping added successfully' });
  } catch (error) {
    console.error('Error adding clef-voicing mapping:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a clef combination to voicing mapping
router.delete('/clef-voicing-mappings', async (req, res) => {
  try {
    const { clef_combo_id, voicing_id } = req.body;

    if (!clef_combo_id || !voicing_id) {
      return res.status(400).json({ error: 'clef_combo_id and voicing_id are required' });
    }

    const query = `
      DELETE FROM clef_combos_voicings
      WHERE clef_combo_id = $1 AND voicing_id = $2
    `;
    
    const result = await pool.query(query, [clef_combo_id, voicing_id]);
    
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
      INSERT INTO voicings (voicing)
      VALUES ($1)
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
    const { clefcombo } = req.body;

    if (!clefcombo || !clefcombo.trim()) {
      return res.status(400).json({ error: 'clefcombo is required' });
    }

    const trimmedClefcombo = clefcombo.trim();

    // Validate clef combination format (basic validation)
    if (!/^[a-z0-9]+$/.test(trimmedClefcombo)) {
      return res.status(400).json({ error: 'Invalid clef combination format' });
    }

    // Check if clef combination already exists
    const checkQuery = 'SELECT id FROM clef_combinations WHERE clefcombo = $1';
    const checkResult = await pool.query(checkQuery, [trimmedClefcombo]);
    
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ error: 'Clef combination already exists' });
    }

    const insertQuery = `
      INSERT INTO clef_combinations (clefcombo)
      VALUES ($1)
      RETURNING id, clefcombo
    `;
    
    const result = await pool.query(insertQuery, [trimmedClefcombo]);
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

// Get recent activity/audit trail  
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // Get recent sources added/updated
    const recentSources = await pool.query(`
      SELECT 'source' as type, id, code as title, created_at, updated_at
      FROM sources 
      WHERE created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT $1
    `, [Math.floor(limit / 4)]);

    // Get recent editions added
    const recentEditions = await pool.query(`
      SELECT 'edition' as type, e.id, 
             CONCAT(ed.name, ' - ', g.display_title) as title,
             e.created_at, e.updated_at
      FROM editions e
      LEFT JOIN editors ed ON e.editor_id = ed.id
      LEFT JOIN groups g ON e.group_id = g.id
      WHERE e.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY e.created_at DESC
      LIMIT $1
    `, [Math.floor(limit / 4)]);

    // Get recent recordings added
    const recentRecordings = await pool.query(`
      SELECT 'recording' as type, r.id,
             CONCAT(p.name, ' - ', g.display_title) as title,
             r.created_at, r.updated_at
      FROM recordings r
      LEFT JOIN performers p ON r.performer_id = p.id
      LEFT JOIN groups g ON r.group_id = g.id
      WHERE r.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY r.created_at DESC
      LIMIT $1
    `, [Math.floor(limit / 4)]);

    // Get recent groups created/updated
    const recentGroups = await pool.query(`
      SELECT 'group' as type, id, display_title as title, created_at, updated_at
      FROM groups
      WHERE created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT $1
    `, [Math.floor(limit / 4)]);

    // Combine all activities
    const allActivity = [
      ...recentSources.rows,
      ...recentEditions.rows,
      ...recentRecordings.rows,
      ...recentGroups.rows
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
     .slice(0, limit);

    res.json({ activity: allActivity });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get data quality alerts
router.get('/data-quality-alerts', async (req, res) => {
  try {
    const alerts = [];

    // Clef combinations without voicings
    const clefCombosWithoutVoicings = await pool.query(`
      SELECT cc.id, cc.clefcombo
      FROM clef_combinations cc
      LEFT JOIN clef_combos_voicings ccv ON cc.id = ccv.clef_combo_id
      WHERE ccv.clef_combo_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ignored_alerts ia
        WHERE ia.alert_type = 'clef_combo_no_voicing'
        AND ia.entity_type = 'clef_combination'
        AND ia.entity_id = cc.id
      )
      ORDER BY cc.clefcombo
    `);

    clefCombosWithoutVoicings.rows.forEach(row => {
      alerts.push({
        type: 'clef_combo_no_voicing',
        severity: 'warning',
        title: 'Clef combination without voicings',
        description: `Clef combination "${row.clefcombo}" has no assigned voicings`,
        entity_type: 'clef_combination',
        entity_id: row.id,
        entity_name: row.clefcombo
      });
    });

    // Voicings without clef combinations
    const voicingsWithoutClefCombos = await pool.query(`
      SELECT v.id, v.voicing
      FROM voicings v
      LEFT JOIN clef_combos_voicings ccv ON v.id = ccv.voicing_id
      WHERE ccv.voicing_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ignored_alerts ia
        WHERE ia.alert_type = 'voicing_no_clef_combo'
        AND ia.entity_type = 'voicing'
        AND ia.entity_id = v.id
      )
      ORDER BY v.voicing
    `);

    voicingsWithoutClefCombos.rows.forEach(row => {
      alerts.push({
        type: 'voicing_no_clef_combo',
        severity: 'warning',
        title: 'Voicing without clef combinations',
        description: `Voicing "${row.voicing}" has no assigned clef combinations`,
        entity_type: 'voicing',
        entity_id: row.id,
        entity_name: row.voicing
      });
    });

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

      // Clean up orphaned compositions (compositions referencing non-existent groups)
      const orphanedCompositions = await client.query(`
        DELETE FROM compositions 
        WHERE group_id NOT IN (SELECT id FROM groups)
        RETURNING id
      `);
      results.removed_compositions = orphanedCompositions.rowCount;

      // Clean up unused clef combinations
      const unusedClefCombos = await client.query(`
        DELETE FROM clef_combinations 
        WHERE id NOT IN (SELECT DISTINCT clef_combo_id FROM clef_combos_voicings WHERE clef_combo_id IS NOT NULL)
        RETURNING id, clefcombo
      `);
      results.removed_clef_combinations = unusedClefCombos.rowCount;

      // Clean up unused voicings
      const unusedVoicings = await client.query(`
        DELETE FROM voicings 
        WHERE id NOT IN (SELECT DISTINCT voicing_id FROM clef_combos_voicings WHERE voicing_id IS NOT NULL)
        RETURNING id, voicing
      `);
      results.removed_voicings = unusedVoicings.rowCount;

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
      const unusedClefCombos = await client.query(`
        DELETE FROM clef_combinations 
        WHERE id NOT IN (SELECT DISTINCT clef_combo_id FROM clef_combos_voicings WHERE clef_combo_id IS NOT NULL)
        RETURNING id, clefcombo
      `);
      results.removed_clef_combinations = unusedClefCombos.rowCount;

      const unusedVoicings = await client.query(`
        DELETE FROM voicings 
        WHERE id NOT IN (SELECT DISTINCT voicing_id FROM clef_combos_voicings WHERE voicing_id IS NOT NULL)
        RETURNING id, voicing
      `);
      results.removed_voicings = unusedVoicings.rowCount;
    }

    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: 'Cleanup completed successfully',
      results 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during cleanup:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get cleanup preview (shows what would be deleted without actually deleting)
router.get('/cleanup-preview', async (req, res) => {
  try {
    const results = {};

    // Preview unused titles
    const unusedTitles = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles 
      WHERE id NOT IN (SELECT DISTINCT title_id FROM compositions WHERE title_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT title_id FROM functions_titles WHERE title_id IS NOT NULL)
    `);
    results.unused_titles = parseInt(unusedTitles.rows[0].count);

    // Preview empty groups
    const emptyGroups = await pool.query(`
      SELECT COUNT(*) as count
      FROM groups 
      WHERE id NOT IN (SELECT DISTINCT group_id FROM compositions WHERE group_id IS NOT NULL)
    `);
    results.empty_groups = parseInt(emptyGroups.rows[0].count);

    // Preview orphaned compositions
    const orphanedCompositions = await pool.query(`
      SELECT COUNT(*) as count
      FROM compositions 
      WHERE group_id NOT IN (SELECT id FROM groups)
    `);
    results.orphaned_compositions = parseInt(orphanedCompositions.rows[0].count);

    // Preview unused clef combinations
    const unusedClefCombos = await pool.query(`
      SELECT COUNT(*) as count
      FROM clef_combinations 
      WHERE id NOT IN (SELECT DISTINCT clef_combo_id FROM clef_combos_voicings WHERE clef_combo_id IS NOT NULL)
    `);
    results.unused_clef_combinations = parseInt(unusedClefCombos.rows[0].count);

    // Preview unused voicings
    const unusedVoicings = await pool.query(`
      SELECT COUNT(*) as count
      FROM voicings 
      WHERE id NOT IN (SELECT DISTINCT voicing_id FROM clef_combos_voicings WHERE voicing_id IS NOT NULL)
    `);
    results.unused_voicings = parseInt(unusedVoicings.rows[0].count);

    res.json(results);
  } catch (error) {
    console.error('Error getting cleanup preview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 