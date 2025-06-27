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
        name, 
        date_of_birth,
        created_at,
        updated_at
      )
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [name, date_of_birth || null]);

    const newEditor = result.rows[0];

    // Log audit entry
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'CREATE',
          'editors',
          newEditor.id,
          null,
          JSON.stringify(newEditor)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(201).json(newEditor);
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

// Update editor
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date_of_birth } = req.body;

    const query = `
      UPDATE editors
      SET 
        name = $1,
        date_of_birth = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [name, date_of_birth || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Editor not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating editor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 