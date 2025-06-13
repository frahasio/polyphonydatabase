import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of editors
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        id,
        name,
        date_of_birth
      FROM editors
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
      editors: result.rows
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

    const query = `
      SELECT 
        id,
        name,
        date_of_birth
      FROM editors
      WHERE id = $1
    `;

    const result = await pool.query(query, [editorId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Editor not found' });
    }

    res.json({
      editor: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching editor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new editor
router.post('/', async (req, res) => {
  try {
    const { name, date_of_birth } = req.body;

    const query = `
      INSERT INTO editors (
        name, date_of_birth
      )
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [name, date_of_birth]);

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