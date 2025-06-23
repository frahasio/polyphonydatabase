import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get all functions with their associated titles
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        f.id,
        f.name,
        f.created_at,
        f.updated_at,
        COUNT(ft.title_id) as title_count
      FROM functions f
      LEFT JOIN functions_titles ft ON f.id = ft.function_id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += ` WHERE f.name ILIKE $1`;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY f.id, f.name, f.created_at, f.updated_at
      ORDER BY f.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      functions: result.rows
    });
  } catch (error) {
    console.error('Error fetching functions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get function by ID with its titles
router.get('/:id', async (req, res) => {
  try {
    const functionId = parseInt(req.params.id);

    // Get function details
    const functionQuery = `
      SELECT id, name, created_at, updated_at
      FROM functions
      WHERE id = $1
    `;

    const functionResult = await pool.query(functionQuery, [functionId]);
    
    if (functionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    // Get associated titles
    const titlesQuery = `
      SELECT t.id, t.text, t.language, t.created_at, t.updated_at
      FROM titles t
      INNER JOIN functions_titles ft ON t.id = ft.title_id
      WHERE ft.function_id = $1
      ORDER BY t.text
    `;

    const titlesResult = await pool.query(titlesQuery, [functionId]);

    res.json({
      function: functionResult.rows[0],
      titles: titlesResult.rows
    });
  } catch (error) {
    console.error('Error fetching function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new function
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const query = `
      INSERT INTO functions (name, created_at, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update function
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const query = `
      UPDATE functions
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete function
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First delete associations
    await pool.query('DELETE FROM functions_titles WHERE function_id = $1', [id]);
    
    // Then delete the function
    await pool.query('DELETE FROM functions WHERE id = $1', [id]);
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all titles with advanced search and similarity matching
router.get('/titles/search', async (req, res) => {
  try {
    const { 
      search = '', 
      language = '', 
      function_id = '',
      similar = 'false',
      page = 1,
      limit = 50 
    } = req.query;

    const offset = (page - 1) * limit;
    let countQuery = 'SELECT COUNT(*) FROM titles t';
    let query = `
      SELECT 
        t.id,
        t.text,
        t.language,
        t.created_at,
        t.updated_at,
        COUNT(DISTINCT c.id) as composition_count,
        COUNT(DISTINCT ft.function_id) as function_count,
        ARRAY_AGG(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL) as function_names
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      LEFT JOIN functions f ON ft.function_id = f.id
    `;

    const queryParams = [];
    const conditions = [];

    if (search) {
      // Handle special dashboard filters
      if (search === '*no_functions*') {
        conditions.push(`ft.title_id IS NULL`);
      } else if (search === '*no_language*') {
        conditions.push(`t.language IS NULL`);
      } else if (similar === 'true') {
        // Use basic similarity search for finding potential duplicates
        conditions.push(`(
          t.text ILIKE $${queryParams.length + 1} OR
          t.text ILIKE $${queryParams.length + 2} OR
          t.text ILIKE $${queryParams.length + 3}
        )`);
        queryParams.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search.toUpperCase()}%`);
      } else {
        conditions.push(`t.text ILIKE $${queryParams.length + 1}`);
        queryParams.push(`%${search}%`);
      }
    }

    if (language) {
      conditions.push(`t.language = $${queryParams.length + 1}`);
      queryParams.push(parseInt(language));
    }

    if (function_id) {
      conditions.push(`ft.function_id = $${queryParams.length + 1}`);
      queryParams.push(parseInt(function_id));
    }

    if (conditions.length > 0) {
      const whereClause = ` WHERE ${conditions.join(' AND ')}`;
      query += whereClause;
      countQuery += whereClause;
    }

    query += `
      GROUP BY t.id, t.text, t.language, t.created_at, t.updated_at
      ORDER BY t.text
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);

    const [countResult, titlesResult] = await Promise.all([
      pool.query(countQuery, queryParams.slice(0, -2)),
      pool.query(query, queryParams)
    ]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    res.json({
      titles: titlesResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error searching titles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new title
router.post('/titles', async (req, res) => {
  try {
    const { text, language } = req.body;

    const query = `
      INSERT INTO titles (text, language, created_at, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [text, language || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating title:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update title
router.put('/titles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, language } = req.body;

    const query = `
      UPDATE titles
      SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [text, language || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Title not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating title:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merge titles - combines multiple titles into one and updates all references
router.post('/titles/merge', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { target_title_id, source_title_ids, final_text, final_language } = req.body;
    
    if (!target_title_id || !source_title_ids || source_title_ids.length === 0) {
      throw new Error('target_title_id and source_title_ids are required');
    }

    // Update the target title with final text and language
    await client.query(`
      UPDATE titles 
      SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3
    `, [final_text, final_language || null, target_title_id]);

    // Update all compositions that reference source titles to point to target title
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        await client.query(`
          UPDATE compositions 
          SET title_id = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE title_id = $2
        `, [target_title_id, sourceId]);
      }
    }

    // Merge function associations - move all to target title
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        // First, get functions associated with source title
        const sourceFunctions = await client.query(`
          SELECT function_id FROM functions_titles WHERE title_id = $1
        `, [sourceId]);

        // Add associations to target title (ignore conflicts)
        for (const func of sourceFunctions.rows) {
          await client.query(`
            INSERT INTO functions_titles (function_id, title_id)
            VALUES ($1, $2)
            ON CONFLICT (function_id, title_id) DO NOTHING
          `, [func.function_id, target_title_id]);
        }

        // Remove associations from source title
        await client.query(`
          DELETE FROM functions_titles WHERE title_id = $1
        `, [sourceId]);
      }
    }

    // Delete source titles (but not the target)
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        await client.query('DELETE FROM titles WHERE id = $1', [sourceId]);
      }
    }

    await client.query('COMMIT');

    // Return updated target title
    const result = await client.query(`
      SELECT t.*, 
             COUNT(DISTINCT c.id) as composition_count,
             COUNT(DISTINCT ft.function_id) as function_count
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      WHERE t.id = $1
      GROUP BY t.id
    `, [target_title_id]);

    res.json({
      success: true,
      merged_title: result.rows[0],
      message: `Successfully merged ${source_title_ids.length} titles`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error merging titles:', error);
    res.status(500).json({ error: 'Failed to merge titles: ' + error.message });
  } finally {
    client.release();
  }
});

// Assign/unassign title to function
router.post('/titles/:titleId/functions/:functionId', async (req, res) => {
  try {
    const { titleId, functionId } = req.params;

    const query = `
      INSERT INTO functions_titles (function_id, title_id)
      VALUES ($1, $2)
      ON CONFLICT (function_id, title_id) DO NOTHING
      RETURNING *
    `;

    await pool.query(query, [functionId, titleId]);
    res.json({ success: true, message: 'Title assigned to function' });
  } catch (error) {
    console.error('Error assigning title to function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/titles/:titleId/functions/:functionId', async (req, res) => {
  try {
    const { titleId, functionId } = req.params;

    await pool.query(`
      DELETE FROM functions_titles 
      WHERE function_id = $1 AND title_id = $2
    `, [functionId, titleId]);

    res.json({ success: true, message: 'Title unassigned from function' });
  } catch (error) {
    console.error('Error unassigning title from function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get languages (assuming we need to create this table)
router.get('/languages', async (req, res) => {
  try {
    // Try to get languages from a languages table, or return common ones
    let result;
    try {
      result = await pool.query('SELECT id, language as name FROM languages ORDER BY language');
    } catch (error) {
      // If languages table doesn't exist, return common language options
      result = {
        rows: [
          { id: 1, name: 'Latin' },
          { id: 2, name: 'English' },
          { id: 3, name: 'French' },
          { id: 4, name: 'Italian' },
          { id: 5, name: 'German' },
          { id: 6, name: 'Spanish' },
          { id: 7, name: 'Dutch' },
          { id: 8, name: 'Portuguese' }
        ]
      };
    }
    
    res.json({ languages: result.rows });
  } catch (error) {
    console.error('Error fetching languages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get dashboard alerts for data quality issues
router.get('/dashboard/alerts', async (req, res) => {
  try {
    const alerts = [];

    // Check for titles with no functions assigned
    const titlesNoFunctions = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles t
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      WHERE ft.title_id IS NULL
    `);

    if (parseInt(titlesNoFunctions.rows[0].count) > 0) {
      alerts.push({
        type: 'warning',
        title: 'Titles without Functions',
        count: parseInt(titlesNoFunctions.rows[0].count),
        description: 'titles have no functions assigned',
        action_url: '/modules/functions/index.html?filter=no_functions',
        action_text: 'Assign Functions'
      });
    }

    // Check for functions with no titles assigned
    const functionsNoTitles = await pool.query(`
      SELECT COUNT(*) as count
      FROM functions f
      LEFT JOIN functions_titles ft ON f.id = ft.function_id
      WHERE ft.function_id IS NULL
    `);

    if (parseInt(functionsNoTitles.rows[0].count) > 0) {
      alerts.push({
        type: 'info',
        title: 'Functions without Titles',
        count: parseInt(functionsNoTitles.rows[0].count),
        description: 'functions have no titles assigned',
        action_url: '/modules/functions/index.html?filter=empty_functions',
        action_text: 'Add Titles'
      });
    }

    // Check for titles with null language
    const titlesNoLanguage = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles
      WHERE language IS NULL
    `);

    if (parseInt(titlesNoLanguage.rows[0].count) > 0) {
      alerts.push({
        type: 'warning',
        title: 'Titles without Language',
        count: parseInt(titlesNoLanguage.rows[0].count),
        description: 'titles have no language assigned',
        action_url: '/modules/functions/index.html?filter=no_language',
        action_text: 'Assign Languages'
      });
    }

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching dashboard alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 