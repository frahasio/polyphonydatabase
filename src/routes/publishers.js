import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of publishers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        p.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', s.id,
              'code', s.code,
              'title', s.title
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as sources
      FROM publishers p
      LEFT JOIN publishers_sources ps ON p.id = ps.publisher_id
      LEFT JOIN sources s ON ps.source_id = s.id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE p.name ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY p.id
      ORDER BY p.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      publishers: result.rows.map(row => ({
        ...row,
        sources: row.sources || []
      }))
    });
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get publisher by ID
router.get('/:id', async (req, res) => {
  try {
    const publisherId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch publisher details with sources
    const publisherQuery = `
      SELECT 
        p.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', s.id,
              'code', s.code,
              'title', s.title
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) as sources
      FROM publishers p
      LEFT JOIN publishers_sources ps ON p.id = ps.publisher_id
      LEFT JOIN sources s ON ps.source_id = s.id
      WHERE p.id = $1
      GROUP BY p.id
    `;

    const publisherResult = await pool.query(publisherQuery, [publisherId]);
    
    if (publisherResult.rows.length === 0) {
      return res.status(404).json({ error: 'Publisher not found' });
    }

    const publisher = publisherResult.rows[0];

    // Fetch total count of sources
    const countQuery = `
      SELECT COUNT(*) 
      FROM publishers_sources 
      WHERE publisher_id = $1
    `;
    const countResult = await pool.query(countQuery, [publisherId]);
    const totalSources = parseInt(countResult.rows[0].count);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalSources / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      publisher: {
        ...publisher,
        sources: publisher.sources || []
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
    console.error('Error fetching publisher:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new publisher
router.post('/', async (req, res) => {
  try {
    const { name, notes } = req.body;

    const query = `
      INSERT INTO publishers (
        name, notes
      )
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating publisher:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete publisher
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM publishers WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting publisher:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 