/**
 * PROOF OF CONCEPT: generate a complete Second Vespers booklet template
 * (Immaculate Conception, Dec 8) by combining:
 *
 *   - Divinum Officium horas files  -> antiphon texts + psalm numbers,
 *                                      collect, translations
 *   - GregoBase corpus              -> antiphon/hymn GABC scores + modes
 *   - jgabc psalmtone.node.js       -> pointed psalm verses:
 *       verse 1 as notated GABC (with bold and italic syllable markup),
 *       verses 2+ as text with b/i accents, antiphon repeated after
 *   - hand-made Thursday-Vespers-2026.json -> ordinary blocks (Deus in
 *     adjutorium, conclusion) and house styles
 *
 * Usage: node scripts/generate-vespers-poc.js <path-to-gregobase-corpus> [--dry]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';
import { loadPsalmtone } from './lib/psalmtone-loader.js';
import { normalizeLatinText, normalizeGabcLyrics } from '../src/services/latinNormalize.js';

const DRY = process.argv.includes('--dry');
const GREGOBASE = process.argv[2];
if (!GREGOBASE || !fs.existsSync(path.join(GREGOBASE, 'csv', 'chants.csv'))) {
  console.error('Usage: node scripts/generate-vespers-poc.js <path-to-gregobase-corpus> [--dry]');
  process.exit(1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JGABC = path.join(ROOT, 'public', 'vendor', 'jgabc');
const DO_DIR = path.join(ROOT, 'data', 'divinumofficium');
const SKELETON_PATH = path.join(ROOT, 'templates-incoming', 'Thursday-Vespers-2026.json');

const pt = loadPsalmtone();

// ---------- small utils ----------

function readText(p) {
  const buf = fs.readFileSync(p);
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normIncipit = (s) => stripAccents(String(s).toLowerCase())
  .replace(/\(.*?\)/g, ' ')
  .replace(/\bj/g, 'i').replace(/ae/g, 'e').replace(/oe/g, 'e')
  .replace(/[^a-z ]/g, ' ')
  .replace(/([a-z])\1/g, '$1') // fold geminates: immaculata/imaculata
  .replace(/\s+/g, ' ').trim();

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- GregoBase ----------

/** Minimal CSV parser (quoted fields, doubled-quote escapes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let gregoIndex = null;
function loadGregobase() {
  if (gregoIndex) return gregoIndex;
  const rows = parseCsv(readText(path.join(GREGOBASE, 'csv', 'chants.csv')));
  const header = rows[0];
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const chants = rows.slice(1).filter((r) => r.length > col.mode_var).map((r) => ({
    id: r[col.id],
    version: r[col.version],
    incipit: r[col.incipit],
    office_part: r[col.office_part],
    mode: r[col.mode],
    mode_var: r[col.mode_var],
  }));
  gregoIndex = chants;
  return chants;
}

const VERSION_RANK = ['Solesmes 1961', 'Solesmes 1934', 'Solesmes', 'Vatican'];

/** Lyric words of a GABC body (lowercased, accent-folded). */
function gabcLyricWords(gabc) {
  let body = gabc;
  const pct = body.indexOf('%%');
  if (pct >= 0) body = body.slice(pct + 2);
  // Remove note groups entirely so syllables rejoin into words, then strip
  // markup; spaces between GABC words survive as word separators.
  return normIncipit(body.replace(/\([^)]*\)/g, '').replace(/<[^>]*>/g, '').replace(/[*{}_|]/g, ''));
}

/**
 * Find the best GregoBase chant for a full antiphon text + office part.
 * Incipit prefilter, then verify the chant's own lyrics against the text
 * (same incipit can hide a different antiphon, e.g. the two Tota pulchras).
 */
