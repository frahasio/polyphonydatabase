/**
 * Matcher: propose liturgical functions for titles from the vendored
 * Divinum Officium corpus (data/divinumofficium — every Mass proper and
 * Office hour of the 1960 calendar, Latin).
 *
 * Complements the Cantus Index matcher: DO is COMPLETE (the whole year,
 * Mass + Office) and POSITIONAL — we know a text is e.g. the Introit of
 * Advent I or a Vespers antiphon of St Andrew, not merely "attested at"
 * some feast. Because the corpus is local, the whole catalogue is matched
 * in one run with no API calls, and texts that recur across many days are
 * recognised as GENERIC and never suggested (the "Cantus happened to file
 * it under one feast" problem).
 *
 * Matching is strict: a title incipit must be the opening words of a
 * liturgical text unit (an antiphon line, introit, gradual verse...).
 * Suggestions reuse the title_function kind and the tf:/tfn: dedupe keys,
 * so a feast already suggested by Cantus is not duplicated.
 *
 * Usage: node scripts/suggest-title-functions-do.js [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';
import { normalizeFeast, mapFeast, splitIncipitParts, foldSpelling, normalizeIncipit, titleCase } from './lib/matching.js';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DO_DIR = path.join(ROOT, 'data', 'divinumofficium');

// An INCIPIT found on this many distinct days (union across every text
// unit that opens with it) is generic (ordinary chants, ferial psalmody,
// ubiquitous antiphons) and is never suggested.
const GENERIC_DAYS = parseInt(process.env.DO_GENERIC_DAYS, 10) || 8;
// New-feast proposals only when the incipit is this specific: shared texts
// must not spawn a new feast for every day that borrows them.
const NEW_FEAST_MAX_DAYS = parseInt(process.env.DO_NEW_FEAST_MAX_DAYS, 10) || 3;
// A text may genuinely be proper to several days (Sunday + saint + feria) —
// suggest ALL of them, not just the most specific.
const MAX_SUGGESTIONS_PER_TITLE = 6;
const MAX_POSITIONS_IN_PAYLOAD = 6;
// Units are indexed on their opening words; incipits shorter than this only
// match if they cover the whole unit (guards "O sacrum" style stubs).
const MIN_PART_WORDS = 2;

// Mass sections that carry sung proper texts (motet sources).
const MISSA_SECTIONS = new Set(['Introitus', 'Graduale', 'GradualeF', 'GradualeP', 'Tractus', 'Sequentia', 'Offertorium', 'OffertoriumP', 'Communio', 'CommunioP']);
// Office sections: antiphons, responsories, hymns, chapters, invitatories.
const HORAS_SECTION_RE = /^(Ant\b|Responsory|Hymnus|Capitulum|Invit)/;

// Divinum Officium Commune file ids -> catalogue function names.
const COMMUNE_MAP = [
  [/^C1\b/, 'Comm. Apostles & Evangelists'],
  [/^C2/, 'Comm. Martyrs'],
  [/^C3/, 'Comm. Martyrs'],
  [/^C4a/, 'Comm. Doctors'],
  [/^C4/, 'Comm. Pontiffs'],
  [/^C5b/, 'Comm. Abbots'],
  [/^C5/, 'Comm. Confessors'],
  [/^C6/, 'Comm. Virgins'],
  [/^C7/, 'Comm. Holy Women'],
  [/^C8/, 'Dedication of Church'],
  [/^C1[01]/, 'BVM'],
  [/defunct/i, 'Office for the dead'],
];

// ---------- DO file parsing ----------

const fileCache = new Map();
function readFile(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const p = path.join(DO_DIR, rel);
  const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  fileCache.set(rel, raw);
  return raw;
}

/** Split into { section: [lines] }, ignoring "(rubrica ...)" variants. */
function splitSections(raw) {
  const sections = {};
  let current = null;
  let skip = false;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (m) {
      skip = /rubrica/i.test(m[2]); // variant for another rubric set
      current = skip ? null : m[1];
      if (current && !sections[current]) sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

/** Resolve a single-line "@Folder/File(:Section)" reference to lines. */
function resolveRef(line, sectionName) {
  const m = line.match(/^@([\w/-]+)(?::([^:]+))?/);
  if (!m) return [];
  const [, ref, section] = m;
  const rel = ref.startsWith('Commune/') ? `horas/Latin/${ref}.txt` : `missa/Latin/${ref}.txt`;
  const raw = readFile(rel);
  if (!raw) return [];
  const sections = splitSections(raw);
  const wanted = (section || sectionName).split(';;')[0].trim();
  return sections[wanted] || [];
}

/** Clean a DO content line to plain text (or '' if not text). */
function cleanLine(line) {
  let t = String(line).trim();
  if (!t || t === '_' || t.startsWith('!') || t.startsWith('$') || t.startsWith('&') || t.startsWith('#')) return '';
  t = t.replace(/;;.*$/, '');            // trailing psalm refs etc.
  t = t.replace(/^v\.\s*/i, '').replace(/^[VR]\.\s*/, '');
  t = t.replace(/\s\*\s/g, ' ');         // antiphon median marker
  t = t.replace(/~\s*$/, '');
  return t.trim();
}

// ---------- corpus construction ----------

/**
 * units: Map(unitKey -> {
 *   sample: original-ish text (first unit encountered),
 *   days: Set(fileRel),
 *   places: [{ fn, newName, position, day }]   (fn = existing function name)
 * })
 * index: Map(firstTwoWords -> [unitKey])  for fast incipit lookup
 */
function buildCorpus(functionNames) {
  const units = new Map();
  const index = new Map();
  const normalizedFnNames = functionNames.map((n) => ({
    name: n,
    norm: ' ' + normalizeIncipit(n) + ' ',
  }));

  // Map a day file's [Officium] label to a function: FEAST_MAP first, then a
  // saint-stem heuristic against existing function names ("Sancti Barnabae
  // Apostoli" -> "St Barnabas"), else a new-function proposal (Sancti only).
  function classifyDay(rel, label) {
    const communeId = rel.includes('/Commune/') ? path.basename(rel, '.txt') : null;
    if (communeId) {
      for (const [re, fn] of COMMUNE_MAP) if (re.test(communeId)) return { fn };
      return {};
    }
    if (/defunct/i.test(rel) || /defunctorum/i.test(label)) return { fn: 'Requiem' };
    const mapped = mapFeast(label);
    if (mapped) return { fn: mapped };
    const norm = normalizeFeast(label);
    const saint = norm.match(/\bsanct[aoi]?e?\s+(\w{5,})/);
    if (saint) {
      const stem = saint[1].replace(/(ae|is|i|o)$/, '');
      if (stem.length >= 5) {
        const hit = normalizedFnNames.find((f) => f.norm.includes(stem));
        if (hit) return { fn: hit.name };
      }
    }
    if (rel.includes('/Sancti/') && norm && norm.length <= 70) {
      return { newName: titleCase(norm) };
    }
    return {}; // unmapped ferial day: counts toward generic-days only
  }

  const addUnit = (text, place) => {
    const norm = foldSpelling(normalizeIncipit(text));
    const words = norm.split(' ').filter(Boolean);
    if (words.length < 2) return;
    const key = words.slice(0, 12).join(' ');
    if (!units.has(key)) {
      units.set(key, { sample: text.slice(0, 120), words: words.slice(0, 12), days: new Set(), places: [] });
      const first2 = words.slice(0, 2).join(' ');
      if (!index.has(first2)) index.set(first2, []);
      index.get(first2).push(key);
    }
    const u = units.get(key);
    u.days.add(place.day);
    if ((place.fn || place.newName) && u.places.length < 40) u.places.push(place);
  };

  const walk = (dirRel, sectionFilter) => {
    const dir = path.join(DO_DIR, dirRel);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.txt')) continue;
      const rel = `${dirRel}/${f}`;
      const raw = readFile(rel);
      if (!raw) continue;
      const sections = splitSections(raw);
      // First title line only; rubric-variant alternates ("(sed rubrica
      // 196) Other Title") would otherwise concatenate into nonsense.
      const label = ((sections.Officium || []).map(cleanLine).filter(Boolean)[0] || '')
        .replace(/\(sed rubrica[^)]*\)?.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      const cls = classifyDay(rel, label);
      for (const [name, lines] of Object.entries(sections)) {
        if (!sectionFilter(name)) continue;
        let all = lines;
        const refLine = lines.find((l) => l.trim().startsWith('@'));
        if (refLine) all = lines.flatMap((l) => (l.trim().startsWith('@') ? resolveRef(l.trim(), name) : [l]));
        for (const line of all) {
          const t = cleanLine(line);
          if (t && t.split(' ').length >= 2) {
            addUnit(t, { fn: cls.fn || null, newName: cls.newName || null, position: name, day: rel, dayLabel: label || path.basename(rel, '.txt') });
          }
        }
      }
    }
  };

  walk('missa/Latin/Tempora', (s) => MISSA_SECTIONS.has(s));
  walk('missa/Latin/Sancti', (s) => MISSA_SECTIONS.has(s));
  walk('horas/Latin/Tempora', (s) => HORAS_SECTION_RE.test(s));
  walk('horas/Latin/Sancti', (s) => HORAS_SECTION_RE.test(s));
  walk('horas/Latin/Commune', (s) => HORAS_SECTION_RE.test(s) || MISSA_SECTIONS.has(s));

  return { units, index };
}

// ---------- matching ----------

function matchPart(part, corpus) {
  const words = part.split(' ').filter(Boolean);
  if (words.length < MIN_PART_WORDS) return [];
  const first2 = words.slice(0, 2).join(' ');
  const keys = corpus.index.get(first2) || [];
  const hits = [];
  for (const key of keys) {
    const u = corpus.units.get(key);
    // Incipit must be a word-for-word prefix of the unit (up to the 12
    // indexed words). Short incipits are held to the same standard — they
    // just constrain fewer words, which the generic filter compensates for.
    const n = Math.min(words.length, u.words.length);
    let ok = true;
    for (let i = 0; i < n; i++) if (words[i] !== u.words[i]) { ok = false; break; }
    if (ok) hits.push(u);
  }
  return hits;
}

async function main() {
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  console.log('Building Divinum Officium corpus index...');
  const corpus = buildCorpus([...functionIds.keys()]);
  console.log(`  ${corpus.units.size} distinct text units indexed.`);

  // Every Latin/unknown title in use, with its existing function links —
  // all local computation, so no checkpoint needed: dedupe keys make
  // re-runs cheap and idempotent.
  const titles = await pool.query(`
    SELECT t.id, t.text,
           ARRAY(SELECT ft.function_id FROM functions_titles ft WHERE ft.title_id = t.id) AS existing_function_ids
    FROM titles t
    WHERE (t.language IS NULL OR t.language = (SELECT id FROM languages WHERE language = 'Latin'))
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
  `);
  console.log(`Matching ${titles.rows.length} titles...${DRY_RUN ? ' [dry run]' : ''}`);

  let inserted = 0;
  for (const title of titles.rows) {
    const existingFnIds = new Set(title.existing_function_ids || []);
    const parts = splitIncipitParts(title.text).map(foldSpelling);
    if (!parts.length) continue;

    // key 'fn:{name}' or 'new:{name}' -> { functionId, proposedName,
    //   minDays, positions:Set, matched:Set }
    const tally = new Map();
    for (const part of parts) {
      const units = matchPart(part, corpus);
      if (!units.length) continue;
      // Specificity of the INCIPIT: union of days across every unit that
      // opens with it. Different continuations of the same opening words
      // (Gradual verse vs Communio) must count as one shared text, or a
      // widely-used incipit masquerades as "proper to 1 day".
      const unionDays = new Set();
      for (const u of units) for (const d of u.days) unionDays.add(d);
      const specificity = unionDays.size;
      if (specificity >= GENERIC_DAYS) continue; // generic incipit

      for (const unit of units) {
        for (const place of unit.places) {
          let key, functionId, proposedName;
          if (place.fn && functionIds.has(place.fn)) {
            key = `fn:${place.fn}`; functionId = functionIds.get(place.fn); proposedName = place.fn;
          } else if (place.newName && specificity <= NEW_FEAST_MAX_DAYS) {
            key = `new:${place.newName.toLowerCase()}`; functionId = null; proposedName = place.newName;
          } else continue;
          if (!tally.has(key)) {
            tally.set(key, { functionId, proposedName, minDays: specificity, positions: new Set(), matched: new Set() });
          }
          const t = tally.get(key);
          t.minDays = Math.min(t.minDays, specificity);
          if (t.positions.size < MAX_POSITIONS_IN_PAYLOAD) {
            t.positions.add(`${place.position} — ${place.dayLabel}`);
          }
          t.matched.add(unit.sample);
        }
      }
    }

    const ranked = [...tally.values()]
      .filter((t) => !(t.functionId && existingFnIds.has(t.functionId)))
      // Most specific first; on equal specificity prefer feasts the
      // catalogue already knows over creating new ones.
      .sort((a, b) => a.minDays - b.minDays
        || (a.functionId ? 0 : 1) - (b.functionId ? 0 : 1)
        || b.positions.size - a.positions.size)
      .slice(0, MAX_SUGGESTIONS_PER_TITLE);

    for (const t of ranked) {
      // Specificity score: a text unique to one day scores 1.0, sliding
      // down as it appears on more days.
      const score = Math.max(0.4, Math.round((1 - 0.08 * (t.minDays - 1)) * 100) / 100);
      const isNew = !t.functionId;
      const dedupeKey = isNew
        ? `tfn:${title.id}:${t.proposedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : `tf:${title.id}:${t.functionId}`;
      if (DRY_RUN) {
        inserted++;
        console.log(`  ${title.id} "${title.text.slice(0, 50)}" -> ${t.proposedName}${isNew ? ' (NEW)' : ''} [${[...t.positions][0]}] days=${t.minDays}`);
        continue;
      }
      const result = await pool.query(
        `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
         VALUES ('title_function', $1, $2, $3, 'divinumofficium', $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          title.id,
          JSON.stringify({
            function_id: t.functionId,
            function_name: t.proposedName,
            new_function: isNew || undefined,
            positions: [...t.positions],
            matched_incipit: [...t.matched][0] || null,
            days: t.minDays,
          }),
          score,
          dedupeKey,
        ]
      );
      if (result.rowCount) {
        inserted++;
        console.log(`  ${title.id} "${title.text.slice(0, 50)}" -> ${t.proposedName}${isNew ? ' (NEW)' : ''} (${Math.round(score * 100)}%)`);
      }
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
