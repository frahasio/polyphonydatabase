import express from 'express';
import { pool } from '../db.js';

// Review queue for automated suggestions. Mounted under /api/admin behind
// requireAuthWeb + requirePermission('catalogue') so catalogue users (not
// just admins) can churn through it.
const router = express.Router();

const KINDS = ['title_function', 'recording_youtube', 'recording_spotify'];
const REVIEW_ACTIONS = { accept: 'accepted', reject: 'rejected', skip: 'skipped' };

// Attach disambiguating context to each suggestion so reviewers can tell
// exactly which piece is meant: the distinguishing composition attributes
// (voices, type, tone, even/odd, composer) and any existing editions to
// check a recording against. Group-based suggestions (recordings) use the
// group's compositions + editions; title-based (title_function) use every
// composition that carries that title, so multiple settings are visible.
async function enrichWithContext(rows) {
  const groupIds = [...new Set(rows.filter((r) => r.group_id).map((r) => r.group_id))];
  const titleIds = [...new Set(rows.filter((r) => r.title_id).map((r) => r.title_id))];

  const compQuery = `
    SELECT c.number_of_voices, c.tone, c.tone_connector, c.even_odd,
           ct.name AS type_name,
           (SELECT string_agg(DISTINCT comp.name, ', ')
              FROM composers comp
              WHERE comp.id = ANY(c.composer_id_list) AND comp.id != 23) AS composers`;

  const editionsByGroup = {};
  const compsByGroup = {};
  if (groupIds.length) {
    const ed = await pool.query(
      `SELECT e.group_id, ed.name AS editor_name, e.voicing, e.file_url
       FROM editions e LEFT JOIN editors ed ON ed.id = e.editor_id
       WHERE e.group_id = ANY($1)`,
      [groupIds]
    );
    ed.rows.forEach((r) => { (editionsByGroup[r.group_id] ||= []).push(r); });

    const comps = await pool.query(
      `${compQuery}, c.group_id
       FROM compositions c LEFT JOIN composition_types ct ON ct.id = c.composition_type_id
       WHERE c.group_id = ANY($1)`,
      [groupIds]
    );
    comps.rows.forEach((r) => { (compsByGroup[r.group_id] ||= []).push(r); });
  }

  const compsByTitle = {};
  const editionsByTitle = {};
  if (titleIds.length) {
    const comps = await pool.query(
      `${compQuery}, c.title_id, g.display_title AS group_title,
              (SELECT COUNT(*) FROM editions e WHERE e.group_id = c.group_id) AS edition_count
       FROM compositions c
       LEFT JOIN composition_types ct ON ct.id = c.composition_type_id
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.title_id = ANY($1)`,
      [titleIds]
    );
    comps.rows.forEach((r) => { (compsByTitle[r.title_id] ||= []).push(r); });

    // Editions of any setting carrying the title — useful for checking what
    // the text actually is when reviewing a title->function suggestion.
    const eds = await pool.query(
      `SELECT DISTINCT c.title_id, e.id, ed.name AS editor_name, e.voicing, e.file_url,
              g.display_title AS group_title
       FROM compositions c
       JOIN editions e ON e.group_id = c.group_id
       LEFT JOIN editors ed ON ed.id = e.editor_id
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.title_id = ANY($1)`,
      [titleIds]
    );
    eds.rows.forEach((r) => { (editionsByTitle[r.title_id] ||= []).push(r); });
  }

  rows.forEach((r) => {
    if (r.group_id) {
      r.editions = editionsByGroup[r.group_id] || [];
      r.compositions = compsByGroup[r.group_id] || [];
    } else if (r.title_id) {
      r.compositions = compsByTitle[r.title_id] || [];
      r.editions = (editionsByTitle[r.title_id] || []).slice(0, 8);
    }
  });
}

