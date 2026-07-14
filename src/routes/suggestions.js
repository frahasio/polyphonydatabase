import express from 'express';
import { pool } from '../db.js';
import { triggerCleanup } from '../cleanup.js';

// Review queue for automated suggestions. Mounted under /api/admin behind
// requireAuthWeb + requirePermission('catalogue') so catalogue users (not
// just admins) can churn through it.
const router = express.Router();

const KINDS = ['title_function', 'recording_youtube', 'recording_spotify', 'title_merge', 'title_language', 'composer_bio', 'group_title'];
const REVIEW_ACTIONS = { accept: 'accepted', reject: 'rejected', skip: 'skipped' };

// Attach disambiguating context to each suggestion so reviewers can tell
// exactly which piece is meant: the distinguishing composition attributes
// (voices, type, tone, even/odd, composer) and any existing editions to
// check a recording against. Group-based suggestions (recordings) use the
// group's compositions + editions; title-based (title_function) use every
// composition that carries that title, so multiple settings are visible.
async function enrichWithContext(rows) {
  const groupIds = [...new Set(rows.filter((r) => r.group_id).map((r) => r.group_id))];
  // title_merge suggestions involve a second title (payload.other_title_id);
  // pull its context too so the reviewer can compare both sides.
  const otherIdOf = (r) => (r.kind === 'title_merge' ? parseInt((r.payload || {}).other_title_id, 10) || null : null);
  const titleIds = [...new Set(rows.flatMap((r) => [r.title_id, otherIdOf(r)].filter(Boolean)))];

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
      `${compQuery}, c.group_id, ti.text AS title_text
       FROM compositions c
       LEFT JOIN composition_types ct ON ct.id = c.composition_type_id
       LEFT JOIN titles ti ON ti.id = c.title_id
       WHERE c.group_id = ANY($1)`,
      [groupIds]
    );
    comps.rows.forEach((r) => { (compsByGroup[r.group_id] ||= []).push(r); });
  }

  const compsByTitle = {};
  const editionsByTitle = {};
  const titleInfo = {};
  if (titleIds.length) {
    // Current text + function list per title (merge cards compare these).
    const info = await pool.query(
      `SELECT t.id, t.text,
              ARRAY(SELECT f.name FROM functions_titles ft JOIN functions f ON f.id = ft.function_id
                    WHERE ft.title_id = t.id ORDER BY f.name) AS function_names
       FROM titles t WHERE t.id = ANY($1)`,
      [titleIds]
    );
    info.rows.forEach((r) => { titleInfo[r.id] = r; });
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
      if (r.kind === 'group_title') {
        // The payload options are a snapshot from matcher time; titles get
        // edited, so the card must offer the group's CURRENT composition
        // titles, most frequent first.
        const counts = new Map();
        r.compositions.forEach((c) => {
          if (c.title_text) counts.set(c.title_text, (counts.get(c.title_text) || 0) + 1);
        });
        r.live_options = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      }
    } else if (r.title_id) {
      r.compositions = compsByTitle[r.title_id] || [];
      r.editions = (editionsByTitle[r.title_id] || []).slice(0, 8);
      const main = titleInfo[r.title_id];
      if (main) r.title_functions = main.function_names;
      const otherId = otherIdOf(r);
      if (otherId) {
        const other = titleInfo[otherId];
        r.other_title_exists = Boolean(other);
        r.other_title_text = other ? other.text : (r.payload || {}).other_text;
        r.other_title_functions = other ? other.function_names : [];
        r.other_compositions = compsByTitle[otherId] || [];
      }
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
      SELECT s.id, s.kind, s.title_id, s.group_id, s.composer_id, s.payload, s.score, s.source,
             s.status, s.created_at,
             t.text AS title_text,
             g.display_title AS group_title,
             row_to_json(cmp) AS composer,
             (
               SELECT COUNT(*) FROM compositions c
               WHERE s.composer_id IS NOT NULL AND s.composer_id = ANY(c.composer_id_list)
             ) AS composer_comp_count,
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
      LEFT JOIN composers cmp ON cmp.id = s.composer_id
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
      if (s.kind === 'title_function' && Array.isArray(req.body.function_selections)) {
        // Multi-function card (Divinum Officium): the reviewer ticked one
        // or more functions; each links (or is created) independently.
        if (!s.title_id) throw new Error('Suggestion payload missing title');
        const selections = req.body.function_selections
          .map((sel) => ({
            id: parseInt(sel && sel.function_id, 10),
            name: String((sel && sel.function_name) || '').trim().slice(0, 200),
          }))
          .filter((sel) => Number.isInteger(sel.id) || sel.name);
        if (!selections.length) throw new Error('No functions selected');
        for (const sel of selections) {
          let functionId = Number.isInteger(sel.id) ? sel.id : null;
          if (!functionId) {
            const existing = await client.query(
              'SELECT id FROM functions WHERE LOWER(name) = LOWER($1) LIMIT 1',
              [sel.name]
            );
            functionId = existing.rows.length
              ? existing.rows[0].id
              : (await client.query(
                  `INSERT INTO functions (name, created_at, updated_at)
                   VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
                  [sel.name]
                )).rows[0].id;
          }
          await client.query(
            `INSERT INTO functions_titles (function_id, title_id)
             SELECT $1, $2
             WHERE NOT EXISTS (
               SELECT 1 FROM functions_titles WHERE function_id = $1 AND title_id = $2
             )`,
            [functionId, s.title_id]
          );
        }
      } else if (s.kind === 'title_function') {
        if (!s.title_id) throw new Error('Suggestion payload missing title');
        // The reviewer may correct the feast at accept time (the matcher's
        // guess is sometimes the wrong feast, or a feast we don't have yet).
        // A name that matches an existing function links to it; an unknown
        // name creates the function on the fly.
        const override = typeof req.body.function_name === 'string' ? req.body.function_name.trim() : '';
        let functionId = parseInt(payload.function_id, 10);
        const chosenName = (override || String(payload.function_name || '').trim()).slice(0, 200);
        // Only resolve by name when the reviewer actually CHANGED it — an
        // untouched prefill must use the stored id, or a function renamed
        // since the suggestion was created gets duplicated under its old
        // name by the create-on-the-fly path.
        const nameEdited = override && override !== String(payload.function_name || '').trim();
        if (nameEdited || !Number.isInteger(functionId)) {
          if (!chosenName) throw new Error('No feast/function name given');
          const existing = await client.query(
            'SELECT id, name FROM functions WHERE LOWER(name) = LOWER($1) LIMIT 1',
            [chosenName]
          );
          if (existing.rows.length) {
            functionId = existing.rows[0].id;
          } else {
            const created = await client.query(
              `INSERT INTO functions (name, created_at, updated_at)
               VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
              [chosenName]
            );
            functionId = created.rows[0].id;
          }
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
      } else if (s.kind === 'title_merge') {
        const otherId = parseInt(payload.other_title_id, 10);
        if (!s.title_id || !Number.isInteger(otherId)) {
          throw new Error('Suggestion payload missing titles to merge');
        }
        // The reviewer picks which title survives; default is the matcher's
        // suggested primary (the suggestion's title_id).
        const requested = parseInt(req.body.primary_title_id, 10);
        const primaryId = requested === otherId ? otherId : s.title_id;
        const sourceId = primaryId === otherId ? s.title_id : otherId;

        const both = await client.query(
          'SELECT id, cantus_id FROM titles WHERE id = ANY($1) FOR UPDATE',
          [[primaryId, sourceId]]
        );
        if (both.rows.length < 2) {
          // One side was already merged/deleted elsewhere; nothing to do.
          await client.query(
            `UPDATE suggestions SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
            [req.user.id, s.id]
          );
          await client.query('COMMIT');
          return res.json({ success: true, status: 'rejected', note: 'A title in this pair no longer exists.' });
        }

        await client.query(
          'UPDATE compositions SET title_id = $1, updated_at = CURRENT_TIMESTAMP WHERE title_id = $2',
          [primaryId, sourceId]
        );
        await client.query(
          `INSERT INTO functions_titles (function_id, title_id)
           SELECT ft.function_id, $1 FROM functions_titles ft
           WHERE ft.title_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM functions_titles x
               WHERE x.function_id = ft.function_id AND x.title_id = $1
             )`,
          [primaryId, sourceId]
        );
        await client.query('DELETE FROM functions_titles WHERE title_id = $1', [sourceId]);
        const cantus = both.rows.find((r) => r.id === sourceId)?.cantus_id;
        if (cantus) {
          await client.query(
            'UPDATE titles SET cantus_id = $1 WHERE id = $2 AND cantus_id IS NULL',
            [cantus, primaryId]
          );
        }
        // Deleting the source cascades away its other pending suggestions.
        await client.query('DELETE FROM titles WHERE id = $1', [sourceId]);
      } else if (s.kind === 'title_language') {
        if (!s.title_id) throw new Error('Suggestion payload missing title');
        // The reviewer may correct the guessed language at accept time.
        const bodyLang = parseInt(req.body.language_id, 10);
        const languageId = Number.isInteger(bodyLang) ? bodyLang : parseInt(payload.language_id, 10);
        if (!Number.isInteger(languageId)) throw new Error('No language given');
        const lang = await client.query('SELECT id FROM languages WHERE id = $1', [languageId]);
        if (!lang.rows.length) throw new Error('Unknown language');
        await client.query(
          'UPDATE titles SET language = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [languageId, s.title_id]
        );
      } else if (s.kind === 'composer_bio') {
        if (!s.composer_id) throw new Error('Suggestion payload missing composer');
        // Wikidata values win where present (they're cited; the card shows
        // every replacement before accept). Fields Wikidata doesn't know
        // (null payload values) keep their current value. Overwriting a year
        // also overwrites its annotation, so a precise Wikidata year clears
        // a stale "c.".
        const year = (v) => (Number.isInteger(parseInt(v, 10)) ? parseInt(v, 10) : null);
        const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
        await client.query(
          `UPDATE composers SET
             from_year_annotation = CASE WHEN $2::int IS NOT NULL THEN $3 ELSE from_year_annotation END,
             from_year = COALESCE($2, from_year),
             to_year_annotation = CASE WHEN $4::int IS NOT NULL THEN $5 ELSE to_year_annotation END,
             to_year = COALESCE($4, to_year),
             birthplace_1 = COALESCE($6, birthplace_1),
             birthplace_2 = COALESCE($7, birthplace_2),
             deathplace_1 = COALESCE($8, deathplace_1),
             deathplace_2 = COALESCE($9, deathplace_2),
             wikidata_id = COALESCE($10, wikidata_id),
             rism_id = COALESCE($11, rism_id),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            s.composer_id,
            year(payload.from_year), text(payload.from_year_annotation),
            year(payload.to_year), text(payload.to_year_annotation),
            text(payload.birthplace_1), text(payload.birthplace_2),
            text(payload.deathplace_1), text(payload.deathplace_2),
            text(payload.wikidata_id),
            text(payload.rism_id),
          ]
        );
      } else if (s.kind === 'group_title') {
        if (!s.group_id) throw new Error('Suggestion payload missing group');
        // Work from the group's CURRENT titles, never the payload snapshot —
        // titles are routinely edited between matcher run and review.
        const live = await client.query(
          `SELECT t.text FROM compositions c JOIN titles t ON t.id = c.title_id
           WHERE c.group_id = $1 GROUP BY t.text ORDER BY COUNT(*) DESC`,
          [s.group_id]
        );
        const options = live.rows.map((r) => r.text);
        const grp = await client.query('SELECT display_title FROM groups WHERE id = $1', [s.group_id]);
        const currentDisplay = grp.rows.length ? grp.rows[0].display_title : null;
        if (options.includes(currentDisplay) && req.body.apply_to_compositions !== true && !req.body.display_title) {
          // Mismatch already fixed elsewhere (e.g. via the titles editor) —
          // accepting just clears the card.
          await client.query(
            `UPDATE suggestions SET status = 'accepted', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
            [req.user.id, s.id]
          );
          await client.query('COMMIT');
          return res.json({ success: true, status: 'accepted', note: 'Already resolved; nothing to change.' });
        }
        if (req.body.apply_to_compositions === true) {
          // Reverse direction: the display title is the corrected one (common
          // for anons where the source title keeps historical tagging), so
          // retitle the group's composition(s) to match it. Only offered when
          // the group has a single distinct composition title.
          if (options.length !== 1) throw new Error('Group has multiple composition titles');
          const targetText = String(currentDisplay || '').trim();
          if (!targetText) throw new Error('No display title recorded');
          const oldTitle = await client.query(
            'SELECT id, language FROM titles WHERE text = $1',
            [options[0]]
          );
          let targetId;
          const existing = await client.query('SELECT id FROM titles WHERE text = $1', [targetText]);
          if (existing.rows.length) {
            targetId = existing.rows[0].id;
          } else {
            const created = await client.query(
              `INSERT INTO titles (text, language, created_at, updated_at)
               VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
              [targetText, oldTitle.rows.length ? oldTitle.rows[0].language : null]
            );
            targetId = created.rows[0].id;
          }
          if (oldTitle.rows.length && oldTitle.rows[0].id !== targetId) {
            // Carry the feast links across so the retitled setting keeps them.
            // The old title row is untouched — it may be shared by other
            // groups; orphan cleanup removes it if nothing uses it any more.
            await client.query(
              `INSERT INTO functions_titles (function_id, title_id)
               SELECT ft.function_id, $1 FROM functions_titles ft
               WHERE ft.title_id = $2
                 AND NOT EXISTS (
                   SELECT 1 FROM functions_titles x
                   WHERE x.function_id = ft.function_id AND x.title_id = $1
                 )`,
              [targetId, oldTitle.rows[0].id]
            );
          }
          await client.query(
            'UPDATE compositions SET title_id = $1, updated_at = CURRENT_TIMESTAMP WHERE group_id = $2',
            [targetId, s.group_id]
          );
        } else {
          // Normal direction: the reviewer picks which composition title
          // becomes the group's display title. The choice must be one of the
          // group's CURRENT titles.
          const requested = typeof req.body.display_title === 'string' ? req.body.display_title : '';
          let chosen = null;
          if (requested) {
            if (!options.includes(requested)) {
              throw new Error('That title is no longer one of this group\'s composition titles — reload the queue.');
            }
            chosen = requested;
          } else {
            chosen = options.includes(payload.proposed_title) ? payload.proposed_title : options[0];
          }
          if (!chosen) throw new Error('No display title given');
          await client.query(
            'UPDATE groups SET display_title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [chosen, s.group_id]
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
          JSON.stringify({ kind: s.kind, action: newStatus, title_id: s.title_id, group_id: s.group_id, composer_id: s.composer_id }),
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped:', auditError.message);
    }

    await client.query('COMMIT');
    if (newStatus === 'accepted' &&
        (s.kind === 'title_merge' || (s.kind === 'group_title' && req.body.apply_to_compositions === true))) {
      // Merges and composition retitles can orphan a title row.
      triggerCleanup(true, 'all', 'after review-queue title change', 3000);
    }
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
