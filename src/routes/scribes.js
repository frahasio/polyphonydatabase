import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes in this router
router.use(requireAuth);

// Get list of scribes
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        id,
        name
      FROM scribes
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE name ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      ORDER BY name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      scribes: result.rows
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

    const query = `
      SELECT 
        id,
        name
      FROM scribes
      WHERE id = $1
    `;

    const result = await pool.query(query, [scribeId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scribe not found' });
    }

    res.json({
      scribe: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching scribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new scribe
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const query = `
      INSERT INTO scribes (
        name,
        created_at,
        updated_at
      )
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [name]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating scribe:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update scribe
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const query = `
      UPDATE scribes
      SET 
        name = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scribe not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating scribe:', error);
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