import express from 'express';
import XLSX from 'xlsx';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { saveSourceWithInclusions } from './sources.js';
import { triggerCleanup } from '../cleanup.js';

const router = express.Router();

router.use(requireAuth);

// --- Valid values (mirrored from sources.js and edit.html) ---

const VALID_CLEFS = [
  'g1','g2','g3','c1','g4','c2','g5','c3','f1','g28','c4','f2','c5','d1',
  'f3','d2','f4','d3','y1','f5','d4','y2','d5','y3','y4','y5',
  'x1','x2','x3','x4','x5','org','bc','lut'
];

const VALID_TONES = ['1','2','3','4','5','6','7','8','9','10','11','12'];
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

// --- Helpers ---

function cellStr(row, key) {
  const v = row[key];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function cellInt(row, key) {
  const v = row[key];
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function parseClefs(raw) {
  if (!raw) return [];
  const parts = String(raw).split(';').map(s => s.trim()).filter(Boolean);
  const clefs = [];
  for (let i = 0; i < parts.length; i++) {
    let token = parts[i];
    let missing = false, optional = false, incomplete = false;
    const transitions_to = [];

    let changed = true;
    while (changed) {
      changed = false;
      if (token.startsWith('[') && token.endsWith(']')) {
        missing = true;
        token = token.slice(1, -1);
        changed = true;
      }
      if (token.startsWith('(') && token.endsWith(')')) {
        optional = true;
        token = token.slice(1, -1);
        changed = true;
      }
      if (token.startsWith('{') && token.endsWith('}')) {
        incomplete = true;
        token = token.slice(1, -1);
        changed = true;
      }
    }

    if (token.includes('>')) {
      const tParts = token.split('>').map(s => s.trim());
      token = tParts[0];
      transitions_to.push(...tParts.slice(1));
    }

    clefs.push({
      clef: token.toLowerCase(),
      voice_number: i + 1,
      missing,
      optional,
      incomplete,
      transitions_to,
      valid: true,
      error: null
    });
  }
  return clefs;
}

function validateClefs(clefs) {
  const errors = [];
  for (const c of clefs) {
    if (c.clef && !VALID_CLEFS.includes(c.clef)) {
      c.valid = false;
      c.error = `Invalid clef: ${c.clef}`;
      errors.push(c.error);
    }
    for (const t of c.transitions_to) {
      if (t && !VALID_CLEFS.includes(t.toLowerCase())) {
        c.valid = false;
        c.error = `Invalid transition clef: ${t}`;
        errors.push(c.error);
      }
    }
  }
  return errors;
}

function parseEvenOdd(val) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).toLowerCase().trim();
  if (s === 'even' || s === '0') return 0;
  if (s === 'odd' || s === '1') return 1;
  if (s === 'both' || s === '2') return 2;
  return null;
}

// --- GET /template  — download XLSX template ---

