/**
 * Reader for the vendored Divinum Officium Mass texts (data/divinumofficium).
 *
 * DO file format: [Section] headers followed by body lines with light markup:
 *   !text        rubric or scripture citation line
 *   v. text      spoken/sung text line
 *   V./R. text   versicle/response
 *   $Per Dominum standard ending macro
 *   &Gloria      include macro (ignored here)
 *   @Folder/File:Section  cross-reference to another file's section
 *   ~            line continues into the next
 *   _            spacing line
 *
 * A [Rule] of "vide C5b" means missing sections fall back to the common C5b
 * (in horas/<lang>/Commune). Exposes getMassSections(relPath, lang) returning
 * { sectionName: { text, citation } } with references resolved.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DO_DIR = path.join(ROOT, 'data', 'divinumofficium');

// Standard ending formulas, keyed by the start of the $-macro text.
const ENDINGS_LA = {
  'per dominum': 'Per Dóminum nostrum Iesum Christum, Fílium tuum: qui tecum vivit et regnat in unitáte Spíritus Sancti Deus, per ómnia sǽcula sæculórum. Amen.',
  'per eundem': 'Per eúndem Dóminum nostrum Iesum Christum Fílium tuum, qui tecum vivit et regnat in unitáte Spíritus Sancti, Deus, per ómnia sǽcula sæculórum. Amen.',
  'qui vivis': 'Qui vivis et regnas cum Deo Patre, in unitáte Spíritus Sancti, Deus, per ómnia sǽcula sæculórum. Amen.',
  'qui tecum': 'Qui tecum vivit et regnat in unitáte Spíritus Sancti, Deus, per ómnia sǽcula sæculórum. Amen.',
  'in unitate spiritus': 'In unitáte Spíritus Sancti, Deus, per ómnia sǽcula sæculórum. Amen.',
};
const ENDINGS_EN = {
  'per dominum': 'Through Jesus Christ, thy Son our Lord, Who liveth and reigneth with thee, in the unity of the Holy Ghost, God, world without end. Amen.',
  'per eundem': 'Through the same Jesus Christ, thy Son, Our Lord, Who liveth and reigneth with thee in the unity of the Holy Ghost, God, world without end. Amen.',
  'qui vivis': 'Who livest and reignest with God the Father, in the unity of the Holy Ghost, God, world without end. Amen.',
  'qui tecum': 'Who liveth and reigneth with thee, in the unity of the Holy Ghost, God, world without end. Amen.',
  'in unitate spiritus': 'In the unity of the Holy Ghost, God, world without end. Amen.',
};

function readDoFile(relPath, lang) {
  const p = path.join(DO_DIR, relPath.replace('<lang>', lang));
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

/** Split a DO file into { SectionName: [raw lines] }. */
function splitSections(raw) {
  const sections = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\[([^\]]+)\]\s*$/);
    if (m) { current = m[1]; sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  return sections;
}

function expandEnding(text, lang) {
  const map = lang === 'English' ? ENDINGS_EN : ENDINGS_LA;
  const key = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
  for (const [k, v] of Object.entries(map)) if (key.startsWith(k)) return v;
  return null;
}

/**
 * Render section lines to { text, citation }: plain text paragraphs with
 * versicle markers kept, citations (leading ! lines like "Ps 46:2") captured.
 */
function renderSection(lines, lang) {
  const paras = [];
  const citations = [];
  let buf = [];
  const flush = () => { if (buf.length) { paras.push(buf.join(' ')); buf = []; } };

  for (let line of lines) {
    line = line.replace(/~\s*$/, '').trim();
    if (!line || line === '_') { flush(); continue; }
    if (line.startsWith('&')) continue; // include macros (Gloria etc.)
    if (line.startsWith('$')) {
      flush();
      const ending = expandEnding(line.slice(1), lang);
      if (ending) paras.push(ending);
      continue;
    }
    if (line.startsWith('!')) {
      const t = line.replace(/^!+\s*/, '');
      // Scripture citations are short "Book 1:2" strings; longer ! lines are rubrics.
      if (/^[A-Za-z0-9 .]{1,30}\d/.test(t) && t.length <= 40) citations.push(t);
      continue;
    }
    line = line.replace(/^v\.\s*/, '').replace(/\+\+?/g, '✠');
    buf.push(line);
  }
  flush();
  return { text: paras.join('\n\n').trim(), citation: citations[0] || '' };
}