function findChant(fullText, parts) {
  const wantWords = normIncipit(fullText).split(' ');
  const want2 = wantWords.slice(0, 2).join(' ');
  const cands = loadGregobase().filter((c) =>
    parts.includes(c.office_part) && normIncipit(c.incipit).startsWith(want2));
  if (!cands.length) return null;

  const scored = cands.map((c) => {
    const gabcPath = path.join(GREGOBASE, 'gabc', `${String(c.id).padStart(5, '0')}.gabc`);
    if (!fs.existsSync(gabcPath)) return null;
    const gabc = readText(gabcPath);
    const lyricWords = gabcLyricWords(gabc).split(' ');
    // How many consecutive words of the wanted text appear at the lyric start?
    let run = 0;
    while (run < wantWords.length && run < lyricWords.length && wantWords[run] === lyricWords[run]) run++;
    return { ...c, gabc, run };
  }).filter(Boolean).filter((c) => c.run >= Math.min(4, wantWords.length));
  if (!scored.length) return null;

  scored.sort((a, b) => {
    // Prefer plain incipits over "(another chant)" variants, then the standard
    // Solesmes editions, then the longest verified lyric run.
    const qa = /\(.*(another|\d)\)/i.test(a.incipit) ? 1 : 0;
    const qb = /\(.*(another|\d)\)/i.test(b.incipit) ? 1 : 0;
    if (qa !== qb) return qa - qb;
    const ra = VERSION_RANK.indexOf(a.version); const rb = VERSION_RANK.indexOf(b.version);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return b.run - a.run;
  });
  return scored[0];
}

// ---------- Divinum Officium ----------

function doSections(relPath) {
  const p = path.join(DO_DIR, relPath);
  if (!fs.existsSync(p)) return {};
  const raw = readText(p);
  const sections = {};
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    // Headers may carry a rubric variant: "[Ant Vespera] (rubrica monastica)".
    const m = line.match(/^\[([^\]]+)\]\s*(\(.*\))?\s*$/);
    if (m) {
      cur = m[2] ? `${m[1]} ${m[2]}` : m[1];
      sections[cur] = sections[cur] || [];
      continue;
    }
    if (cur) sections[cur].push(line);
  }
  return sections;
}

/** Parse '[Ant Vespera]' lines -> [{text, psalm}] */
function parseAntiphons(lines, lang = 'la') {
  return (lines || []).filter((l) => l.trim() && !l.startsWith('!'))
    .map((l) => {
      const [text, ps] = l.split(';;');
      const t = text.replace(/\s*\*\s*/, ' * ').trim();
      return { text: lang === 'la' ? normalizeLatinText(t) : t, psalm: (ps || '').trim() };
    })
    .filter((a) => a.text);
}

function sectionText(lines, lang = 'la') {
  const text = (lines || []).filter((l) => l.trim() && !l.startsWith('!') && !l.startsWith('$') && !l.startsWith('&') && !l.startsWith('@'))
    .map((l) => l.replace(/^v\.\s*/, '').replace(/~$/, '').trim()).join('\n').trim();
  return lang === 'la' ? normalizeLatinText(text) : text;
}

// ---------- psalm pointing ----------

// Booklet chant lyrics use *bold* and _italic_; readings use <b>/<i>.
const GABC_FORMAT = {
  bold: ['*', '*'], italic: ['_', '_'], nbsp: ' ',
  verse: ['($c. )', ''], versesName: '',
};
const HTML_FORMAT = {
  bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], nbsp: '&nbsp;',
  verse: ['', ''], versesName: '',
};

function toneFor(mode, modeVar) {
  const tones = pt.g_tones;
  const key = `${mode}.`;
  const tone = tones[key] || tones[`${mode} alt`];
  if (!tone) return null;
  let term = tone.termination;
  let termKey = '';
  if (!term && tone.terminations) {
    const keys = Object.keys(tone.terminations);
    termKey = [modeVar, modeVar?.toUpperCase(), modeVar?.toLowerCase()].find((k) => k && tone.terminations[k]) || keys[0];
    term = tone.terminations[termKey];
  }
  return { clef: tone.clef, mediant: tone.mediant, termination: term, label: `${mode}${termKey}` };
}

function splitVerse(line) {
  const parts = line.split(' * ');
  if (parts.length === 3) return [parts.slice(0, 2).join(' † '), parts[2]];
  return parts;
}

