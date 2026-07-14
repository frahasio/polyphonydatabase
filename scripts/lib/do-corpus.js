/**
 * Divinum Officium corpus index (data/divinumofficium): parses the DO day
 * files and builds an incipit index of every proper Mass/Office text unit.
 * Used by suggest-title-functions-do.js (positional matching) and by the
 * Cantus matcher (to SKIP titles the DO corpus already covers).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeFeast, mapFeast, foldSpelling, normalizeIncipit, titleCase } from './matching.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DO_DIR = path.join(ROOT, 'data', 'divinumofficium');

// Units are indexed on their opening words; incipits shorter than this only
// match if they cover the whole unit.
export const MIN_PART_WORDS = 2;
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
export function buildCorpus(functionNames) {
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

  const addUnit = (text, place, citation) => {
    const norm = foldSpelling(normalizeIncipit(text));
    const words = norm.split(' ').filter(Boolean);
    if (words.length < 2) return;
    const key = words.slice(0, 12).join(' ');
    if (!units.has(key)) {
      units.set(key, { sample: text.slice(0, 120), words: words.slice(0, 12), days: new Set(), places: [], citation: citation || '' });
      const first2 = words.slice(0, 2).join(' ');
      if (!index.has(first2)) index.set(first2, []);
      index.get(first2).push(key);
    }
    const u = units.get(key);
    u.days.add(place.day);
    if (!u.citation && citation) u.citation = citation;
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
        // Scripture citations are short "!Ps 136:1" lines preceding the
        // text — attach the most recent one to each unit so reviewers can
        // see at a glance that a match is e.g. a psalm verse.
        let lastCitation = '';
        for (const line of all) {
          const raw = String(line).trim();
          if (raw.startsWith('!')) {
            const c = raw.replace(/^!+\s*/, '');
            if (/^[A-Za-z0-9 .]{1,30}\d/.test(c) && c.length <= 40) lastCitation = c;
            continue;
          }
          const t = cleanLine(line);
          if (t && t.split(' ').length >= 2) {
            addUnit(t, { fn: cls.fn || null, newName: cls.newName || null, position: name, day: rel, dayLabel: label || path.basename(rel, '.txt') }, lastCitation);
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

export function matchPart(part, corpus) {
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

