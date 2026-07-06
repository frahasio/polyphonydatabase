import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Build a standard CRUD router for a simple "contributor" entity
 * (composers, editors, performers, publishers, scribes). These were five
 * near-identical files; this factory reproduces their exact behaviour and
 * response shapes.
 *
 * @param {object} cfg
 * @param {string} cfg.table        DB table name, also the audit table_name
 * @param {string} cfg.listKey      JSON key for the list response, e.g. 'composers'
 * @param {string} cfg.singularKey  JSON key for a single record, e.g. 'composer'
 * @param {string} cfg.label        Human label for 404 messages, e.g. 'Composer'
 * @param {string[]} cfg.fields     Editable columns (must include 'name' first)
 * @param {boolean} [cfg.audit]     Log an audit entry on create
 */
export function createEntityRouter(cfg) {
  const { table, listKey, singularKey, label, fields, audit = false } = cfg;
  const router = express.Router();
  router.use(requireAuth);

  const columns = ['id', ...fields].join(', ');

  // Preserve the original behaviour exactly: `name` was inserted/updated
  // raw, every other field was coerced falsy -> null.
  const valuesFrom = (body) => fields.map((f) => (f === 'name' ? body[f] : (body[f] || null)));

  // List (optional ?search= on name)
  router.get('/', async (req, res) => {
    try {
      const searchTerm = req.query.search || '';
      let query = `SELECT ${columns} FROM ${table}`;
      const params = [];
      if (searchTerm) {
        query += ` WHERE name ILIKE $1`;
        params.push(`%${searchTerm}%`);
      }
      query += ` ORDER BY name`;
      const result = await pool.query(query, params);
      res.json({ [listKey]: result.rows });
    } catch (error) {
      console.error(`Error fetching ${table}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get one
  router.get('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await pool.query(`SELECT ${columns} FROM ${table} WHERE id = $1`, [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${label} not found` });
      }
      res.json({ [singularKey]: result.rows[0] });
    } catch (error) {
      console.error(`Error fetching ${singularKey}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create
  router.post('/', async (req, res) => {
    try {
      const cols = [...fields, 'created_at', 'updated_at'];
      const placeholders = fields.map((_, i) => `$${i + 1}`).concat('CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP');
      const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const result = await pool.query(query, valuesFrom(req.body));
      const newRow = result.rows[0];

      if (audit) {
        try {
          await pool.query(
            `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
            [
              req.user?.id || null,
              req.user?.email || 'unknown@system.local',
              'CREATE',
              table,
              newRow.id,
              null,
              JSON.stringify(newRow),
            ]
          );
        } catch (auditError) {
          console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
        }
      }

      res.status(201).json(newRow);
    } catch (error) {
      console.error(`Error creating ${singularKey}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
      const query = `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${fields.length + 1} RETURNING *`;
      const result = await pool.query(query, [...valuesFrom(req.body), id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${label} not found` });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error(`Error updating ${singularKey}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete
  router.delete('/:id', async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      res.status(204).send();
    } catch (error) {
      console.error(`Error deleting ${singularKey}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
