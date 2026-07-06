import express from 'express';
import XLSX from 'xlsx';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { triggerCleanup } from '../cleanup.js';

const router = express.Router();

// Apply authentication to all routes in this router
router.use(requireAuth);

// Serialize a stored clef object back into the importer's text notation
// ([x]=missing, (x)=optional, {x}=incomplete, x>y=transition).
function serializeClef(c) {
  if (!c || !c.clef) return '';
  let token = String(c.clef);
  if (Array.isArray(c.transitions_to) && c.transitions_to.length) {
    token = [token, ...c.transitions_to].join('>');
  }
  if (c.incomplete) token = `{${token}}`;
  if (c.optional) token = `(${token})`;
  if (c.missing) token = `[${token}]`;
  return token;
}

function evenOddToText(v) {
  if (v === 0) return 'even';
  if (v === 1) return 'odd';
  if (v === 2) return 'both';
  return '';
}

// Export a source as an XLSX in the same format the importer reads, so a
// source can be round-tripped (edit in a spreadsheet, re-import elsewhere).
router.get('/:id/export', async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId)) {
      return res.status(400).json({ error: 'Invalid source id' });
    }

    const srcResult = await pool.query(`
      SELECT s.*,
        COALESCE((SELECT json_agg(p.name ORDER BY p.name)
                  FROM publishers_sources ps JOIN publishers p ON p.id = ps.publisher_id
                  WHERE ps.source_id = s.id), '[]') AS publishers,
        COALESCE((SELECT json_agg(sc.name ORDER BY sc.name)
                  FROM scribes_sources ss JOIN scribes sc ON sc.id = ss.scribe_id
                  WHERE ss.source_id = s.id), '[]') AS scribes
      FROM sources s WHERE s.id = $1
    `, [sourceId]);
    if (srcResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    const s = srcResult.rows[0];

    const inclResult = await pool.query(`
      SELECT i.position, i.notes, i.attribution_texts, i.clefs, i."order",
             t.text AS title_text,
             ct.name AS composition_type_name,
             c.tone, c.tone_connector, c.even_odd,
             COALESCE((SELECT json_agg(comp.name ORDER BY comp.id)
                       FROM composers comp
                       WHERE comp.id = ANY(
                         CASE WHEN jsonb_typeof(i.composer_ids) = 'array'
                           THEN ARRAY(SELECT jsonb_array_elements_text(i.composer_ids)::int)
                           ELSE '{}'::int[] END)
                         AND comp.id != 23), '[]') AS composer_names
      FROM inclusions i
      LEFT JOIN compositions c ON i.composition_id = c.id
      LEFT JOIN titles t ON c.title_id = t.id
      LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
      WHERE i.source_id = $1
      ORDER BY i."order", i.id
    `, [sourceId]);

    const imgResult = await pool.query(
      'SELECT url, label FROM source_images WHERE source_id = $1 ORDER BY id', [sourceId]
    );

    const wb = XLSX.utils.book_new();

    const sourceHeaders = [
      'code', 'title', 'type', 'format', 'town', 'rism_link',
      'notes', 'from_year', 'to_year', 'from_year_annotation',
      'to_year_annotation', 'catalogued', 'publishers', 'scribes'
    ];
    const sourceRow = [
      s.code || '', s.title || '', s.type || '', s.format || '', s.town || '',
      s.rism_link || '', s.notes || '', s.from_year ?? '', s.to_year ?? '',
      s.from_year_annotation || '', s.to_year_annotation || '',
      s.catalogued ? 'TRUE' : 'FALSE',
      (s.publishers || []).join('; '), (s.scribes || []).join('; ')
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sourceHeaders, sourceRow]), 'Source');

    // Mirror the import template exactly: base columns, then clef_1..clef_16
    // individual-clef columns whose values feed a TEXTJOIN formula in the
    // "clefs" column (so users can edit clefs cell-by-cell after exporting).
    const CLEF_COLS = 16;
    const clefHeaders = Array.from({ length: CLEF_COLS }, (_, i) => `clef_${i + 1}`);
    const inclHeaders = [
      'position', 'title_text', 'composition_type', 'tone', 'tone_connector',
      'even_odd', 'clefs', 'composer_names', 'attribution_text', 'notes',
      ...clefHeaders
    ];

    const inclRows = inclResult.rows.map((r) => {
      const clefTokens = (Array.isArray(r.clefs) ? r.clefs : []).map(serializeClef).filter(Boolean);
      const toneArr = Array.isArray(r.tone) ? r.tone : (r.tone ? [r.tone] : []);
      const attribution = Array.isArray(r.attribution_texts)
        ? r.attribution_texts.filter(Boolean).join('; ')
        : '';
      const clefCells = Array.from({ length: CLEF_COLS }, (_, i) => clefTokens[i] || '');
      // If somehow more than 16 clefs, keep the full joined string in "clefs"
      // (formula would only cover 16); otherwise leave "clefs" for the formula.
      const clefsOverflow = clefTokens.length > CLEF_COLS ? clefTokens.join(';') : '';
      const connector = toneArr.length >= 2 ? (r.tone_connector || '') : '';
      return [
        r.position || '',
        r.title_text || '',
        r.composition_type_name || '',
        toneArr.join(';'),
        connector,
        evenOddToText(r.even_odd),
        clefsOverflow,
        (r.composer_names || []).join('; '),
        attribution,
        r.notes || '',
        ...clefCells
      ];
    });

    const inclSheet = XLSX.utils.aoa_to_sheet([inclHeaders, ...inclRows]);
    const clefsColIdx = inclHeaders.indexOf('clefs');
    const firstClefColLetter = XLSX.utils.encode_col(inclHeaders.indexOf('clef_1'));
    const lastClefColLetter = XLSX.utils.encode_col(inclHeaders.indexOf(`clef_${CLEF_COLS}`));
    // Put the TEXTJOIN formula in each data row's "clefs" cell, except overflow
    // rows which already hold a static joined value.
    inclResult.rows.forEach((r, idx) => {
      const clefTokens = (Array.isArray(r.clefs) ? r.clefs : []).map(serializeClef).filter(Boolean);
      if (clefTokens.length > CLEF_COLS) return; // keep static overflow value
      const excelRow = idx + 2; // row 1 is the header
      const cellRef = XLSX.utils.encode_cell({ c: clefsColIdx, r: idx + 1 });
      inclSheet[cellRef] = {
        t: 's',
        v: clefTokens.join(';'), // cached value so programmatic re-import works without Excel
        f: `_xlfn.TEXTJOIN(";",TRUE,${firstClefColLetter}${excelRow}:${lastClefColLetter}${excelRow})`
      };
    });
    inclSheet['!cols'] = inclHeaders.map((h) => {
      if (h === 'title_text' || h === 'composer_names') return { wch: 30 };
      if (h === 'clefs') return { wch: 25 };
      if (h.startsWith('clef_')) return { wch: 8 };
      return { wch: 16 };
    });
    XLSX.utils.book_append_sheet(wb, inclSheet, 'Inclusions');

    const imageRows = imgResult.rows.map((r) => [r.url || '', r.label || '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['url', 'label'], ...imageRows]), 'Images');

    // Recalculate the clefs TEXTJOIN formulas when the file opens.
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.CalcPr = { fullCalcOnLoad: true };

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeCode = String(s.code || 'source').replace(/[^\w\-]+/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeCode}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (error) {
    console.error('Error exporting source:', error);
    res.status(500).json({ error: 'Failed to export source' });
  }
});