router.get('/template', async (req, res) => {
  try {
    const typeRows = await pool.query('SELECT name FROM composition_types ORDER BY name');
    const compositionTypeNames = typeRows.rows.map(r => r.name);

    const wb = XLSX.utils.book_new();

    // Source sheet
    const sourceHeaders = [
      'code', 'title', 'type', 'format', 'town', 'rism_link',
      'notes', 'from_year', 'to_year', 'from_year_annotation',
      'to_year_annotation', 'catalogued'
    ];
    const sourceSheet = XLSX.utils.aoa_to_sheet([sourceHeaders, []]);
    sourceSheet['!cols'] = sourceHeaders.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, sourceSheet, 'Source');

    // Inclusions sheet
    const inclHeaders = [
      'position', 'title_text', 'composition_type', 'tone', 'tone_connector',
      'even_odd', 'clefs', 'composer_names', 'attribution_text', 'notes'
    ];
    const inclSheet = XLSX.utils.aoa_to_sheet([inclHeaders]);
    inclSheet['!cols'] = inclHeaders.map((h) => {
      if (h === 'title_text' || h === 'composer_names') return { wch: 30 };
      if (h === 'clefs') return { wch: 25 };
      return { wch: 16 };
    });
    XLSX.utils.book_append_sheet(wb, inclSheet, 'Inclusions');

    // Images sheet — one row per image link, each with an optional label.
    const imageHeaders = ['url', 'label'];
    const imageSheet = XLSX.utils.aoa_to_sheet([imageHeaders]);
    imageSheet['!cols'] = [{ wch: 60 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, imageSheet, 'Images');

    // Reference sheet
    const refData = [
      ['Polyphony Database — Import Template Reference'],
      [],
      ['SOURCE FIELDS'],
      ['code', 'Required. Shelfmark / RISM siglum, e.g. "GB-Lbl Add. 17792-17796"'],
      ['title', 'Optional title for the source'],
      ['type', 'MS or Print'],
      ['format', 'e.g. Partbook, Choirbook, Score, Tablature'],
      ['town', 'City of origin / current location'],
      ['rism_link', 'URL to RISM entry'],
      ['notes', 'Free text notes'],
      ['from_year / to_year', 'Integer years'],
      ['from_year_annotation / to_year_annotation', '"before", "after", "c." etc.'],
      ['catalogued', 'TRUE or FALSE (default FALSE)'],
      [],
      ['INCLUSION FIELDS'],
      ['position', 'Position in the source (e.g. folio number). Free text.'],
      ['title_text', 'Required. Title of the composition, e.g. "Ave Maria"'],
      ['composition_type', 'One of the types listed below (case-sensitive)'],
      ['tone', 'Tone number 1-12, or: mix, per, pro. Semicolon-separate for multiple (e.g. "1;2")'],
      ['tone_connector', 'Connector between multiple tones, e.g. "&", "/"'],
      ['even_odd', '"even", "odd", or "both"'],
      ['clefs', 'Semicolon-separated clef list. e.g. "c1;c3;c4;f4". Use [c1] for missing, (c1) for optional, {c1} for incomplete, c1>c3 for transition'],
      ['composer_names', 'Semicolon-separated composer names exactly as in the database. Unknown names default to Anonymous.'],
      ['attribution_text', 'Attribution text as written in the source, e.g. "A. Byrd"'],
      ['notes', 'Free text notes for this inclusion'],
      [],
      ['IMAGE FIELDS (Images sheet — add one row per image)'],
      ['url', 'Required. Direct link to the image (https://...). Rows without a url are ignored.'],
      ['label', 'Optional caption/label for the image, e.g. "f. 12r"'],
      [],
      ['VALID COMPOSITION TYPES'],
      ...compositionTypeNames.map(n => [n]),
      [],
      ['VALID CLEF NAMES'],
      [VALID_CLEFS.join(', ')],
      [],
      ['VALID TONE VALUES'],
      ['1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, mix (or mixti), per (or peregrini), pro (or proprii)'],
    ];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    refSheet['!cols'] = [{ wch: 30 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, refSheet, 'Reference');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="source_import_template.xlsx"');
    res.send(Buffer.from(buf));
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// --- POST /parse  — upload and validate XLSX, return preview JSON ---

router.post('/parse', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const wb = XLSX.read(req.body, { type: 'buffer' });

    const warnings = [];
    const errors = [];

    // --- Parse Source sheet ---
    const sourceSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'source');
    if (!sourceSheetName) {
      return res.status(400).json({ error: 'Missing "Source" sheet in workbook' });
    }
    const sourceRows = XLSX.utils.sheet_to_json(wb.Sheets[sourceSheetName], { defval: '' });
    if (sourceRows.length === 0) {
      return res.status(400).json({ error: 'Source sheet has no data row' });
    }
    const sr = sourceRows[0];

    const sourceCode = cellStr(sr, 'code');
    if (!sourceCode) {
      errors.push('Source: "code" is required');
    }

    const cataloguedRaw = cellStr(sr, 'catalogued').toLowerCase();
    const catalogued = cataloguedRaw === 'true' || cataloguedRaw === 'yes' || cataloguedRaw === '1';

    const source = {
      code: sourceCode,
      title: cellStr(sr, 'title'),
      type: cellStr(sr, 'type') || 'MS',
      format: cellStr(sr, 'format'),
      town: cellStr(sr, 'town'),
      rism_link: cellStr(sr, 'rism_link'),
      notes: cellStr(sr, 'notes') || null,
      from_year: cellInt(sr, 'from_year'),
      to_year: cellInt(sr, 'to_year'),
      from_year_annotation: cellStr(sr, 'from_year_annotation') || null,
      to_year_annotation: cellStr(sr, 'to_year_annotation') || null,
      catalogued,
      publishers: [],
      scribes: [],
      source_images: []
    };

    // --- Parse Images sheet (optional) ---
    const imageSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'images');
    if (imageSheetName) {
      const imageRows = XLSX.utils.sheet_to_json(wb.Sheets[imageSheetName], { defval: '' });
      for (let i = 0; i < imageRows.length; i++) {
        const url = cellStr(imageRows[i], 'url');
        if (!url) continue; // skip blank rows
        source.source_images.push({
          url,
          label: cellStr(imageRows[i], 'label')
        });
      }
    }

    // --- Parse Inclusions sheet ---
    const inclSheetName = wb.SheetNames.find(n => n.toLowerCase() === 'inclusions');
    if (!inclSheetName) {
      return res.status(400).json({ error: 'Missing "Inclusions" sheet in workbook' });
    }
    const inclRows = XLSX.utils.sheet_to_json(wb.Sheets[inclSheetName], { defval: '' });

    if (inclRows.length === 0) {
      warnings.push('Inclusions sheet is empty — only the source will be created');
    }

    // Pre-load composers for name resolution
    const composerResult = await pool.query('SELECT id, name FROM composers ORDER BY name');
    const composerMap = new Map();
    for (const c of composerResult.rows) {
      composerMap.set(c.name.toLowerCase(), c.id);
    }

    // Pre-load composition types
    const typeResult = await pool.query('SELECT id, name FROM composition_types ORDER BY name');
    const typeMap = new Map();
    for (const t of typeResult.rows) {
      typeMap.set(t.name.toLowerCase(), { id: t.id, name: t.name });
    }

    const inclusions = [];

    for (let i = 0; i < inclRows.length; i++) {
      const row = inclRows[i];
      const rowNum = i + 2; // spreadsheet row (1-indexed header + 1-indexed data)
      const titleText = cellStr(row, 'title_text');

      if (!titleText) {
        errors.push(`Row ${rowNum}: "title_text" is required`);
        continue;
      }

      // Composition type
      const rawType = cellStr(row, 'composition_type');
      let compositionTypeId = null;
      let compositionTypeName = '';
      if (rawType) {
        const found = typeMap.get(rawType.toLowerCase());
        if (found) {
          compositionTypeId = found.id;
          compositionTypeName = found.name;
        } else {
          warnings.push(`Row ${rowNum}: composition type "${rawType}" not recognised — will be ignored`);
        }
      }

      // Tone
      const rawTone = cellStr(row, 'tone');
      let tone = null;
      if (rawTone) {
        const parts = rawTone.split(';').map(s => s.trim()).filter(Boolean);
        const normalized = parts.map(normalizeSingleTone).filter(Boolean);
        if (normalized.length > 0) {
          tone = normalized;
        } else {
          warnings.push(`Row ${rowNum}: tone "${rawTone}" not recognised — will be ignored`);
        }
      }

      const toneConnector = cellStr(row, 'tone_connector') || null;
      const evenOdd = parseEvenOdd(cellStr(row, 'even_odd'));

      // Clefs
      const rawClefs = cellStr(row, 'clefs');
      const clefs = parseClefs(rawClefs);
      const clefErrors = validateClefs(clefs);
      for (const ce of clefErrors) {
        errors.push(`Row ${rowNum}: ${ce}`);
      }

      const numberOfVoices = clefs.filter(c => c.clef && !c.optional).length || null;

      // Composers
      const rawComposers = cellStr(row, 'composer_names');
      const composerIds = [];
      const composerNames = [];
      if (rawComposers) {
        const names = rawComposers.split(';').map(s => s.trim()).filter(Boolean);
        for (const name of names) {
          const id = composerMap.get(name.toLowerCase());
          if (id) {
            composerIds.push(id);
            composerNames.push(name);
          } else {
            warnings.push(`Row ${rowNum}: composer "${name}" not found — will default to Anonymous`);
          }
        }
      }
      if (composerIds.length === 0) {
        composerIds.push(23);
      }

      const attribution = cellStr(row, 'attribution_text');
      const notes = cellStr(row, 'notes');

      inclusions.push({
        id: null,
        order: i + 1,
        position: cellStr(row, 'position'),
        attribution_texts: attribution ? [attribution] : [''],
        composer_ids: composerIds,
        notes,
        clefs,
        composition: {
          title_text: titleText,
          composition_type_id: compositionTypeId,
          composition_type_name: compositionTypeName,
          tone,
          tone_connector: toneConnector,
          even_odd: evenOdd,
          number_of_voices: numberOfVoices,
          composer_names: composerNames
        }
      });
    }

    res.json({ source, inclusions, warnings, errors });
  } catch (error) {
    console.error('Error parsing import file:', error);
    res.status(400).json({ error: 'Failed to parse file. Ensure it is a valid .xlsx or .xls file.' });
  }
});