// Verse 1 as notated GABC in the given tone, with bold/italic lyric markup.
function firstVerseGabc(verse, tone, psalmName) {
  const med = pt.getGabcTones(tone.mediant);
  const ter = pt.getGabcTones(tone.termination);
  const [a, b] = splitVerse(verse);
  const opts = (text, gabcTones, prefix, suffix) => ({
    text, gabc: gabcTones,
    useOpenNotes: false, useBoldItalic: true, onlyVowel: false,
    format: GABC_FORMAT, verseNumber: 1,
    prefix, suffix, italicizeIntonation: false, favor: 'intonation',
  });
  let gabc = `(${tone.clef})`;
  gabc += pt.applyPsalmTone(opts(a.trim(), med, true, false));
  if (b) gabc += ' *(:) ' + pt.applyPsalmTone(opts(b.trim(), ter, false, true));
  gabc += ' (::)';
  return `name: ${psalmName};\noffice-part: Ps;\n%%\n${gabc}`;
}

/** Verses 2+ as HTML list items with <b>/<i> accent markup (no notes). */
function verseHtml(verse, tone, verseNumber) {
  const med = pt.getGabcTones(tone.mediant);
  const ter = pt.getGabcTones(tone.termination);
  const [a, b] = splitVerse(verse);
  const point = (text, tones) => pt.addBoldItalic(
    text.trim(), tones.accents, tones.preparatory, tones.afterLastAccent,
    'html', false, '', false, false
  );
  let html = point(a, med);
  if (b) html += ' * ' + point(b, ter);
  return html;
}

function loadPsalm(psalmNum) {
  const p = path.join(JGABC, 'psalms', `${psalmNum}.txt`);
  if (!fs.existsSync(p)) return null;
  return normalizeLatinText(pt.normalizePsalm(readText(p).trim(), true)); // + Gloria Patri
}

function loadCanticle(name) {
  const p = path.join(JGABC, 'psalms', `${name}.txt`);
  if (!fs.existsSync(p)) return null;
  return normalizeLatinText(pt.normalizePsalm(readText(p).trim(), true));
}

// Douay psalms: tab-separated "psalm<TAB>verse<TAB>text"
let douayPsalms = null;
function douayPsalm(num) {
  if (!douayPsalms) {
    douayPsalms = {};
    const raw = readText(path.join(JGABC, 'douay-rheims', 'Psalmi'));
    for (const line of raw.split('\n')) {
      const [ps, , text] = line.split('\t');
      if (!ps || !text) continue;
      (douayPsalms[ps.trim()] ||= []).push(text.trim());
    }
  }
  return douayPsalms[String(num)] || null;
}

const GLORIA_EN = 'Glory be to the Father, and to the Son, and to the Holy Ghost. As it was in the beginning, is now, and ever shall be, world without end. Amen.';

// ---------- antiphon helpers ----------

function antiphonGabc(chant, { annotationNum, translation, repeat }) {
  let body = normalizeGabcLyrics(chant.gabc);
  // GregoBase files may carry their own headers; take the notation only.
  const pct = body.indexOf('%%');
  if (pct >= 0) body = body.slice(pct + 2).trim();
  if (repeat) {
    // Repeat after the psalm: drop the standalone intonation star
    // (keep *bold* annotation markup, which is always attached to a word).
    body = body.replace(/(^|\s)\*(\s|$)/g, '$1').replace(/\s{2,}/g, ' ');
  }
  const headers = [
    `name: ${chant.incipit.replace(/\s*\(.*?\)\s*$/, '')};`,
    'office-part: Ant;',
    `annotation: *Ant. ${annotationNum}*;`,
    `annotation: ${chant.mode}${chant.mode_var || ''};`,
  ];
  return { gabc: `${headers.join('\n')}\n%%\n${body}`, translation: translation || '' };
}

// ---------- skeleton (hand-made Vespers) ----------