// List queue items with joined display context
router.get('/', async (req, res) => {
  try {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
    const status = ['pending', 'accepted', 'rejected', 'skipped'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const params = [status];
    let where = 'WHERE s.status = $1';
    if (kind) {
      params.push(kind);
      where += ` AND s.kind = $${params.length}`;
    }
    params.push(limit, (page - 1) * limit);

    const result = await pool.query(`
      SELECT s.id, s.kind, s.title_id, s.group_id, s.payload, s.score, s.source,
             s.status, s.created_at,
             t.text AS title_text,
             g.display_title AS group_title,
             (
               SELECT string_agg(DISTINCT comp.name, ', ')
               FROM compositions c
               CROSS JOIN LATERAL unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS cid
               JOIN composers comp ON comp.id = cid AND comp.id != 23
               WHERE c.group_id = s.group_id
             ) AS group_composers
      FROM suggestions s
      LEFT JOIN titles t ON t.id = s.title_id
      LEFT JOIN groups g ON g.id = s.group_id
      ${where}
      ORDER BY s.score DESC, s.id
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const rows = result.rows;
    await enrichWithContext(rows);

    const counts = await pool.query(`
      SELECT kind, COUNT(*) AS pending
      FROM suggestions WHERE status = 'pending' GROUP BY kind
    `);

    res.json({
      suggestions: rows,
      pendingCounts: Object.fromEntries(counts.rows.map((r) => [r.kind, parseInt(r.pending)])),
    });
  } catch (error) {
    console.error('List suggestions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Review a suggestion: accept applies the change, reject/skip just record it.
router.post('/:id/:action', async (req, res) => {
  const newStatus = REVIEW_ACTIONS[req.params.action];
  if (!newStatus) return res.status(400).json({ error: 'Unknown action' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT * FROM suggestions WHERE id = $1 AND status IN ('pending', 'skipped') FOR UPDATE`,
      [parseInt(req.params.id, 10) || 0]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Suggestion not found or already reviewed' });
    }
    const s = found.rows[0];
    const payload = s.payload || {};

    if (newStatus === 'accepted') {
      if (s.kind === 'title_function') {
        const functionId = parseInt(payload.function_id, 10);
        if (!s.title_id || !Number.isInteger(functionId)) {
          throw new Error('Suggestion payload missing title/function');
        }
        await client.query(
          `INSERT INTO functions_titles (function_id, title_id)
           SELECT $1, $2
           WHERE NOT EXISTS (
             SELECT 1 FROM functions_titles WHERE function_id = $1 AND title_id = $2
           )`,
          [functionId, s.title_id]
        );
        if (payload.cantus_id) {
          await client.query(
            'UPDATE titles SET cantus_id = $1 WHERE id = $2 AND cantus_id IS NULL',
            [String(payload.cantus_id), s.title_id]
          );
        }
      } else if (s.kind === 'recording_youtube' || s.kind === 'recording_spotify') {
        const url = String(payload.url || '').trim();
        // The reviewer may correct the performer name at accept time (the API
        // guess is often wrong or inconsistently spelt vs existing records).
        const override = typeof req.body.performer_name === 'string' ? req.body.performer_name.trim() : '';
        const performerName = (override || String(payload.performer_name || '').trim()).slice(0, 300);
        if (!s.group_id || !url) {
          throw new Error('Suggestion payload missing group/url');
        }
        let performerId = null;
        if (performerName) {
          const existing = await client.query(
            'SELECT id FROM performers WHERE LOWER(name) = LOWER($1) LIMIT 1',
            [performerName]
          );
          if (existing.rows.length) {
            performerId = existing.rows[0].id;
          } else {
            const created = await client.query(
              `INSERT INTO performers (name, created_at, updated_at)
               VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
              [performerName]
            );
            performerId = created.rows[0].id;
          }
        }
        await client.query(
          `INSERT INTO recordings (group_id, performer_id, file_url, created_at, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [s.group_id, performerId, url]
        );
      } else {
        throw new Error(`Unknown suggestion kind: ${s.kind}`);
      }
    }

    await client.query(
      `UPDATE suggestions SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
      [newStatus, req.user.id, s.id]
    );

    try {
      await client.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.id,
          req.user.email,
          'UPDATE',
          'suggestions',
          s.id,
          null,
          JSON.stringify({ kind: s.kind, action: newStatus, title_id: s.title_id, group_id: s.group_id }),
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped:', auditError.message);
    }

    await client.query('COMMIT');
    res.json({ success: true, status: newStatus });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Review suggestion error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;
