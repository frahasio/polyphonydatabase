/**
 * Mix-and-match Mass booklet builder.
 *
 * Official generated templates store only a slot-tagged "propers core"
 * (chants + day texts, each block carrying tplSlot). This service assembles
 * a full booklet from a core at load time according to user options:
 *
 *   framework  true/false     sung dialogues, preface, canon, Pater noster,
 *                             communion devotions, last Gospel (blocks cloned
 *                             from the hand-made 7th-Sunday booklet)
 *   kyriale    'none' | 1..16 Kyrie/Gloria/Sanctus/Agnus/Ite of a Kyriale Mass
 *   credo      'none'|'auto'|'I'..'VII' (auto: only when the day calls for it)
 *   readings   'both' | 'latin' | 'english' | 'ref'
 *   marian     'none' | key from marianOptions()
 *
 * Gloria is included only when the day's rule allows it (core.meta.gloria).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JGABC = path.join(ROOT, 'public', 'vendor', 'jgabc');
const SKELETON_PATH = path.join(ROOT, 'templates-incoming', '7th-Sunday-after-Pentecost.json');

function readText(p) {
  const buf = fs.readFileSync(p);
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

// ---- house styles (kept in sync with scripts/generate-booklet-templates.js)

export const HOUSE_CHANT_STYLE = {
  chantNeumeSize: 23,
  chantGlyphScale: 1,
  chantStaffColor: '',
  chantHorizSpacing: 1.7,
  chantVertSpacing: 1.4,
  chantDropCapScale: 1,
  chantUseDropCap: true,
  chantLyricLanguage: 'latin',
  chantTextFont: 'crimson',
  chantRubricColor: '',
  chantAnnotationSizeAdj: 0,
  chantAnnotationYAdj: 0,
  chantTranslationLeftPct: 70,
  chantTranslationGapMm: 4,
  chantTranslationBorder: false,
  chantTranslationFontSizePt: 10,
  chantTranslationVAlign: 'middle',
  chantTranslationTextAlign: 'right',
  chantLineGap: 1,
  sectionGapAfterMm: 8,
};

export const HOUSE_TITLE_STYLE = {
  titleFontKey: '',
  titleTextColor: '#212529',
  titleLineColor: '#adb5bd',
  titleBold: false,
  titleItalic: false,
  titleSmallCaps: true,
  sectionGapAfterMm: 8,
};

// ---- ordinary skeleton (hand-made booklet) --------------------------------

const SKELETON_PARTS = {
  rubricStandBell: [4, 'rubric'],
  settingNote: [6, 'reading'],
  domVobiscum: [8, 'chant_gabc'],
  perOmniaOremus: [10, 'chant_gabc'],
  rubricSit: [12, 'rubric'],
  rubricStand: [18, 'rubric'],
  rubricSitHomily: [22, 'rubric'],
  rubricStandCredo: [24, 'rubric'],
  rubricSitOffertory: [27, 'rubric'],
  perOmniaSecret: [32, 'chant_gabc'],
  rubricStandPreface: [34, 'rubric'],
  prefaceChant: [35, 'chant_gabc'],
  prefaceText: [36, 'reading'],
  rubricKneel: [37, 'rubric'],
  perOmniaCanon: [41, 'chant_gabc'],
  rubricStandPater: [43, 'rubric'],
  paterIntro: [44, 'reading'],
  paterChant: [45, 'chant_gabc'],
  liberaNos: [46, 'reading'],
  perOmniaPax: [47, 'chant_gabc'],
  paxChant: [48, 'chant_gabc'],
  rubricKneelCommunion: [50, 'rubric'],
  panemCaelestem: [53, 'reading'],
  rubricBreast: [54, 'rubric'],
  domineNonSum: [55, 'reading'],
  rubricStandPostcomm: [59, 'rubric'],
  domVobPostcomm: [60, 'chant_gabc'],
  perOmniaPostcomm: [62, 'chant_gabc'],
  domVobIte: [65, 'chant_gabc'],
  iteChant: [66, 'chant_gabc'],
  lastGospel: [68, 'reading'],
};

let _skeleton = null;
function skeleton() {
  if (_skeleton) return _skeleton;
  const doc = JSON.parse(readText(SKELETON_PATH));
  const parts = {};
  for (const [name, [idx, type]] of Object.entries(SKELETON_PARTS)) {
    const b = doc.blocks[idx];
    if (!b || b.type !== type) throw new Error(`Mass skeleton mismatch at ${idx} (${name})`);
    parts[name] = b;
  }
  _skeleton = parts;
  return parts;
}

// ---- Kyriale / credo / Marian antiphon data -------------------------------

let _ordinary = null;
function ordinaryData() {
  if (_ordinary) return _ordinary;
  const src = readText(path.join(JGABC, 'ordinarydata.js'));
  const grab = (name) => {
    const start = src.indexOf(`var ${name} = `);
    if (start < 0) throw new Error(`${name} not found in ordinarydata.js`);
    let end = src.indexOf('};', start);
    const endArr = src.indexOf('];', start);
    if (endArr >= 0 && (end < 0 || endArr < end)) end = endArr;
    return new Function(`return ${src.slice(start + `var ${name} = `.length, end + 1)};`)();
  };
  _ordinary = { masses: grab('massOrdinary'), adLib: grab('ordinaryAdLib') };
  return _ordinary;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII'];

export function kyrialeOptions() {
  return ordinaryData().masses.map((m, i) => {
    const numbered = i < ROMAN.length ? `Mass ${ROMAN[i]}` : '';
    let label = [numbered, m.name].filter(Boolean).join(' — ');
    if (label && m.season) label += ` (${m.season})`;
    if (!label) label = m.season || `Mass ${i + 1}`;
    return { id: i + 1, label };
  });
}

export function credoOptions() {
  return ordinaryData().adLib.credo.map((c) => ({ id: c.name.replace(/^Credo\s+/, ''), label: c.name }));
}

// Marian antiphons found in the vendored gabc set, keyed for the UI.
const MARIAN_DEFS = [
  ['alma', /^Alma Redemptoris$/i],
  ['alma_simple', /^Alma Redemptoris \(simple tone\)$/i],
  ['ave_regina', /^Ave Regina c[æa]e?lorum$/i],
  ['ave_regina_simple', /^Ave Regina c[æa]e?lorum \(simple tone\)$/i],
  ['regina_caeli', /^Regina c[æo]e?li( l[æa]etare)?$/i],
  ['regina_caeli_simple', /^Regina c[æo]e?li.*simple/i],
  ['salve', /^Salve Regina$/i],
  ['salve_simple', /^Salve Regina \(simple tone\)$/i],
];

let _marian = null;
export function marianOptions() {
  if (_marian) return _marian;
  const dir = path.join(JGABC, 'gabc');
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.gabc')) continue;
    const head = readText(path.join(dir, f)).slice(0, 200);
    const m = head.match(/^name:\s*([^;]+);/mi);
    if (!m) continue;
    for (const [key, re] of MARIAN_DEFS) {
      if (re.test(m[1].trim())) found.push({ id: key, label: m[1].trim(), file: f });
    }
  }
  const order = MARIAN_DEFS.map(([k]) => k);
  found.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  _marian = found;
  return _marian;
}

function gabcById(id) {
  const p = path.join(JGABC, 'gabc', `${id}.gabc`);
  return fs.existsSync(p) ? readText(p) : null;
}

// ---- assembly --------------------------------------------------------------

function chantBlock(bid, gabc, overrides = {}) {
  return { id: bid(), type: 'chant_gabc', gabc, chantTranslation: '', ...HOUSE_CHANT_STYLE, ...overrides };
}

function titleBlock(bid, text, sizePt = 12) {
  return { id: bid(), type: 'title', text, ...HOUSE_TITLE_STYLE, titleFontSizePt: sizePt };
}

export function defaultBuildOptions() {
  return { framework: true, kyriale: 8, credo: 'auto', readings: 'both', marian: 'salve' };
}

/**
 * Assemble a full Mass project from a slot-tagged propers core.
 * Unknown/absent slots degrade gracefully; a core without slot tags is
 * returned unchanged.
 */
