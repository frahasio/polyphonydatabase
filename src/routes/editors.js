import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of editors
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        e.*,
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
      FROM editors e
      LEFT JOIN editors_compositions ec ON e.id = ec.editor_id
      LEFT JOIN compositions comp ON ec.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE e.name ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY e.id
      ORDER BY e.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      editors: result.rows.map(row => ({
        ...row,
        compositions: row.compositions || []
      }))
    });
  } catch (error) {
    console.error('Error fetching editors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get editor by ID
router.get('/:id', async (req, res) => {
  try {
    const editorId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch editor details with compositions
    const editorQuery = `
      SELECT 
        e.*,
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
      FROM editors e
      LEFT JOIN editors_compositions ec ON e.id = ec.editor_id
      LEFT JOIN compositions comp ON ec.composition_id = comp.id
      LEFT JOIN composition_types ct ON comp.composition_type_id = ct.id
      WHERE e.id = $1
      GROUP BY e.id
    `;

    const editorResult = await pool.query(editorQuery, [editorId]);
    
    if (editorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Editor not found' });
    }

    const editor = editorResult.rows[0];

    // Fetch total count of compositions
    const countQuery = `
      SELECT COUNT(*) 
      FROM editors_compositions 
      WHERE editor_id = $1
    `;
    const countResult = await pool.query(countQuery, [editorId]);
    const totalCompositions = parseInt(countResult.rows[0].count);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCompositions / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      editor: {
        ...editor,
        compositions: editor.compositions || []
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
    console.error('Error fetching editor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new editor
router.post('/', async (req, res) => {
  try {
    const { name, notes } = req.body;

    const query = `
      INSERT INTO editors (
        name, notes
      )
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating editor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete editor
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM editors WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting editor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 