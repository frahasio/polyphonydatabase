import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of publishers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        id,
        name
      FROM publishers
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
      publishers: result.rows
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

    const query = `
      SELECT 
        id,
        name
      FROM publishers
      WHERE id = $1
    `;

    const result = await pool.query(query, [publisherId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Publisher not found' });
    }

    res.json({
      publisher: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching publisher:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new publisher
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const query = `
      INSERT INTO publishers (
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
    console.error('Error creating publisher:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update publisher
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const query = `
      UPDATE publishers
      SET 
        name = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Publisher not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating publisher:', error);
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