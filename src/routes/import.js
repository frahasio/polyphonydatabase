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

    const publisherRows = await pool.query('SELECT name FROM publishers ORDER BY name');
    const publisherNames = publisherRows.rows.map(r => r.name);

    const scribeRows = await pool.query('SELECT name FROM scribes ORDER BY name');
    const scribeNames = scribeRows.rows.map(r => r.name);

    const wb = XLSX.utils.book_new();

    // Source sheet
    const sourceHeaders = [
      'code', 'title', 'type', 'format', 'town', 'rism_link',
      'notes', 'from_year', 'to_year', 'from_year_annotation',
      'to_year_annotation', 'catalogued', 'publishers', 'scribes'
    ];
    const sourceSheet = XLSX.utils.aoa_to_sheet([sourceHeaders, []]);
    sourceSheet['!cols'] = sourceHeaders.map((h) => {
      if (h === 'publishers' || h === 'scribes') return { wch: 30 };
      return { wch: 18 };
    });
    XLSX.utils.book_append_sheet(wb, sourceSheet, 'Source');

    // Inclusions sheet.
    // The individual clef_1..clef_16 columns let users type one clef per cell.
    // The "clefs" column is an Excel formula that joins those cells into the
    // semicolon-delimited string the importer actually reads. Users can type
    // directly into "clefs" to override the formula.
    const CLEF_COLS = 16;
    const clefHeaders = Array.from({ length: CLEF_COLS }, (_, i) => `clef_${i + 1}`);
    const inclHeaders = [
      'position', 'title_text', 'composition_type', 'tone', 'tone_connector',
      'even_odd', 'clefs', 'composer_names', 'attribution_text', 'notes',
      ...clefHeaders
    ];
    const inclSheet = XLSX.utils.aoa_to_sheet([inclHeaders]);

    const clefsColIdx = inclHeaders.indexOf('clefs');
    const firstClefColIdx = inclHeaders.indexOf('clef_1');
    const lastClefColIdx = inclHeaders.indexOf(`clef_${CLEF_COLS}`);
    const firstClefColLetter = XLSX.utils.encode_col(firstClefColIdx);
    const lastClefColLetter = XLSX.utils.encode_col(lastClefColIdx);

    // Pre-fill the clefs formula for a generous number of rows so the join
    // works as soon as the user types into the clef_N cells.
    const PREFILL_ROWS = 200;
    for (let r = 1; r <= PREFILL_ROWS; r++) {
      const excelRow = r + 1; // r is 0-indexed; row 0 is the header
      const cellRef = XLSX.utils.encode_cell({ c: clefsColIdx, r });
      inclSheet[cellRef] = {
        t: 's',
        v: '',
        // TEXTJOIN is a post-2007 "future function", so it must be stored with
        // the _xlfn. prefix or Excel shows #NAME? (and renders it as =@TEXTJOIN).
        f: `_xlfn.TEXTJOIN(";",TRUE,${firstClefColLetter}${excelRow}:${lastClefColLetter}${excelRow})`
      };
    }
    inclSheet['!ref'] = XLSX.utils.encode_range(
      { c: 0, r: 0 },
      { c: lastClefColIdx, r: PREFILL_ROWS }
    );

    inclSheet['!cols'] = inclHeaders.map((h) => {
      if (h === 'title_text' || h === 'composer_names') return { wch: 30 };
      if (h === 'clefs') return { wch: 25 };
      if (h.startsWith('clef_')) return { wch: 8 };
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
      ['publishers', 'Semicolon-separated publisher names exactly as in the database. Unknown names are skipped with a warning.'],
      ['scribes', 'Semicolon-separated scribe names exactly as in the database. Unknown names are skipped with a warning.'],
      [],
      ['INCLUSION FIELDS'],
      ['position', 'Position in the source (e.g. folio number). Free text.'],
      ['title_text', 'Required. Title of the composition, e.g. "Ave Maria"'],
      ['composition_type', 'One of the types listed below (case-sensitive)'],
      ['tone', 'Tone number 1-12, or: mix, per, pro. Semicolon-separate for multiple (e.g. "1;2")'],
      ['tone_connector', 'Connector between multiple tones, e.g. "&", "/"'],
      ['even_odd', '"even", "odd", or "both"'],
      ['clefs', 'Semicolon-separated clef list. e.g. "c1;c3;c4;f4". Use [c1] for missing, (c1) for optional, {c1} for incomplete, c1>c3 for transition. Auto-filled by a formula from the clef_1..clef_16 columns — type here to override it.'],
      ['clef_1 ... clef_16', 'One clef per cell (same notation as above). These are joined into the "clefs" column automatically.'],
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
      [],
      ['EVEN/ODD VALUES'],
      ['even, odd, both (also accepts 0, 1, 2)'],
      [],
      ['CLEF MODIFIERS'],
      ['[c1]', 'Missing voice'],
      ['(c1)', 'Optional voice'],
      ['{c1}', 'Incomplete voice'],
      ['c1>c3', 'Clef changes / transitions to another clef'],
      [],
      [`VALID PUBLISHER NAMES (${publisherNames.length})`],
      ...(publisherNames.length ? publisherNames.map(n => [n]) : [['(none in database yet)']]),
      [],
      [`VALID SCRIBE NAMES (${scribeNames.length})`],
      ...(scribeNames.length ? scribeNames.map(n => [n]) : [['(none in database yet)']]),
      [],
      ['COMPOSER NAMES'],
      ['Composer names must match the database exactly. There are too many to list here — use the source editor\'s composer search to find exact spellings. Unknown names default to Anonymous.'],
    ];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    refSheet['!cols'] = [{ wch: 30 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, refSheet, 'Reference');

    // Ensure spreadsheet apps recalculate the clefs formulas when the file opens.
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.CalcPr = { fullCalcOnLoad: true };

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
      publisher_names: [],
      scribe_names: [],
      source_images: []
    };

    // --- Resolve publishers & scribes (semicolon-delimited names → ids) ---
    const publisherResult = await pool.query('SELECT id, name FROM publishers ORDER BY name');
    const publisherMap = new Map();
    for (const p of publisherResult.rows) publisherMap.set(p.name.toLowerCase(), p.id);

    const scribeResult = await pool.query('SELECT id, name FROM scribes ORDER BY name');
    const scribeMap = new Map();
    for (const s of scribeResult.rows) scribeMap.set(s.name.toLowerCase(), s.id);

    const rawPublishers = cellStr(sr, 'publishers');
    if (rawPublishers) {
      for (const name of rawPublishers.split(';').map(s => s.trim()).filter(Boolean)) {
        const id = publisherMap.get(name.toLowerCase());
        if (id) {
          source.publishers.push(id);
          source.publisher_names.push(name);
        } else {
          warnings.push(`Source: publisher "${name}" not found — will be skipped`);
        }
      }
    }

    const rawScribes = cellStr(sr, 'scribes');
    if (rawScribes) {
      for (const name of rawScribes.split(';').map(s => s.trim()).filter(Boolean)) {
        const id = scribeMap.get(name.toLowerCase());
        if (id) {
          source.scribes.push(id);
          source.scribe_names.push(name);
        } else {
          warnings.push(`Source: scribe "${name}" not found — will be skipped`);
        }
      }
    }

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

      // Resolve clefs: prefer the joined "clefs" column, otherwise fall back to
      // joining the individual clef_1..clef_16 cells (in case the formula was
      // cleared or did not recalculate on the user's machine).
      let rawClefs = cellStr(row, 'clefs');
      if (!rawClefs) {
        const clefParts = [];
        for (let n = 1; n <= 16; n++) {
          const v = cellStr(row, `clef_${n}`);
          if (v) clefParts.push(v);
        }
        rawClefs = clefParts.join(';');
      }

      // Skip rows that are entirely empty (e.g. the pre-filled formula rows the
      // user never used). Only flag a missing title when the row has content.
      const rowHasContent = !!rawClefs || [
        'position', 'composition_type', 'tone', 'tone_connector',
        'even_odd', 'composer_names', 'attribution_text', 'notes'
      ].some(f => cellStr(row, f));

      if (!titleText) {
        if (rowHasContent) {
          errors.push(`Row ${rowNum}: "title_text" is required`);
        }
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

      // Clefs (rawClefs resolved at the top of the loop)
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
        order: inclusions.length + 1,
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

    if (inclusions.length === 0) {
      warnings.push('No inclusions found — only the source will be created');
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
