import express from 'express';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { runDatabaseCleanup } from '../cleanup.js';
import { CLEF_DISPLAY_ORDER } from '../constants.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM sources) as sources,
        (SELECT COUNT(*) FROM sources WHERE catalogued = true) as catalogued,
        (SELECT COUNT(*) FROM compositions) as compositions,
        (SELECT COUNT(*) FROM groups) as groups,
        (SELECT COUNT(*) FROM composers) as composers
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    // Parse and validate individual clefs
    const clefArray = trimmedClefCombo.match(/(g[0-9]+|g28|c[0-9]+|f[0-9]+|x[0-9]+|y[0-9]+|d[0-9]+|lut|org|bc)/g) || [];
    
    if (clefArray.length === 0) {
      return res.status(400).json({ error: 'No valid clefs found in combination' });
    }

    // Validate each clef exists in our valid list
    for (const clef of clefArray) {
      if (!CLEF_DISPLAY_ORDER.includes(clef)) {
        return res.status(400).json({ error: `Invalid clef: ${clef}` });
      }
    }

    // Sort clefs according to display order to ensure consistency
    const sortedClefs = clefArray.sort((a, b) => {
      const aIndex = CLEF_DISPLAY_ORDER.indexOf(a);
      const bIndex = CLEF_DISPLAY_ORDER.indexOf(b);
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
router.get('/recent-users', async (req, res) => {
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
async function getLegacyActivity(limit) {
  const result = await pool.query(`
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
  return result.rows;
}

router.get('/recent-activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // Check if audit_log table exists and has the expected structure
    const tableStructure = await pool.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_name = 'audit_log' 
    `);
    
    if (tableStructure.rows.length === 0) {
      return res.json({ activity: await getLegacyActivity(limit) });
    }
    
    const columnNames = tableStructure.rows.map(col => col.column_name);
    const hasChangesColumn = columnNames.includes('changes');
    
    if (!hasChangesColumn) {
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
    
    // Get audit log entries with enhanced record titles
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
    
    if (auditActivity.rows.length === 0) {
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

// Check for missing clef images
router.get('/missing-clef-images', async (req, res) => {
  try {
    // Get all clef data from inclusions - extract individual clef objects
    const clefQuery = `
      SELECT jsonb_array_elements(i.clefs) as clef_obj
      FROM inclusions i
      WHERE i.clefs IS NOT NULL 
      AND i.clefs != '[]'::jsonb
      AND jsonb_array_length(i.clefs) > 0
    `;
    
    const clefResult = await pool.query(clefQuery);
    
    // Collect all unique clef image filenames that should exist
    const requiredImages = new Set();
    
    clefResult.rows.forEach(row => {
      const clef = row.clef_obj;
      if (clef && clef.clef && typeof clef.clef === 'string' && clef.clef.trim()) {
        const clefName = clef.clef.trim();
        // Add single clef image
        requiredImages.add(`${clefName}.png`);
        
        // Add clef with transitions if present
        if (clef.transitions_to && Array.isArray(clef.transitions_to) && clef.transitions_to.length > 0) {
          const transitions = clef.transitions_to
            .filter(t => t && typeof t === 'string' && t.trim())
            .map(t => t.trim());
          if (transitions.length > 0) {
            const transitionImage = `${clefName}${transitions.join('')}.png`;
            requiredImages.add(transitionImage);
          }
        }
      }
    });
    
    // Read the clef_images directory
    const clefImagesDir = path.join(__dirname, '..', '..', 'public', 'clef_images');
    let existingImages = [];
    
    try {
      if (fs.existsSync(clefImagesDir)) {
        existingImages = fs.readdirSync(clefImagesDir)
          .filter(file => file.endsWith('.png'))
          .map(file => file);
      } else {
        console.error('Clef images directory does not exist:', clefImagesDir);
        return res.status(500).json({ 
          error: 'Clef images directory not found',
          path: clefImagesDir
        });
      }
    } catch (error) {
      console.error('Error reading clef_images directory:', error);
      return res.status(500).json({ 
        error: 'Could not read clef_images directory',
        details: error.message 
      });
    }
    
    const existingImagesSet = new Set(existingImages);
    const missingImages = Array.from(requiredImages)
      .filter(img => !existingImagesSet.has(img))
      .sort();
    
    res.json({
      total_required: requiredImages.size,
      total_existing: existingImages.length,
      missing_count: missingImages.length,
      missing_images: missingImages
    });
    
  } catch (error) {
    console.error('Error checking missing clef images:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
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


export default router; 