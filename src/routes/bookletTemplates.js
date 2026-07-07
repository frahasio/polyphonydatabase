import express from 'express';
import { pool } from '../db.js';

// Booklet template library. Mounted under /api/booklet/templates behind
// requireAuthWeb + requirePermission('booklet_creator') — any booklet user
// can browse, load and publish their own templates. OFFICIAL templates can
// only be created/updated/deleted by admins; user templates by their owner
// (or an admin).
const router = express.Router();

const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

function validProject(project) {
  return project && typeof project === 'object' && Array.isArray(project.blocks);
}

// Browse/search: no project payloads (they can be large)
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE (t.name ILIKE $1 OR t.description ILIKE $1 OR t.season ILIKE $1 OR t.owner_name ILIKE $1)`;
    }
    const result = await pool.query(`
      SELECT t.id, t.name, t.description, t.season, t.feast_key, t.official,
             t.office_type, t.feast_month, t.feast_day, t.easter_offset,
             t.owner_id, t.owner_name, t.updated_at
      FROM booklet_templates t
      ${where}
      ORDER BY t.official DESC, t.season, t.name
      LIMIT 500
    `, params);
    res.json({ templates: result.rows, currentUserId: req.user.id, isAdmin: req.user.role === 'admin' });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Load one template's full project
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, season, official, owner_name, project FROM booklet_templates WHERE id = $1',
      [parseInt(req.params.id, 10) || 0]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: result.rows[0] });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Publish a template (any booklet user). Admins may mark it official.
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 200);
    const description = String(req.body.description || '').trim().slice(0, 1000);
    const season = String(req.body.season || '').trim().slice(0, 100);
    const officeType = ['mass', 'office', 'other'].includes(req.body.office_type) ? req.body.office_type : 'mass';
    const project = req.body.project;
    const official = req.user.role === 'admin' && !!req.body.official;
    const feastMonth = parseInt(req.body.feast_month, 10) || null;
    const feastDay = parseInt(req.body.feast_day, 10) || null;
    const hasDate = feastMonth >= 1 && feastMonth <= 12 && feastDay >= 1 && feastDay <= 31;
    // Easter-relative placement is an admin facility (official temporale docs).
    let easterOffset = null;
    if (req.user.role === 'admin' && req.body.easter_offset !== undefined && req.body.easter_offset !== null && req.body.easter_offset !== '') {
      const eo = parseInt(req.body.easter_offset, 10);
      if (Number.isInteger(eo) && eo >= -100 && eo <= 200) easterOffset = eo;
    }

    if (!name) return res.status(400).json({ error: 'A template name is required' });
    if (!validProject(project)) return res.status(400).json({ error: 'Invalid project payload' });
    if (JSON.stringify(project).length > MAX_PROJECT_BYTES) {
      return res.status(400).json({ error: 'Template too large' });
    }

    const result = await pool.query(`
      INSERT INTO booklet_templates (name, description, season, office_type, official, owner_id, owner_name, project, feast_month, feast_day, easter_offset)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, name, official
    `, [name, description, season, officeType, official, req.user.id, official ? '' : (req.user.name || req.user.email), JSON.stringify(project),
      hasDate ? feastMonth : null, hasDate ? feastDay : null, easterOffset]);

    res.status(201).json({ message: 'Template published', template: result.rows[0] });
  } catch (error) {
    console.error('Publish template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Load a template row and check the current user may modify it.
async function loadEditable(req, res) {
  const id = parseInt(req.params.id, 10) || 0;
  const found = await pool.query('SELECT * FROM booklet_templates WHERE id = $1', [id]);
  if (!found.rows.length) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  const t = found.rows[0];
  const isAdmin = req.user.role === 'admin';
  if (t.official && !isAdmin) {
    res.status(403).json({ error: 'Only admins can modify official templates' });
    return null;
  }
  if (!t.official && t.owner_id !== req.user.id && !isAdmin) {
    res.status(403).json({ error: 'You can only modify your own templates' });
    return null;
  }
  return t;
}

// Overwrite a template with a new project (and optionally rename/describe)
router.put('/:id', async (req, res) => {
  try {
    const t = await loadEditable(req, res);
    if (!t) return;

    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 200) : t.name;
    const description = req.body.description !== undefined ? String(req.body.description).trim().slice(0, 1000) : t.description;
    const season = req.body.season !== undefined ? String(req.body.season).trim().slice(0, 100) : t.season;
    const officeType = ['mass', 'office', 'other'].includes(req.body.office_type) ? req.body.office_type : t.office_type;
    let feastMonth = t.feast_month;
    let feastDay = t.feast_day;
    if (req.body.feast_month !== undefined || req.body.feast_day !== undefined) {
      const fm = parseInt(req.body.feast_month, 10) || null;
      const fd = parseInt(req.body.feast_day, 10) || null;
      const ok = fm >= 1 && fm <= 12 && fd >= 1 && fd <= 31;
      feastMonth = ok ? fm : null;
      feastDay = ok ? fd : null;
    }
    let easterOffset = t.easter_offset;
    if (req.user.role === 'admin' && req.body.easter_offset !== undefined) {
      const eo = parseInt(req.body.easter_offset, 10);
      easterOffset = Number.isInteger(eo) && eo >= -100 && eo <= 200 ? eo : null;
    }
    let projectJson = null;
    if (req.body.project !== undefined) {
      if (!validProject(req.body.project)) return res.status(400).json({ error: 'Invalid project payload' });
      projectJson = JSON.stringify(req.body.project);
      if (projectJson.length > MAX_PROJECT_BYTES) return res.status(400).json({ error: 'Template too large' });
    }

    await pool.query(`
      UPDATE booklet_templates
      SET name = $1, description = $2, season = $3, office_type = $4,
          feast_month = $5, feast_day = $6, easter_offset = $7,
          project = COALESCE($8::jsonb, project), updated_at = NOW()
      WHERE id = $9
    `, [name, description, season, officeType, feastMonth, feastDay, easterOffset, projectJson, t.id]);

    res.json({ message: 'Template updated' });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a template
router.delete('/:id', async (req, res) => {
  try {
    const t = await loadEditable(req, res);
    if (!t) return;
    await pool.query('DELETE FROM booklet_templates WHERE id = $1', [t.id]);
    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