/** Resolve "@Folder/File" or "@Folder/File:Section" body references. */
function resolveReference(line, sectionName, lang) {
  const m = line.match(/^@([\w/-]+)(?::([^:]+))?/);
  if (!m) return null;
  const [, ref, section] = m;
  const relPath = ref.startsWith('Commune/')
    ? `horas/<lang>/${ref}.txt`
    : `missa/<lang>/${ref}.txt`;
  const raw = readDoFile(relPath, lang);
  if (!raw) return null;
  const sections = splitSections(raw);
  const wanted = (section || sectionName).split(';;')[0].trim();
  return sections[wanted] || null;
}

/**
 * Get resolved Mass sections for a DO file.
 * @param relPath e.g. 'missa/<lang>/Tempora/Pent07-0.txt' or 'horas/<lang>/Commune/C5b.txt'
 * @param lang 'Latin' | 'English'
 */
export function getMassSections(relPath, lang) {
  const raw = readDoFile(relPath, lang);
  if (raw == null) return null;
  const sections = splitSections(raw);

  // "vide Cxx" in [Rule] (Latin side declares it; apply to both languages).
  let fallback = null;
  const ruleRaw = readDoFile(relPath, 'Latin');
  const rule = ruleRaw ? (splitSections(ruleRaw).Rule || []).join('\n') : '';
  const vide = rule.match(/vide\s+(C\d+[a-z0-9-]*)/i);
  if (vide) {
    const fbRaw = readDoFile(`horas/<lang>/Commune/${vide[1]}.txt`, lang);
    if (fbRaw) fallback = splitSections(fbRaw);
  }

  const WANTED = ['Introitus', 'Oratio', 'Lectio', 'Graduale', 'Tractus', 'Sequentia',
    'Evangelium', 'Offertorium', 'Secreta', 'Communio', 'Postcommunio'];
  const out = {};
  for (const name of WANTED) {
    let lines = sections[name] || (fallback ? fallback[name] : null);
    if (!lines) continue;
    // Whole-section references: single @ line.
    const refLine = lines.find((l) => l.trim().startsWith('@'));
    if (refLine) {
      const resolved = resolveReference(refLine.trim(), name, lang);
      if (resolved) {
        lines = lines.flatMap((l) => (l.trim().startsWith('@') ? resolved : [l]));
      }
    }
    const rendered = renderSection(lines, lang);
    if (rendered.text) out[name] = rendered;
  }
  return Object.keys(out).length ? out : null;
}

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** Map a jgabc day key to a DO file path template (with <lang>), or null. */
export function doPathForKey(key) {
  // Sanctorale: MonDD (Jan17, Dec25_2 handled below)
  let m = key.match(/^([A-Z][a-z]{2})(\d{1,2})$/);
  if (m && MONTHS[m[1]]) {
    return `missa/<lang>/Sancti/${MONTHS[m[1]]}-${String(m[2]).padStart(2, '0')}.txt`;
  }
  m = key.match(/^Dec25_(\d)$/);
  if (m) return m[1] === '3' ? 'missa/<lang>/Sancti/12-25.txt' : `missa/<lang>/Sancti/12-25m${m[1]}.txt`;

  const W = { m: 1, t: 2, w: 3, h: 4, f: 5, s: 6, ss: 6 };
  const week = (base, suffix) => `missa/<lang>/Tempora/${base}-${suffix ? W[suffix] : 0}.txt`;

  m = key.match(/^Adv(\d)(m|t|w|h|f|s|ss)?$/);
  if (m) return week(`Adv${m[1]}`, m[2]);
  m = key.match(/^Epi(\d)s?$/);
  if (m) return week(`Epi${m[1]}`);
  if (key === 'Nat1') return 'missa/<lang>/Tempora/Nat1-0.txt';
  if (key === 'Nat2') return 'missa/<lang>/Tempora/Nat2-0.txt';
  if (key === 'Jan1') return 'missa/<lang>/Sancti/01-01.txt';
  if (key === 'Jan5a') return 'missa/<lang>/Sancti/01-05.txt';
  if (key === 'Epi') return 'missa/<lang>/Sancti/01-06.txt';
  if (key === 'Dec24') return 'missa/<lang>/Sancti/12-24.txt';

  // Pre-Lent: 7a/6a/5a = Septuagesima/Sexagesima/Quinquagesima (DO Quadp1-3)
  m = key.match(/^([765])a(w|h|f|s)?$/);
  if (m) {
    const n = { 7: 1, 6: 2, 5: 3 }[m[1]];
    return week(`Quadp${n}`, m[2]);
  }
  m = key.match(/^Quad(\d)(m|t|w|h|f|s|ss)?$/);
  if (m) return week(`Quad${m[1]}`, m[2]);
  m = key.match(/^Pasc(\d)(m|t|w|h|f|s)?$/);
  if (m) return week(`Pasc${m[1]}`, m[2]);
  if (key === 'Asc') return 'missa/<lang>/Tempora/Pasc5-4.txt';
  // Pentecost week is DO's Pasc7
  m = key.match(/^Pent0(m|t|w|h|f|s|ss)?$/);
  if (m) return week('Pasc7', m[1]);
  m = key.match(/^Pent(\d+)(w)?$/);
  if (m) return `missa/<lang>/Tempora/Pent${String(m[1]).padStart(2, '0')}-${m[2] ? 3 : 0}.txt`;
  if (key === 'CorpusChristi') return 'missa/<lang>/Tempora/Pent01-4.txt';
  if (key === 'SCJ') return 'missa/<lang>/Tempora/Pent02-5.txt';
  if (key === 'ChristusRex') return 'missa/<lang>/Tempora/104-0.txt';
  if (key === 'EmbWedSept') return 'missa/<lang>/Tempora/093-3.txt';
  if (key === 'EmbFriSept') return 'missa/<lang>/Tempora/093-5.txt';
  if (key === 'EmbSatSept') return 'missa/<lang>/Tempora/093-6.txt';
  return null;
}