export function buildFromCore(core, rawOptions = {}) {
  const opts = { ...defaultBuildOptions(), ...rawOptions };
  const blocks = core.blocks || [];
  if (!blocks.some((b) => b.tplSlot)) return core;

  const meta = core.meta || {};
  const sk = skeleton();
  let n = 0;
  const bid = () => `bld_${n++}`;
  const clone = (part, overrides = {}) => ({ ...JSON.parse(JSON.stringify(part)), id: bid(), ...overrides });
  const fw = !!opts.framework && opts.framework !== 'false' && opts.framework !== '0';

  const kyrialeIdx = opts.kyriale === 'none' ? null : parseInt(opts.kyriale, 10);
  const mass = kyrialeIdx >= 1 && kyrialeIdx <= 16 ? ordinaryData().masses[kyrialeIdx - 1] : null;
  const kyChant = (part) => {
    if (!mass || !mass[part]) return null;
    const def = Array.isArray(mass[part]) ? mass[part][0] : mass[part];
    const gabc = gabcById(def.id);
    return gabc ? chantBlock(bid, gabc) : null;
  };

  let credoBlock = null;
  if (opts.credo !== 'none') {
    const wantCredo = opts.credo === 'auto' ? meta.credo !== false : true;
    if (wantCredo) {
      const id = opts.credo === 'auto' ? 'III' : String(opts.credo);
      const def = ordinaryData().adLib.credo.find((c) => c.name === `Credo ${id}`) || ordinaryData().adLib.credo[2];
      const gabc = def && gabcById(def.id);
      if (gabc) credoBlock = chantBlock(bid, gabc);
    }
  }

  let marianBlock = null;
  if (opts.marian && opts.marian !== 'none') {
    const def = marianOptions().find((m) => m.id === opts.marian);
    if (def) {
      const gabc = readText(path.join(JGABC, 'gabc', def.file));
      marianBlock = chantBlock(bid, gabc);
    }
  }

  // Group core blocks by slot, preserving order within groups.
  const groups = {};
  for (const b of blocks) {
    const slot = b.tplSlot || 'head';
    (groups[slot] ||= []).push(b);
  }
  const grp = (slot) => groups[slot] || [];

  // Apply the readings option to lectionary reading blocks.
  const transformReading = (b) => {
    if (b.type !== 'reading') return b;
    const out = { ...b };
    if (opts.readings === 'latin') out.translation = '';
    else if (opts.readings === 'english') { out.text = out.translation || out.text; out.translation = ''; }
    else if (opts.readings === 'ref') {
      return {
        id: b.id, type: 'rubric',
        text: `<span style="font-variant:small-caps">Reading: ${b.sectionSourceRef || '(see missal)'}</span>`,
        rubricColor: '#c80000', bodyFontSizePt: 11, lineHeightPt: 16,
        titleFontSizePt: 11, sourceFontSizePt: 9, fontScale: 1, sectionGapAfterMm: 8,
      };
    }
    return out;
  };

  const out = [];
  const push = (...items) => { for (const it of items) if (it) out.push(it); };
  const pageBreak = () => ({ id: bid(), type: 'page_break' });

  push(...grp('head'));
  if (fw) push(clone(sk.rubricStandBell));

  push(...grp('introit'));
  push(kyChant('kyrie'));
  if (meta.gloria !== false) push(kyChant('gloria'));

  const collect = grp('collect');
  if (collect.length) {
    push(...collect.filter((b) => b.type === 'title'));
    if (fw) push(clone(sk.domVobiscum));
    push(...collect.filter((b) => b.type !== 'title'));
    if (fw) push(clone(sk.perOmniaOremus));
  }

  const lesson = grp('lesson');
  if (lesson.length) {
    push(...lesson.filter((b) => b.type === 'title'));
    if (fw) push(clone(sk.rubricSit));
    push(...lesson.filter((b) => b.type !== 'title').map(transformReading));
  }

  push(...grp('between'));

  const gospel = grp('gospel');
  if (gospel.length) {
    push(...gospel.filter((b) => b.type === 'title'));
    if (fw) push(clone(sk.rubricStand));
    push(...gospel.filter((b) => b.type !== 'title').map(transformReading));
  }

  if (fw) {
    push(titleBlock(bid, 'Homily'));
    push(clone(sk.rubricSitHomily));
  }
  if (credoBlock) {
    push(titleBlock(bid, 'Credo'));
    if (fw) push(clone(sk.rubricStandCredo));
    push(credoBlock);
  }

  const offertory = grp('offertory');
  push(...offertory.filter((b) => b.type === 'title'));
  if (fw) push(clone(sk.rubricSitOffertory));
  push(...offertory.filter((b) => b.type !== 'title'));

  const secret = grp('secret');
  if (secret.length) {
    push(...secret);
    if (fw) push(clone(sk.perOmniaSecret));
  }

  if (fw) {
    push(titleBlock(bid, 'Preface'));
    push(clone(sk.rubricStandPreface));
    push(clone(sk.prefaceChant));
    push(clone(sk.prefaceText));
  }
  push(kyChant('sanctus'));
  if (fw) {
    push(clone(sk.rubricKneel));
    push(pageBreak());
    push(titleBlock(bid, 'Canon'));
    push(clone(sk.perOmniaCanon));
    push(titleBlock(bid, 'Pater noster'));
    push(clone(sk.rubricStandPater));
    push(clone(sk.paterIntro));
    push(clone(sk.paterChant));
    push(clone(sk.liberaNos));
    push(clone(sk.perOmniaPax));
    push(clone(sk.paxChant));
  }
  push(kyChant('agnus'));
  if (fw) push(pageBreak());

  const communion = grp('communion');
  if (fw) {
    push(clone(sk.rubricKneelCommunion));
    push(...communion.filter((b) => b.type === 'title'));
    push(clone(sk.panemCaelestem));
    push(clone(sk.rubricBreast));
    push(clone(sk.domineNonSum));
    push(...communion.filter((b) => b.type !== 'title'));
  } else {
    push(...communion);
  }

  const postcomm = grp('postcommunion');
  if (postcomm.length) {
    push(...postcomm.filter((b) => b.type === 'title'));
    if (fw) {
      push(clone(sk.rubricStandPostcomm));
      push(clone(sk.domVobPostcomm));
    }
    push(...postcomm.filter((b) => b.type !== 'title'));
    if (fw) push(clone(sk.perOmniaPostcomm));
  }

  if (fw || mass) {
    push(pageBreak());
    push(titleBlock(bid, 'Conclusion'));
    if (fw) push(clone(sk.domVobIte));
    push(kyChant('ite') || (fw ? clone(sk.iteChant) : null));
  }
  if (fw) {
    push({ id: bid(), type: 'spacer' });
    push(clone(sk.lastGospel));
  }
  if (marianBlock) {
    push(pageBreak());
    push(marianBlock);
  }

  return {
    schemaVersion: core.schemaVersion || 8,
    projectTitle: core.projectTitle,
    settings: { ...core.settings },
    blocks: out,
  };
}
