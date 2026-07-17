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
 * @param {object} [cfg.listCount]  Add a usage count to the list response:
 *                                  { table, column, as }
 * @param {object[]} [cfg.mergeRefs] Enable POST /merge: referencing columns
 *                                  repointed from the merged rows to the
 *                                  survivor, e.g. [{ table: 'recordings',
 *                                  column: 'performer_id' }]
 */
export function createEntityRouter(cfg) {
  const { table, listKey, singularKey, label, fields, audit = false, listCount = null, mergeRefs = null } = cfg;
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
      const cols = ['e.id', ...fields.map((f) => `e.${f}`)].join(', ');
      let query = listCount
        ? `SELECT ${cols}, COUNT(rc.${listCount.column})::int AS ${listCount.as}
           FROM ${table} e
           LEFT JOIN ${listCount.table} rc ON rc.${listCount.column} = e.id`
        : `SELECT ${cols} FROM ${table} e`;
      const params = [];
      if (searchTerm) {
        query += ` WHERE e.name ILIKE $1`;
        params.push(`%${searchTerm}%`);
      }
      if (listCount) query += ` GROUP BY ${cols}`;
      query += ` ORDER BY e.name`;
      const result = await pool.query(query, params);
      res.json({ [listKey]: result.rows });
    } catch (error) {
      console.error(`Error fetching ${table}:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Merge: repoint every reference from the source rows to the target row,
  // then delete the sources. Body: { target_id, source_ids: [...] }.
  if (mergeRefs && mergeRefs.length) {
    router.post('/merge', async (req, res) => {
      const targetId = parseInt(req.body.target_id, 10);
      const sourceIds = (Array.isArray(req.body.source_ids) ? req.body.source_ids : [])
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isInteger(x) && x !== targetId);
      if (!Number.isInteger(targetId) || !sourceIds.length) {
        return res.status(400).json({ error: 'target_id and at least one distinct source id are required' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query(
          `SELECT id, name FROM ${table} WHERE id = ANY($1) FOR UPDATE`,
          [[targetId, ...sourceIds]]
        );
        if (found.rows.length !== sourceIds.length + 1) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `One or more ${listKey} no longer exist` });
        }
        let moved = 0;
        for (const ref of mergeRefs) {
          const r = await client.query(
            `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = ANY($2)`,
            [targetId, sourceIds]
          );
          moved += r.rowCount;
        }
        await client.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [sourceIds]);

        const target = found.rows.find((r) => r.id === targetId);
        const sources = found.rows.filter((r) => r.id !== targetId);
        try {
          await client.query(
            `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
            [
              req.user?.id || null,
              req.user?.email || 'unknown@system.local',
              'UPDATE',
              table,
              targetId,
              JSON.stringify({ action: 'merge', merged: sources }),
              JSON.stringify({ survivor: target, references_moved: moved }),
            ]
          );
        } catch (auditError) {
          console.log('Audit logging skipped:', auditError.message);
        }

        await client.query('COMMIT');
        res.json({
          success: true,
          survivor: target,
          merged: sources.map((s) => s.name),
          references_moved: moved,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error merging ${listKey}:`, error);
        res.status(500).json({ error: 'Merge failed: ' + error.message });
      } finally {
        client.release();
      }
    });
  }

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
