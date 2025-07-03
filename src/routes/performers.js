import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes in this router
router.use(requireAuth);

// Get list of performers
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        id,
        name
      FROM performers
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
      performers: result.rows
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

    const query = `
      SELECT 
        id,
        name
      FROM performers
      WHERE id = $1
    `;

    const result = await pool.query(query, [performerId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Performer not found' });
    }

    res.json({
      performer: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching performer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new performer
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const query = `
      INSERT INTO performers (
        name,
        created_at,
        updated_at
      )
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [name]);

    const newPerformer = result.rows[0];

    // Log audit entry
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'CREATE',
          'performers',
          newPerformer.id,
          null,
          JSON.stringify(newPerformer)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(201).json(newPerformer);
  } catch (error) {
    console.error('Error creating performer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update performer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const query = `
      UPDATE performers
      SET 
        name = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Performer not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating performer:', error);
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