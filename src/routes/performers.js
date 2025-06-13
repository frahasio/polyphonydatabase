import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of performers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        p.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', comp.id,
              'title', comp.title,
              'type', ct.name
            )
          ) FILTER (WHERE comp.id IS NOT NULL),
          '[]'
        ) as compositions
      FROM performers p
      LEFT JOIN performers_compositions pc ON p.id = pc.performer_id
      LEFT JOIN compositions comp ON pc.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
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
      performers: result.rows.map(row => ({
        ...row,
        compositions: row.compositions || []
      }))
    });
  } catch (error) {
    console.error('Error fetching performers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get performer by ID
router.get('/:id', async (req, res) => {
  try {
    const performerId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch performer details with compositions
    const performerQuery = `
      SELECT 
        p.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', comp.id,
              'title', comp.title,
              'type', ct.name
            )
          ) FILTER (WHERE comp.id IS NOT NULL),
          '[]'
        ) as compositions
      FROM performers p
      LEFT JOIN performers_compositions pc ON p.id = pc.performer_id
      LEFT JOIN compositions comp ON pc.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
      WHERE p.id = $1
      GROUP BY p.id
    `;

    const performerResult = await pool.query(performerQuery, [performerId]);
    
    if (performerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Performer not found' });
    }

    const performer = performerResult.rows[0];

    // Fetch total count of compositions
    const countQuery = `
      SELECT COUNT(*) 
      FROM performers_compositions 
      WHERE performer_id = $1
    `;
    const countResult = await pool.query(countQuery, [performerId]);
    const totalCompositions = parseInt(countResult.rows[0].count);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCompositions / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      performer: {
        ...performer,
        compositions: performer.compositions || []
      },
      pagination: {
        total: totalCompositions,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    });
  } catch (error) {
    console.error('Error fetching performer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new performer
router.post('/', async (req, res) => {
  try {
    const { name, notes } = req.body;

    const query = `
      INSERT INTO performers (
        name, notes
      )
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating performer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete performer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM performers WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting performer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 