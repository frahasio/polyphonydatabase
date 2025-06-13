import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of composers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        id,
        name,
        from_year,
        to_year,
        birthplace_1,
        birthplace_2,
        deathplace_1,
        deathplace_2,
        image_url
      FROM composers
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
      composers: result.rows
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

    const query = `
      SELECT 
        id,
        name,
        from_year,
        to_year,
        birthplace_1,
        birthplace_2,
        deathplace_1,
        deathplace_2,
        image_url
      FROM composers
      WHERE id = $1
    `;

    const result = await pool.query(query, [composerId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    res.json({
      composer: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching composer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new composer
router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      from_year, 
      to_year, 
      birthplace_1, 
      birthplace_2, 
      deathplace_1, 
      deathplace_2, 
      image_url 
    } = req.body;

    const query = `
      INSERT INTO composers (
        name, 
        from_year, 
        to_year, 
        birthplace_1, 
        birthplace_2, 
        deathplace_1, 
        deathplace_2, 
        image_url,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, 
      from_year || null, 
      to_year || null, 
      birthplace_1 || null, 
      birthplace_2 || null, 
      deathplace_1 || null, 
      deathplace_2 || null, 
      image_url || null
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

// Update composer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      from_year, 
      to_year, 
      birthplace_1, 
      birthplace_2, 
      deathplace_1, 
      deathplace_2, 
      image_url 
    } = req.body;

    const query = `
      UPDATE composers
      SET 
        name = $1,
        from_year = $2,
        to_year = $3,
        birthplace_1 = $4,
        birthplace_2 = $5,
        deathplace_1 = $6,
        deathplace_2 = $7,
        image_url = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, 
      from_year || null, 
      to_year || null, 
      birthplace_1 || null, 
      birthplace_2 || null, 
      deathplace_1 || null, 
      deathplace_2 || null, 
      image_url || null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating composer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 