// --- POST /confirm  — create source + inclusions via the same code path as the form ---

router.post('/confirm', async (req, res) => {
  const { source, inclusions } = req.body;

  if (!source || !source.code) {
    return res.status(400).json({ error: 'Source code is required' });
  }

  // Run the whole import in a single transaction so a failure never leaves an
  // orphaned source row behind. We call the shared save logic directly instead
  // of looping back over HTTP (which broke behind the Heroku HTTPS proxy).
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const now = new Date();

    // Step 1: Create the source row
    const createResult = await client.query(`
      INSERT INTO sources (
        code, title, type, format, town, rism_link, catalogued,
        notes, from_year, to_year, from_year_annotation, to_year_annotation,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      source.code,
      source.title || '',
      source.type || 'MS',
      source.format || '',
      source.town || '',
      source.rism_link || '',
      source.catalogued || false,
      source.notes || null,
      source.from_year || null,
      source.to_year || null,
      source.from_year_annotation || null,
      source.to_year_annotation || null,
      now, now
    ]);

    const sourceId = createResult.rows[0].id;

    // Step 2: Persist relationships + inclusions through the same code path
    // used by the source editor's save-with-inclusions endpoint.
    const sourceUpdateData = {
      code: source.code,
      title: source.title || '',
      type: source.type || 'MS',
      format: source.format || '',
      town: source.town || '',
      rism_link: source.rism_link || '',
      catalogued: source.catalogued || false,
      notes: source.notes || null,
      from_year: source.from_year || null,
      to_year: source.to_year || null,
      from_year_annotation: source.from_year_annotation || null,
      to_year_annotation: source.to_year_annotation || null,
      publishers: source.publishers || [],
      scribes: source.scribes || [],
      source_images: source.source_images || []
    };

    const { processedInclusions } = await saveSourceWithInclusions(
      client, sourceId, sourceUpdateData, inclusions || [], req.user
    );

    await client.query('COMMIT');

    if (processedInclusions.length > 0) {
      triggerCleanup(true, 'all', 'after source import', 5000);
    }

    res.json({
      success: true,
      sourceId,
      sourceCode: source.code,
      message: `Source created with ${processedInclusions.length} inclusions.`,
      processedInclusions: processedInclusions.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error confirming import:', error);
    res.status(500).json({ error: 'Import failed', details: error.message });
  } finally {
    client.release();
  }
});

export default router;