const SKELETON_PARTS = {
  deusInAdjutorium: [5, 'chant_gabc', /Deus in adiutorium/i],
  rubricStand: [4, 'rubric', /All stand/],
  psalmVerseStyle: [13, 'reading', /./],
  hymnStyle: [36, 'reading', /./],
  domVobiscum: [49, 'chant_gabc', /Dominus vobiscum/i],
  benedicamus: [50, 'chant_gabc', /name:\s*1cl 2v/i],
  rubricLowVoice: [51, 'rubric', /low voice/i],
  fidelium: [52, 'chant_gabc', /Fidelium/i],
  antiphonStyle: [11, 'chant_gabc', /In caelestibus/i],
  psalmGabcStyle: [12, 'chant_gabc', /name:\s*110/i],
  oratioChant: [46, 'chant_gabc', /Oratio/i],
  capitulumChant: [34, 'chant_gabc', /Capitulum/i],
  versusChant: [39, 'chant_gabc', /Versus/i],
};

function loadSkeleton() {
  const doc = JSON.parse(readText(SKELETON_PATH));
  const parts = {};
  for (const [name, [idx, type, fp]] of Object.entries(SKELETON_PARTS)) {
    const b = doc.blocks[idx];
    const hay = `${b?.text || ''} ${b?.gabc || ''}`;
    if (!b || b.type !== type || !fp.test(hay)) {
      throw new Error(`Vespers skeleton mismatch at ${idx} (${name}): got ${b?.type}`);
    }
    parts[name] = b;
  }
  parts.settings = doc.settings;
  return parts;
}

function styleOf(block) {
  const s = { ...block };
  delete s.id; delete s.type; delete s.gabc; delete s.text; delete s.translation;
  delete s.chantTranslation; delete s.html;
  return s;
}

// ---------- build ----------

