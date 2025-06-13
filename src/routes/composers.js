import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of composers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        c.*,
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
      FROM composers c
      LEFT JOIN composers_compositions cc ON c.id = cc.composer_id
      LEFT JOIN compositions comp ON cc.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE c.name ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY c.id
      ORDER BY c.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      composers: result.rows.map(row => ({
        ...row,
        compositions: row.compositions || []
      }))
    });
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get composer by ID
router.get('/:id', async (req, res) => {
  try {
    const composerId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch composer details with compositions
    const composerQuery = `
      SELECT 
        c.*,
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
      FROM composers c
      LEFT JOIN composers_compositions cc ON c.id = cc.composer_id
      LEFT JOIN compositions comp ON cc.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
      WHERE c.id = $1
      GROUP BY c.id
    `;

    const composerResult = await pool.query(composerQuery, [composerId]);
    
    if (composerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    const composer = composerResult.rows[0];

    // Fetch total count of compositions
    const countQuery = `
      SELECT COUNT(*) 
      FROM composers_compositions 
      WHERE composer_id = $1
    `;
    const countResult = await pool.query(countQuery, [composerId]);
    const totalCompositions = parseInt(countResult.rows[0].count);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCompositions / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      composer: {
        ...composer,
        compositions: composer.compositions || []
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
    console.error('Error fetching composer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new composer
router.post('/', async (req, res) => {
  try {
    const { name, birthYear, deathYear, notes } = req.body;

    const query = `
      INSERT INTO composers (
        name, birth_year, death_year, notes
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, birthYear, deathYear, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating composer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete composer
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM composers WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting composer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 