/** Commons: jgabc mass_* key -> DO Commune file id. */
export const COMMONS_DO = {
  mass_holy_pope: 'C2',
  mass_i_martyr_bishop: 'C2',
  mass_ii_martyr_bishop: 'C2',
  mass_one_martyr: 'C2a',
  mass_i_martyr_not_bishop: 'C2a',
  mass_ii_martyr_not_bishop: 'C2a',
  mass_i_two_or_more_martyr: 'C3a',
  mass_iii_two_or_more_martyr: 'C3a',
  mass_i_confessor_bishop: 'C4',
  mass_ii_confessor_bishop: 'C4',
  mass_doctors: 'C4a',
  mass_i_confessor_not_bishop: 'C5',
  mass_ii_confessor_not_bishop: 'C5',
  mass_abbots: 'C5b',
  mass_i_virgin_martyr: 'C6',
  mass_ii_virgin_martyr: 'C6',
  mass_i_virgin_not_martyr: 'C6a',
  mass_holy_woman_martyr: 'C7',
  mass_holy_woman_not_martyr: 'C7a',
  mass_bvm: 'C11',
  mass_dedication_church: 'C8',
};

/** Feast display title from the DO file's [Officium] section, if present. */
export function doTitle(relPath, lang) {
  const raw = readDoFile(relPath, lang);
  if (!raw) return '';
  const s = splitSections(raw);
  return s.Officium ? s.Officium.filter((l) => l.trim() && !l.startsWith('!')).join(' ').trim() : '';
}