// Detect tone column type (cached)
let _toneIsArray = null;
async function toneIsArray() {
  if (_toneIsArray !== null) return _toneIsArray;
  try {
    const res = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'compositions' AND column_name = 'tone'
    `);
    _toneIsArray = res.rows.length > 0 && res.rows[0].data_type === 'ARRAY';
  } catch {
    _toneIsArray = false;
  }
  return _toneIsArray;
}

const VALID_TONES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const SPECIAL_TONES = {
  'mix': 'mix', 'mixti': 'mix',
  'per': 'per', 'peregrini': 'per',
  'pro': 'pro', 'proprii': 'pro'
};

function normalizeSingleTone(val) {
  if (!val) return null;
  const s = String(val).toLowerCase().trim();
  if (SPECIAL_TONES[s]) return SPECIAL_TONES[s];
  if (VALID_TONES.includes(s)) return s;
  return null;
}

// Convert tone input to the appropriate format for the database.
// Returns text[] if column is array type, single string if varchar.
async function convertToneForDB(toneValue) {
  if (!toneValue) return null;
  const arr = Array.isArray(toneValue) ? toneValue : [toneValue];
  const normalized = arr.map(normalizeSingleTone).filter(Boolean);
  if (normalized.length === 0) return null;

  const isArr = await toneIsArray();
  if (isArr) return normalized;           // text[]
  return normalized[0];                   // varchar: take first value
}

// Aliases used throughout the save logic
function convertToneToString(toneValue) {
  return convertToneForDB(toneValue);
}
function convertToneToArray(toneValue) {
  return convertToneForDB(toneValue);
}

// Get list of sources (with pagination)
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    const cataloguedFilter = req.query.catalogued;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const queryParams = [];
    const whereConditions = [];

    if (searchTerm) {
      whereConditions.push(`(s.code ILIKE $${queryParams.length + 1} OR s.title ILIKE $${queryParams.length + 1})`);
      queryParams.push(`%${searchTerm}%`);
    }

    if (cataloguedFilter !== undefined) {
      const cataloguedValue = cataloguedFilter === 'true';
      whereConditions.push(`s.catalogued = $${queryParams.length + 1}`);
      queryParams.push(cataloguedValue);
    }

    const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM sources s${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    let query = `
      SELECT 
        s.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as publishers,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', sc.id,
              'name', sc.name
            )
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scribes
      FROM sources s
      LEFT JOIN publishers_sources ps ON s.id = ps.source_id
      LEFT JOIN publishers p ON ps.publisher_id = p.id
      LEFT JOIN scribes_sources ss ON s.id = ss.source_id
      LEFT JOIN scribes sc ON ss.scribe_id = sc.id
      ${whereClause}
      GROUP BY s.id
      ORDER BY s.code
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    res.json({
      sources: result.rows.map(row => ({
        ...row,
        publishers: row.publishers || [],
        scribes: row.scribes || []
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get composition types for dropdown (MUST be before /:id route)
router.get('/composition-types', async (req, res) => {
  try {
    // Check if table exists first
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'composition_types'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      // Return hardcoded list if table doesn't exist yet
      const hardcodedTypes = [
        {id: 1, name: "Mass"},
        {id: 2, name: "Hymn"},
        {id: 3, name: "Responsory"},
        {id: 4, name: "Alleluia"},
        {id: 5, name: "Instrumental"},
        {id: 6, name: "Introit"},
        {id: 7, name: "Lamentation"},
        {id: 8, name: "Litany"},
        {id: 9, name: "Passion"},
        {id: 10, name: "Service"},
        {id: 11, name: "Reading"},
        {id: 12, name: "Response(s)"},
        {id: 13, name: "Verse anthem"},
        {id: 14, name: "Round/canon"},
        {id: 15, name: "Reproaches"},
        {id: 16, name: "Alternatim psalm/canticle"},
        {id: 17, name: "Requiem/Burial service"},
        {id: 18, name: "Sequence"}
      ];
      return res.json(hardcodedTypes);
    }
    
    const result = await pool.query('SELECT id, name FROM composition_types ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composition types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all publishers for multi-select (MUST be before /:id route)
router.get('/publishers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM publishers ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all scribes for multi-select (MUST be before /:id route)
router.get('/scribes', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM scribes ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scribes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all composers for select dropdowns (MUST be before /:id route)
router.get('/composers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM composers ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Title autocomplete (MUST be before /:id route)
router.get('/titles/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 3) {
      return res.json([]);
    }
    
    const result = await pool.query(
      'SELECT id, text FROM titles WHERE text ILIKE $1 ORDER BY text LIMIT 20',
      [`${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching titles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get source by ID
router.get('/:id', async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const noPagination = !req.query.inclusions_page && !req.query.inclusions_limit;
    const inclusionsPage = parseInt(req.query.inclusions_page) || 1;
    const inclusionsLimit = noPagination ? null : (parseInt(req.query.inclusions_limit) || 40);
    const inclusionsOffset = noPagination ? 0 : ((inclusionsPage - 1) * inclusionsLimit);

    // Fetch source details with publishers, scribes, and images
    const sourceQuery = `
      SELECT 
        s.id,
        s.code,
        s.title,
        s.type,
        s.format,
        s.town,
        s.rism_link,
        s.catalogued,
        s.notes,
        s.created_at,
        s.updated_at,
        s.from_year,
        s.to_year,
        s.from_year_annotation,
        s.to_year_annotation,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as publishers,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', sc.id,
              'name', sc.name
            )
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scribes,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', si.id,
              'url', si.url,
              'label', si.label
            )
          ) FILTER (WHERE si.id IS NOT NULL),
          '[]'
        ) as source_images
      FROM sources s
      LEFT JOIN publishers_sources ps ON s.id = ps.source_id
      LEFT JOIN publishers p ON ps.publisher_id = p.id
      LEFT JOIN scribes_sources ss ON s.id = ss.source_id
      LEFT JOIN scribes sc ON ss.scribe_id = sc.id
      LEFT JOIN source_images si ON s.id = si.source_id
      WHERE s.id = $1
      GROUP BY s.id
    `;

    const sourceResult = await pool.query(sourceQuery, [sourceId]);
    
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const source = sourceResult.rows[0];

    // Fetch total count of inclusions
    const countQuery = `
      SELECT COUNT(*) 
      FROM inclusions 
      WHERE source_id = $1
    `;
    const countResult = await pool.query(countQuery, [sourceId]);
    const totalInclusions = parseInt(countResult.rows[0].count);

    const inclusionsQuery = `
      SELECT 
        i.id,
        i.source_id,
        i.composition_id,
        i.notes,
        i.order,
        i.position,
        i.attribution_texts,
        i.composer_ids,
        i.clefs,
        i.created_at,
        i.updated_at,
        t.text as title_text,
        ct.name as composition_type_name,
        c.composition_type_id,
        c.tone,
        c.tone_connector,
        c.even_odd,
        c.number_of_voices,
        COALESCE(cn.names, '[]'::json) as composer_names
      FROM inclusions i
      LEFT JOIN compositions c ON i.composition_id = c.id
      LEFT JOIN titles t ON c.title_id = t.id
      LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
      LEFT JOIN LATERAL (
        SELECT json_agg(comp.name ORDER BY comp.id) as names
        FROM composers comp
        WHERE comp.id = ANY(
          CASE 
            WHEN jsonb_typeof(i.composer_ids) = 'array' 
            THEN ARRAY(SELECT jsonb_array_elements_text(i.composer_ids)::integer)
            ELSE '{}'::integer[]
          END
        )
      ) cn ON true
      WHERE i.source_id = $1
      ORDER BY i.order, i.id
      ${inclusionsLimit ? 'LIMIT $2 OFFSET $3' : ''}
    `;

    const inclusionsResult = inclusionsLimit
      ? await pool.query(inclusionsQuery, [sourceId, inclusionsLimit, inclusionsOffset])
      : await pool.query(inclusionsQuery, [sourceId]);
    
    // Format inclusions to match schema
    const inclusions = inclusionsResult.rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      composition_id: row.composition_id,
      notes: row.notes,
      order: row.order,
      position: row.position,
      attribution_texts: row.attribution_texts || [],
      composer_ids: row.composer_ids || [],
      clefs: row.clefs || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Resolved composition data for display
      composition: {
        title_text: row.title_text,
        composition_type_name: row.composition_type_name,
        composition_type_id: row.composition_type_id,
        tone: row.tone,
        tone_connector: row.tone_connector,
        even_odd: row.even_odd,
        number_of_voices: row.number_of_voices,
        composer_names: row.composer_names || []
      }
    }));

    const response = {
      source: {
        ...source,
        publishers: source.publishers || [],
        scribes: source.scribes || []
      },
      inclusions
    };

    if (inclusionsLimit) {
      const totalInclusionsPages = Math.ceil(totalInclusions / inclusionsLimit);
      response.inclusions_pagination = {
        total: totalInclusions,
        page: inclusionsPage,
        limit: inclusionsLimit,
        totalPages: totalInclusionsPages,
        hasNextPage: inclusionsPage < totalInclusionsPages,
        hasPrevPage: inclusionsPage > 1
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new source
router.post('/', async (req, res) => {
  try {
    const { code, title, type, format, town, rismLink, catalogued } = req.body;
    const now = new Date();

    const query = `
      INSERT INTO sources (
        code, title, type, format, town, rism_link, catalogued,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rismLink, catalogued,
      now, now
    ]);

    const newData = result.rows[0];

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'CREATE',
          'sources',
          newData.id,
          null,
          JSON.stringify(newData)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update source
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      code, 
      title, 
      type, 
      format, 
      town, 
      rism_link, 
      catalogued,
      notes,
      from_year,
      to_year,
      from_year_annotation,
      to_year_annotation 
    } = req.body;
    const now = new Date();

    // Get old data for audit trail before updating
    const oldDataResult = await pool.query('SELECT * FROM sources WHERE id = $1', [id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    const oldData = oldDataResult.rows[0];

    const query = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, notes = $8, from_year = $9, to_year = $10,
          from_year_annotation = $11, to_year_annotation = $12, updated_at = $13
      WHERE id = $14
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rism_link, catalogued, notes,
      from_year, to_year, from_year_annotation, to_year_annotation, now, id
    ]);

    const newData = result.rows[0];

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'UPDATE',
          'sources',
          parseInt(id),
          JSON.stringify(oldData),
          JSON.stringify(newData)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete source
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    // Get data before deletion for audit trail
    const oldDataResult = await client.query('SELECT * FROM sources WHERE id = $1', [id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    const oldData = oldDataResult.rows[0];

    await client.query('BEGIN');

    // Delete related records first (in order of dependency)
    // 1. Delete source images
    await client.query('DELETE FROM source_images WHERE source_id = $1', [id]);
    
    // 2. Delete inclusions (compositions in this source)
    await client.query('DELETE FROM inclusions WHERE source_id = $1', [id]);
    
    // 3. Delete publisher relationships
    await client.query('DELETE FROM publishers_sources WHERE source_id = $1', [id]);
    
    // 4. Delete scribe relationships
    await client.query('DELETE FROM scribes_sources WHERE source_id = $1', [id]);
    
    // 5. Finally delete the source
    await client.query('DELETE FROM sources WHERE id = $1', [id]);

    await client.query('COMMIT');

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'DELETE',
          'sources',
          parseInt(id),
          JSON.stringify(oldData),
          null
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting source:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Core save logic shared by the save-with-inclusions route and the spreadsheet importer.
// Operates within a caller-provided transaction client; it does NOT manage
// BEGIN/COMMIT/ROLLBACK or release the client — that is the caller's responsibility.
// Returns { processedInclusions, deletedCount } so the caller can decide on cleanup / response.
export async function saveSourceWithInclusions(client, sourceId, source, inclusions, user, deletedInclusionIds = []) {
    const now = new Date();

    // Delete inclusions the user explicitly removed in the editor. Scoped to
    // this source so a stale/forged id cannot touch other sources' rows.
    const deleteIds = (Array.isArray(deletedInclusionIds) ? deletedInclusionIds : [])
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isInteger(n));
    let deletedCount = 0;
    if (deleteIds.length > 0) {
      const deleted = await client.query(
        'DELETE FROM inclusions WHERE source_id = $1 AND id = ANY($2::int[]) RETURNING id',
        [sourceId, deleteIds]
      );
      deletedCount = deleted.rowCount;
    }

    // Step 1: Update source data first
    const updateSourceQuery = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, notes = $8, from_year = $9, to_year = $10,
          from_year_annotation = $11, to_year_annotation = $12, updated_at = $13
      WHERE id = $14
      RETURNING *
    `;
    
    await client.query(updateSourceQuery, [
      source.code, 
      source.title, 
      source.type, 
      source.format, 
      source.town,
      source.rism_link, 
      source.catalogued,
      source.notes || null,
      source.from_year || null,
      source.to_year || null,
      source.from_year_annotation || null,
      source.to_year_annotation || null,
      now, 
      sourceId
    ]);
    
    // Update relationships (publishers, scribes, source images)
    if (source.publishers) {
      await client.query('DELETE FROM publishers_sources WHERE source_id = $1', [sourceId]);
      for (const publisherId of source.publishers) {
        if (publisherId) {
          await client.query(
            'INSERT INTO publishers_sources (publisher_id, source_id) VALUES ($1, $2)',
            [publisherId, sourceId]
          );
        }
      }
    }
    
    if (source.scribes) {
      await client.query('DELETE FROM scribes_sources WHERE source_id = $1', [sourceId]);
      for (const scribeId of source.scribes) {
        if (scribeId) {
          await client.query(
            'INSERT INTO scribes_sources (scribe_id, source_id) VALUES ($1, $2)',
            [scribeId, sourceId]
          );
        }
      }
    }
    
    if (source.source_images) {
      await client.query('DELETE FROM source_images WHERE source_id = $1', [sourceId]);
      for (const image of source.source_images) {
        if (image.url) {
          await client.query(
            'INSERT INTO source_images (source_id, url, label, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
            [sourceId, image.url, image.label || '', now, now]
          );
        }
      }
    }

    // Step 2: Handle form inclusions
    // Only process inclusions that have titles (non-empty rows)
    // Filter out null/undefined inclusions and those without titles
    const processedInclusions = (inclusions || []).filter(inclusion => 
      inclusion && inclusion.composition && inclusion.composition.title_text?.trim()
    );

    // Process each inclusion individually
    for (let i = 0; i < processedInclusions.length; i++) {
      const inclusion = processedInclusions[i];
      let compositionId = null;

      // Calculate number of voices from clefs
      let numberOfVoices = null;
      if (inclusion.clefs && inclusion.clefs.length > 0) {
        numberOfVoices = inclusion.clefs.filter(clef => 
          clef.clef && clef.clef.trim() && !clef.optional
        ).length;
        numberOfVoices = numberOfVoices > 0 ? numberOfVoices : null;
      }

      // Create or find title
      let titleResult = await client.query(`SELECT id FROM titles WHERE text = $1`, [inclusion.composition.title_text]);
      let titleId;
      if (titleResult.rows.length > 0) {
        titleId = titleResult.rows[0].id;
      } else {
        const newTitleResult = await client.query(`
          INSERT INTO titles (text, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
        `, [inclusion.composition.title_text, now, now]);
        titleId = newTitleResult.rows[0].id;
      }

      // Handle composition type
      let compositionTypeId = null;
      if (inclusion.composition.composition_type_id) {
        compositionTypeId = parseInt(inclusion.composition.composition_type_id);
      } else if (inclusion.composition.composition_type_name) {
        const typeResult = await client.query(`SELECT id FROM composition_types WHERE name = $1`, [inclusion.composition.composition_type_name]);
        if (typeResult.rows.length > 0) {
          compositionTypeId = parseInt(typeResult.rows[0].id);
        }
      }

      // Process tone, tone_connector and even_odd
      let tone = inclusion.composition.tone;
      if (tone !== null && tone !== undefined) tone = await convertToneToString(tone);
      const toneConnector = inclusion.composition.tone_connector || null;
      
      let evenOdd = inclusion.composition.even_odd;
      if (evenOdd === 'even') evenOdd = 0;
      else if (evenOdd === 'odd') evenOdd = 1;
      else if (evenOdd === 'both') evenOdd = 2;
      else if (typeof evenOdd === 'number') evenOdd = evenOdd;
      else evenOdd = null;

      const numberOfVoicesInt = inclusion.composition.number_of_voices ? parseInt(inclusion.composition.number_of_voices) : numberOfVoices;
      
      // Validate and default composer_ids to prevent null arrays
      let composerIds = inclusion.composer_ids || [];
      
      // If composer_ids is empty or contains nulls, default to Anon (id=23)
      if (!composerIds || composerIds.length === 0 || composerIds.every(id => !id || id === null)) {
        composerIds = [23];
      } else {
        // Filter out any null values and ensure all are valid integers
        composerIds = composerIds.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id)))
                                .map(id => parseInt(id));
        
        // If after filtering we have no valid IDs, default to Anon
        if (composerIds.length === 0) {
          composerIds = [23];
        }
      }
      
      const isAnonymous = composerIds.length === 1 && composerIds[0] === 23;

      // Check for existing composition
      let existingComposition = { rows: [] };
      
      if (isAnonymous) {
        // BUGFIX: Anonymous compositions should NEVER be matched against existing ones
        // Always create new compositions for anonymous works, even if they have identical properties
        existingComposition = { rows: [] }; // Force creation of new composition
      } else {
        existingComposition = await client.query(`
          SELECT id, group_id FROM compositions 
          WHERE title_id = $1 
          AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
          AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
          AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
          AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
          AND composer_id_list = $6
        `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt, composerIds]);
        
      }

      let groupId;
      if (existingComposition.rows.length > 0) {
        // Use existing composition
        compositionId = existingComposition.rows[0].id;
        groupId = existingComposition.rows[0].group_id;
        
        await client.query(`UPDATE compositions SET tone_connector = $1 WHERE id = $2`, [toneConnector, compositionId]);
        
        if (!groupId) {
                                // Create group for existing composition
          const newGroupResult = await client.query(`
            INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
          `, [inclusion.composition.title_text, now, now]);
          groupId = newGroupResult.rows[0].id;
          await client.query(`UPDATE compositions SET group_id = $1 WHERE id = $2`, [groupId, compositionId]);
        }
      } else {
        // No existing composition found - check if this is an update to an existing inclusion
        // that was previously unique (only inclusion for its composition)
        if (inclusion.id) {
          // Get the current composition this inclusion is linked to
          const currentCompositionResult = await client.query(`
            SELECT c.id, c.group_id, c.title_id, c.composition_type_id, c.tone, c.even_odd, c.number_of_voices, c.composer_id_list
            FROM compositions c
            JOIN inclusions i ON c.id = i.composition_id
            WHERE i.id = $1
          `, [inclusion.id]);
          
          if (currentCompositionResult.rows.length > 0) {
            const currentComposition = currentCompositionResult.rows[0];
            
            // Check if this composition has only this one inclusion
            const inclusionCountResult = await client.query(`
              SELECT COUNT(*) as count
              FROM inclusions
              WHERE composition_id = $1
            `, [currentComposition.id]);
            
            const inclusionCount = parseInt(inclusionCountResult.rows[0].count);
            
            if (inclusionCount === 1) {
              // This composition was unique - check if we need to merge with existing composition
              if (isAnonymous) {
                // For Anon compositions, skip merge logic and always update in place
                // Anon compositions are always unique and should not be merged
                // Update the existing composition with new details
                await client.query(`
                  UPDATE compositions SET 
                    title_id = $1,
                    composition_type_id = $2,
                    tone = $3,
                    tone_connector = $4,
                    even_odd = $5,
                    number_of_voices = $6,
                    composer_id_list = $7,
                    updated_at = $8
                  WHERE id = $9
                `, [titleId, compositionTypeId, tone, toneConnector, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, now, currentComposition.id]);
                compositionId = currentComposition.id;
                groupId = currentComposition.group_id;
                // If no group, create one
                if (!groupId) {
                  const newGroupResult = await client.query(`
                    INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
                  `, [inclusion.composition.title_text, now, now]);
                  groupId = newGroupResult.rows[0].id;
                  await client.query(`UPDATE compositions SET group_id = $1 WHERE id = $2`, [groupId, compositionId]);
                }
              } else {
                // Create new composition for non-anonymous works when properties change
                const newGroupResult = await client.query(`
                  INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
                `, [inclusion.composition.title_text, now, now]);
                groupId = newGroupResult.rows[0].id;
                
                const compositionResult = await client.query(`
                  INSERT INTO compositions (title_id, composition_type_id, tone, tone_connector, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
                `, [titleId, compositionTypeId, tone, toneConnector, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
                compositionId = compositionResult.rows[0].id;
              }
            } else {
              // Multiple inclusions exist - create new composition
              const newGroupResult = await client.query(`
                INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
              `, [inclusion.composition.title_text, now, now]);
              groupId = newGroupResult.rows[0].id;
              
              const compositionResult = await client.query(`
                INSERT INTO compositions (title_id, composition_type_id, tone, tone_connector, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
              `, [titleId, compositionTypeId, tone, toneConnector, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
              compositionId = compositionResult.rows[0].id;
            }
          } else {
            // Fallback - create new composition
            const newGroupResult = await client.query(`
              INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
            `, [inclusion.composition.title_text, now, now]);
            groupId = newGroupResult.rows[0].id;
            
            const compositionResult = await client.query(`
              INSERT INTO compositions (title_id, composition_type_id, tone, tone_connector, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
            `, [titleId, compositionTypeId, tone, toneConnector, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
            compositionId = compositionResult.rows[0].id;
          }
        } else {
          // New inclusion - create new composition
          const newGroupResult = await client.query(`
            INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
          `, [inclusion.composition.title_text, now, now]);
          groupId = newGroupResult.rows[0].id;
          
          const compositionResult = await client.query(`
            INSERT INTO compositions (title_id, composition_type_id, tone, tone_connector, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
          `, [titleId, compositionTypeId, tone, toneConnector, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
          compositionId = compositionResult.rows[0].id;
        }
      }

      // Update existing inclusion or create new one
      if (inclusion.id) {
        // Update existing inclusion
        await client.query(`
          UPDATE inclusions SET 
            composition_id = $1, 
            "order" = $2, 
            position = $3, 
            notes = $4, 
            attribution_texts = $5, 
            composer_ids = $6, 
            clefs = $7, 
            updated_at = $8
          WHERE id = $9 AND source_id = $10
        `, [
          compositionId, 
          inclusion.order || (i + 1),
          inclusion.position || '',
          inclusion.notes || '',
          JSON.stringify(inclusion.attribution_texts || []),
          JSON.stringify(composerIds), // Use validated composerIds instead of raw inclusion.composer_ids
          JSON.stringify(inclusion.clefs || []),
          now,
          inclusion.id,
          sourceId
        ]);
      } else {
        // Create new inclusion
        const newInclusionResult = await client.query(`
          INSERT INTO inclusions (
            source_id, composition_id, "order", position, notes, 
            attribution_texts, composer_ids, clefs, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [
          sourceId, 
          compositionId, 
          inclusion.order || (i + 1),
          inclusion.position || '',
          inclusion.notes || '',
          JSON.stringify(inclusion.attribution_texts || []),
          JSON.stringify(composerIds), // Use validated composerIds instead of raw inclusion.composer_ids
          JSON.stringify(inclusion.clefs || []),
          now, 
          now
        ]);
      }
    }

    // Log audit entry for source/inclusion changes
    try {
      await client.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          user?.id || null,
          user?.email || 'unknown@system.local',
          'UPDATE',
          'sources',
          sourceId,
          JSON.stringify({ 
            action: 'source_inclusions_update',
            sourceCode: source.code,
            sourceTitle: source.title,
            formInclusionsCount: processedInclusions.length
          }),
          JSON.stringify({ 
            action: 'source_inclusions_update',
            sourceCode: source.code,
            sourceTitle: source.title,
            totalInclusionsProcessed: processedInclusions.length,
            formInclusionsCount: processedInclusions.length,
            inclusions: processedInclusions.map(inc => ({
              compositionTitle: inc.composition?.title_text,
              composerIds: inc.composer_ids,
              clefs: inc.clefs?.length || 0
            }))
          })
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    // Database cleanup removed from automatic execution after save
    // Run cleanup manually from time to time to avoid interfering with save operations

    return { processedInclusions, deletedCount };
}

// Bulk save source with inclusions (with automatic temp_inclusions processing)
router.post('/:id/save-with-inclusions', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sourceId = parseInt(req.params.id);
    const { source, inclusions, deleted_inclusion_ids } = req.body;

    const { processedInclusions, deletedCount } = await saveSourceWithInclusions(
      client, sourceId, source, inclusions, req.user, deleted_inclusion_ids
    );

    await client.query('COMMIT');

    if (processedInclusions.length > 0 || deletedCount > 0) {
      triggerCleanup(true, 'all', 'after source save', 5000);
    }

    res.json({
      success: true,
      message: `Source saved successfully. Processed ${processedInclusions.length} inclusions` +
        (deletedCount > 0 ? `, deleted ${deletedCount}.` : '.'),
      processedFormInclusions: processedInclusions.length,
      deletedInclusions: deletedCount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving source with inclusions:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to save source and inclusions',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    client.release();
  }
});

// DELETE individual inclusion endpoint
router.delete('/inclusions/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  const client = await pool.connect();
  
  try {
    // Get inclusion details before deletion for audit trail
    const inclusionResult = await client.query(`
      SELECT i.*, s.code as source_code, s.title as source_title, c.title_id, t.text as composition_title
      FROM inclusions i
      JOIN sources s ON i.source_id = s.id
      JOIN compositions c ON i.composition_id = c.id
      JOIN titles t ON c.title_id = t.id
      WHERE i.id = $1
    `, [id]);
    
    if (inclusionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inclusion not found' });
    }
    
    const inclusion = inclusionResult.rows[0];
    
    const deleteResult = await client.query(
      'DELETE FROM inclusions WHERE id = $1 RETURNING *',
      [id]
    );
    
    // Log audit entry for inclusion deletion
    try {
      await client.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'DELETE',
          'inclusions',
          parseInt(id),
          JSON.stringify({
            id: inclusion.id,
            source_id: inclusion.source_id,
            source_code: inclusion.source_code,
            source_title: inclusion.source_title,
            composition_id: inclusion.composition_id,
            composition_title: inclusion.composition_title,
            order: inclusion.order,
            position: inclusion.position,
            notes: inclusion.notes,
            composer_ids: inclusion.composer_ids,
            clefs: inclusion.clefs
          }),
          null
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Inclusion deleted successfully',
      deletedInclusion: deleteResult.rows[0]
    });
    
  } catch (error) {
    console.error('Error deleting inclusion:', error);
    res.status(500).json({ error: 'Failed to delete inclusion' });
  } finally {
    client.release();
  }
});

export default router; 