async function main() {
  const skeleton = loadSkeleton();
  const chantStyle = styleOf(skeleton.antiphonStyle);
  const psalmChantStyle = styleOf(skeleton.psalmGabcStyle);
  const verseStyle = styleOf(skeleton.psalmVerseStyle);

  const la = doSections('horas/Latin/Sancti/12-08.txt');
  const en = doSections('horas/English/Sancti/12-08.txt');

  const antsLa = parseAntiphons(la['Ant Vespera']);
  const antsEn = parseAntiphons(en['Ant Vespera'], 'en');
  if (antsLa.length !== 5) throw new Error(`Expected 5 Vespers antiphons, got ${antsLa.length}`);

  let n = 0;
  const bid = () => `poc_ic_vespers_${n++}`;
  const clone = (part, overrides = {}) => ({ ...JSON.parse(JSON.stringify(part)), id: bid(), ...overrides });
  const titleBlock = (text, pt2 = 12) => ({
    id: bid(), type: 'title', text,
    titleFontKey: '', titleTextColor: '#212529', titleLineColor: '#adb5bd',
    titleBold: false, titleItalic: false, titleSmallCaps: true,
    sectionGapAfterMm: 8, titleFontSizePt: pt2,
  });

  const blocks = [];
  blocks.push(titleBlock('The Immaculate Conception of the Blessed Virgin Mary', 18));
  blocks.push({ ...clone(skeleton.psalmVerseStyle), text: '<div style="text-align:center">Second Vespers</div>', translation: '', sectionTitle: '', sectionSourceRef: '' });

  blocks.push(titleBlock('Incipit'));
  blocks.push(clone(skeleton.rubricStand));
  blocks.push(clone(skeleton.deusInAdjutorium));

  blocks.push(titleBlock('Psalmi'));

  const report = [];
  for (let i = 0; i < 5; i++) {
    const antLa = antsLa[i];
    const antEn = antsEn[i] || { text: '' };
    const incipit = antLa.text.split('*')[0].trim();
    const chant = findChant(antLa.text.replace(/\s*\*\s*/, ' '), ['an']);
    if (!chant) {
      report.push(`Ant ${i + 1} "${incipit}": NO GREGOBASE MATCH — placeholder inserted`);
      blocks.push({ ...clone(skeleton.psalmVerseStyle), text: `<div>[Antiphon ${i + 1}: ${escHtml(antLa.text)} — GABC needed]</div>`, translation: antEn.text ? `<div>${escHtml(antEn.text)}</div>` : '' });
      continue;
    }
    const tone = toneFor(chant.mode, chant.mode_var);
    report.push(`Ant ${i + 1} "${incipit}": GregoBase #${chant.id} (${chant.version}, mode ${chant.mode}${chant.mode_var || ''}) -> tone ${tone ? tone.label : 'NONE'} | Ps ${antLa.psalm}`);

    // Antiphon
    const ant = antiphonGabc(chant, { annotationNum: i + 1, translation: antEn.text });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc: ant.gabc, chantTranslation: ant.translation, ...chantStyle, chantUseDropCap: true });

    // Psalm
    const psalmText = loadPsalm(antLa.psalm);
    if (psalmText && tone) {
      const verses = psalmText.split('\n').filter(Boolean);
      blocks.push({ id: bid(), type: 'chant_gabc', gabc: firstVerseGabc(verses[0], tone, antLa.psalm), chantTranslation: '', ...psalmChantStyle, chantUseDropCap: false });
      const items = verses.slice(1).map((v, vi) => `<li>${verseHtml(v, tone, vi + 2)}</li>`).join('');
      const enVerses = douayPsalm(antLa.psalm);
      const enItems = enVerses
        ? enVerses.slice(1).map((v) => `<li>${escHtml(v)}</li>`).join('') + `<li>${escHtml(GLORIA_EN)}</li>`
        : '';
      blocks.push({
        ...clone(skeleton.psalmVerseStyle),
        text: `<ol start="2">${items}</ol>`,
        translation: enItems ? `<ol start="2">${enItems}</ol>` : '',
        sectionTitle: '', sectionSourceRef: `Ps ${antLa.psalm}`,
      });
    } else {
      report.push(`  Ps ${antLa.psalm}: ${psalmText ? 'no tone' : 'TEXT NOT FOUND'}`);
    }

    // Antiphon repeat (no star, no drop cap)
    const antRep = antiphonGabc(chant, { annotationNum: i + 1, repeat: true });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc: antRep.gabc, chantTranslation: '', ...chantStyle, chantUseDropCap: false });
    blocks.push({ id: bid(), type: 'hr' });
  }

  // Capitulum
  blocks.push(titleBlock('Capitulum'));
  blocks.push(clone(skeleton.rubricStand));
  const capLa = sectionText(la['Capitulum Laudes']);
  const capEn = sectionText(en['Capitulum Laudes'], 'en');
  if (capLa) {
    blocks.push({ ...clone(skeleton.psalmVerseStyle), text: `<div style="text-align:justify">${escHtml(capLa)} <b>R.</b> Deo grátias.</div>`, translation: capEn ? `<div style="text-align:justify">${escHtml(capEn)} <b>R.</b> Thanks be to God.</div>` : '', sectionTitle: '', sectionSourceRef: 'Prov 8:22-24' });
  }

  // Hymn (Ave maris stella)
  blocks.push(titleBlock('Hymnus'));
  const hymn = findChant('Ave maris stella', ['hy']);
  if (hymn) {
    report.push(`Hymn "Ave maris stella": GregoBase #${hymn.id} (${hymn.version}, mode ${hymn.mode})`);
    const h = antiphonGabc(hymn, { annotationNum: '', translation: '' });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc: h.gabc.replace(/annotation: \*Ant\. \*;\n/, '').replace('office-part: Ant;', 'office-part: Hymnus;'), chantTranslation: '', ...chantStyle, chantUseDropCap: true });
  }

  // Versicle
  blocks.push(titleBlock('Versus'));
  const versLa = sectionText(la['Versum 1']);
  const versEn = sectionText(en['Versum 1'], 'en');
  if (versLa) {
    blocks.push({ ...clone(skeleton.psalmVerseStyle), text: `<div>${escHtml(versLa).replace(/^V\./m, '<b>V.</b>').replace(/\nR\./, '<br><b>R.</b>')}</div>`, translation: versEn ? `<div>${escHtml(versEn).replace(/^V\./m, '<b>V.</b>').replace(/\nR\./, '<br><b>R.</b>')}</div>` : '', sectionTitle: '', sectionSourceRef: '' });
  }

  // Magnificat
  blocks.push(titleBlock('Ad Magnificat'));
  const magAntLa = normalizeLatinText((la['Ant 3'] || []).filter((l) => l.trim() && !l.startsWith('!')).join(' ').trim());
  const magAntEn = (en['Ant 3'] || []).filter((l) => l.trim() && !l.startsWith('!')).join(' ').trim();
  const magChant = findChant(magAntLa.replace(/\s*\*\s*/, ' '), ['an']);
  if (magChant) {
    const tone = toneFor(magChant.mode, magChant.mode_var);
    report.push(`Magnificat ant "${magAntLa.split('*')[0].trim()}": GregoBase #${magChant.id} (mode ${magChant.mode}${magChant.mode_var || ''}) -> tone ${tone ? tone.label : 'NONE'}`);
    const ant = antiphonGabc(magChant, { annotationNum: 'Magn.', translation: magAntEn });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc: ant.gabc, chantTranslation: ant.translation, ...chantStyle, chantUseDropCap: true });
    const mag = loadCanticle('Magnificat');
    if (mag && tone) {
      const verses = mag.split('\n').filter(Boolean);
      blocks.push({ id: bid(), type: 'chant_gabc', gabc: firstVerseGabc(verses[0], tone, 'Magnificat'), chantTranslation: '', ...psalmChantStyle, chantUseDropCap: false });
      const items = verses.slice(1).map((v, vi) => `<li>${verseHtml(v, tone, vi + 2)}</li>`).join('');
      blocks.push({ ...clone(skeleton.psalmVerseStyle), text: `<ol start="2">${items}</ol>`, translation: '', sectionTitle: '', sectionSourceRef: 'Luc 1:46-55' });
    }
    const antRep = antiphonGabc(magChant, { annotationNum: 'Magn.', repeat: true });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc: antRep.gabc, chantTranslation: '', ...chantStyle, chantUseDropCap: false });
  }

  // Collect
  blocks.push(titleBlock('Oratio'));
  blocks.push(clone(skeleton.rubricStand));
  const orLa = sectionText(la.Oratio);
  const orEn = sectionText(en.Oratio, 'en');
  if (orLa) {
    blocks.push({ ...clone(skeleton.psalmVerseStyle), text: `<div style="text-align:justify">${escHtml(orLa)} Per eúndem Dóminum nostrum Iesum Christum Fílium tuum, qui tecum vivit et regnat in unitáte Spíritus Sancti, Deus, per ómnia sǽcula sæculórum. <b>R.</b> Amen.</div>`, translation: orEn ? `<div style="text-align:justify">${escHtml(orEn)}</div>` : '', sectionTitle: '', sectionSourceRef: '' });
  }

  // Conclusion, straight from the hand-made booklet
  blocks.push(titleBlock('Conclusio'));
  blocks.push(clone(skeleton.domVobiscum));
  blocks.push(clone(skeleton.benedicamus));
  blocks.push(clone(skeleton.rubricLowVoice));
  blocks.push(clone(skeleton.fidelium));

  const project = {
    schemaVersion: 8,
    projectTitle: 'Immaculate Conception — Second Vespers',
    settings: { ...skeleton.settings },
    blocks,
  };

  console.log('--- Match report ---');
  report.forEach((r) => console.log(r));
  console.log(`--- ${blocks.length} blocks total ---`);

  if (DRY) {
    fs.writeFileSync(path.join(ROOT, 'poc-vespers-output.json'), JSON.stringify(project, null, 2));
    console.log('[dry] wrote poc-vespers-output.json');
    return;
  }

  await pool.query(`DELETE FROM booklet_templates WHERE feast_key = 'Dec8_vespers2' AND official = true`);
  await pool.query(`
    INSERT INTO booklet_templates (name, description, season, feast_key, official, owner_name, project, office_type, feast_month, feast_day, published)
    VALUES ($1, $2, 'Sanctorale', 'Dec8_vespers2', true, '', $3, 'office', 12, 8, false)
  `, ['Immaculate Conception — Second Vespers (PoC)',
    'Proof of concept: antiphons from GregoBase, pointed psalms via jgabc psalm tones, texts from Divinum Officium.',
    JSON.stringify(project)]);
  console.log('Seeded as draft template "Immaculate Conception — Second Vespers (PoC)"');
  await pool.end();
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
