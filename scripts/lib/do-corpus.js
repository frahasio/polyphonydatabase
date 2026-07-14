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
import { translateFeastLabel } from './feast-names.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DO_DIR = path.join(ROOT, 'data', 'divinumofficium');

// Units are indexed on their opening words; incipits shorter than this only
// match if they cover the whole unit.
export const MIN_PART_WORDS = 2;
// Mass sections that carry sung proper texts (motet sources) — these
// generate suggestions.
const MISSA_SECTIONS = new Set(['Introitus', 'Graduale', 'GradualeF', 'GradualeP', 'Tractus', 'Sequentia', 'Offertorium', 'OffertoriumP', 'Communio', 'CommunioP']);
// Office sections: antiphons, responsories, hymns, chapters, invitatories.
const HORAS_SECTION_RE = /^(Ant\b|Responsory|Hymnus|Capitulum|Invit)/;
// PROSE sections: Gospels, Epistles, Matins lessons. These DO provide
// motet texts (gospel motets abound), so they generate suggestions — but
// they are long prose, so they're indexed sentence-by-sentence, and the
// pericope formulas ("In illo tempore:", "In diebus illis:", "Fratres:")
// are stripped so the real opening is indexed too. Formulaic incipits are
// protected against by the union-days generic filter, which sees every
// pericope of the year.
//
// CAVEAT — Office Matins lessons in TEMPORA are scripture read IN COURSE
// (the cycle just happens to be passing through Romans that week), so a
// unique hit there is coincidence, not properness: it made "Christus
// resurgens" claim a Pentecost-season feria instead of its real Easter
// propers. Tempora Matins lessons are therefore frequency-only; feast-day
// lessons (Sancti/Commune — e.g. the Song of Songs lessons of the
// Assumption) remain evidence, as do all MASS pericopes, which are proper.
const PROSE_SECTION_RE = /^(Evangelium|Lectio)/;
// FREQUENCY-ONLY sections: orations. Their openings ("Deus, qui...")
// contribute to generic-ness counting but don't generate suggestions.
const FREQ_SECTION_RE = /^(Oratio|Secreta|Postcommunio|Super populum|Commemoratio)/;
// Pericope introduction formulas to strip for the alternate index entry.
const PERICOPE_FORMULA_RE = /^(in illo t[ée]mpore|in di[ée]bus illis|fratres|car[ií]ssim[ei]|dilect[ií]ssimi|h[aæ]c dicit d[óo]minus deus)[:,.]?\s+/i;

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

/**
 * Liturgical season of a DO day file (by Tempora filename convention), or
 * null for days outside the devotional seasons (post-Epiphany and
 * post-Pentecost ordinary time, pre-Lent, Sancti, Commune). Season names
 * are catalogue function names — a text used on many days WITHIN one
 * season is a good match for the season-level function.
 */
export function seasonOfDay(rel) {
  if (!rel.includes('/Tempora/')) return null;
  const base = path.basename(rel, '.txt');
  if (/^Adv/.test(base)) return 'Advent';
  if (/^Nat/.test(base)) return 'Christmas';       // incl. Jan 2-5 files
  if (/^Quadp/.test(base)) return null;            // pre-Lent
  if (/^Quad/.test(base)) return 'Lent';           // incl. Passiontide/Holy Week
  if (/^Pasc7/.test(base)) return 'Pentecost';     // Whitsun week
  if (/^Pasc/.test(base)) return 'Easter';         // Eastertide
  return null; // Epi*, Pent*, PentEpi*, numbered scripture weeks
}

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

  const fnByLower = new Map(functionNames.map((n) => [n.toLowerCase(), n]));

  // Map a day file's [Officium] label to a function: FEAST_MAP first, then a
  // saint-stem heuristic against existing function names ("Sancti Barnabae
  // Apostoli" -> "St Barnabas"), then the Latin->English dictionary (which
  // may also resolve to an EXISTING function), else a new-function proposal
  // in title-cased Latin (Sancti only).
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
    const translated = translateFeastLabel(norm);
    if (translated) {
      const existing = fnByLower.get(translated.toLowerCase());
      if (existing) return { fn: existing };
      if (rel.includes('/Sancti/')) return { newName: translated };
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
      // Rubric-variant files (Pasc0-3t.txt, Nat29o.txt) are the SAME
      // calendar day as their base file — they must not inflate day
      // counts or a text proper to 3 days looks proper to 6.
      const dayId = rel.replace(/(\d)[a-z]+\.txt$/i, '$1.txt');
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
        const mode = sectionFilter(name); // 'evidence' | 'freq' | falsy
        if (!mode) continue;
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
          if (!t || t.split(' ').length < 2) continue;
          const place = {
            fn: mode !== 'freq' ? (cls.fn || null) : null,
            newName: mode !== 'freq' ? (cls.newName || null) : null,
            position: name,
            day: dayId,
            dayLabel: label || path.basename(rel, '.txt'),
          };
          if (mode === 'prose') {
            // Long prose: index each sentence, and additionally the
            // formula-stripped opening ("In illo tempore: dixit Jesus..."
            // also indexed as "dixit Jesus...").
            const sentences = t.split(/(?<=[.:;?!])\s+/).filter((s) => s.split(' ').length >= 3);
            for (const s of sentences) {
              addUnit(s, place, lastCitation);
              const stripped = s.replace(PERICOPE_FORMULA_RE, '');
              if (stripped !== s && stripped.split(' ').length >= 3) addUnit(stripped, place, lastCitation);
            }
          } else {
            addUnit(t, place, lastCitation);
          }
        }
      }
    }
  };

  const missaFilter = (s) => (MISSA_SECTIONS.has(s) ? 'evidence'
    : PROSE_SECTION_RE.test(s) ? 'prose'
    : FREQ_SECTION_RE.test(s) ? 'freq' : null);
  // lessonsAreProper: on feast days (Sancti/Commune) Matins lessons are
  // proper texts; in Tempora they're in-course scripture -> frequency-only.
  const horasFilter = (lessonsAreProper) => (s) => (HORAS_SECTION_RE.test(s) ? 'evidence'
    : PROSE_SECTION_RE.test(s) ? (lessonsAreProper ? 'prose' : 'freq')
    : FREQ_SECTION_RE.test(s) ? 'freq' : null);
  walk('missa/Latin/Tempora', missaFilter);
  walk('missa/Latin/Sancti', missaFilter);
  walk('horas/Latin/Tempora', horasFilter(false));
  walk('horas/Latin/Sancti', horasFilter(true));
  walk('horas/Latin/Commune', (s) => (HORAS_SECTION_RE.test(s) || MISSA_SECTIONS.has(s) ? 'evidence'
    : PROSE_SECTION_RE.test(s) ? 'prose'
    : FREQ_SECTION_RE.test(s) ? 'freq' : null));

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

