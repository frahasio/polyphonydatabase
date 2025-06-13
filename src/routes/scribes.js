import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of scribes
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        s.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', src.id,
              'code', src.code,
              'title', src.title
            )
          ) FILTER (WHERE src.id IS NOT NULL),
          '[]'
        ) as sources
      FROM scribes s
      LEFT JOIN scribes_sources ss ON s.id = ss.scribe_id
      LEFT JOIN sources src ON ss.source_id = src.id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE s.name ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY s.id
      ORDER BY s.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      scribes: result.rows.map(row => ({
        ...row,
        sources: row.sources || []
      }))
    });
  } catch (error) {
    console.error('Error fetching scribes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get scribe by ID
router.get('/:id', async (req, res) => {
  try {
    const scribeId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch scribe details with sources
    const scribeQuery = `
      SELECT 
        s.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', src.id,
              'code', src.code,
              'title', src.title
            )
          ) FILTER (WHERE src.id IS NOT NULL),
          '[]'
        ) as sources
      FROM scribes s
      LEFT JOIN scribes_sources ss ON s.id = ss.scribe_id
      LEFT JOIN sources src ON ss.source_id = src.id
      WHERE s.id = $1
      GROUP BY s.id
    `;

    const scribeResult = await pool.query(scribeQuery, [scribeId]);
    
    if (scribeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scribe not found' });
    }

    const scribe = scribeResult.rows[0];

    // Fetch total count of sources
    const countQuery = `
      SELECT COUNT(*) 
      FROM scribes_sources 
      WHERE scribe_id = $1
    `;
    const countResult = await pool.query(countQuery, [scribeId]);
    const totalSources = parseInt(countResult.rows[0].count);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalSources / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      scribe: {
        ...scribe,
        sources: scribe.sources || []
      },
      pagination: {
        total: totalSources,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    });
  } catch (error) {
    console.error('Error fetching scribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new scribe
router.post('/', async (req, res) => {
  try {
    const { name, notes } = req.body;

    const query = `
      INSERT INTO scribes (
        name, notes
      )
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating scribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete scribe
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM scribes WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting scribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 