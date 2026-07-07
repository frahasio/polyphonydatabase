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
import { normalizeGabcLyrics } from './latinNormalize.js';

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
  return fs.existsSync(p) ? normalizeGabcLyrics(readText(p)) : null;
}

// Sung gospel dialogue (recitation with two-note cadence), modelled on the
// hand-made booklet; evangelist snippets carry the cadence themselves.
const EVANGELIST_GABC = {
  matthaeum: 'Mat(h)thǽ(g.)um.(g.)',
  marcum: 'Mar(g.)cum.(g.)',
  lucam: 'Lu(g.)cam.(g.)',
  ioannem: 'Jo(h)án(g.)nem.(g.)',
};
const EVANGELIST_EN = { matthaeum: 'Matthew', marcum: 'Mark', lucam: 'Luke', ioannem: 'John' };

function evangelistKey(name) {
  const k = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^j/, 'i');
  return Object.keys(EVANGELIST_GABC).find((e) => k.startsWith(e.slice(0, 4))) || null;
}

function gospelDialogueChant(bid, intro) {
  const key = evangelistKey(intro.evangelist);
  if (!key) return null;
  const isInitium = intro.type === 'initium';
  const introGabc = isInitium
    ? 'I(h)ní(h)ti(h)um(h) san(h)cti(f) E(h)van(g)gé(g)li(h)i(h.)'
    : 'Se(h)quén(h)ti(h)a(h) san(h)cti(f) E(h)van(g)gé(g)li(h)i(h.)';
  const gabc = [
    'office-part: R;',
    'name: Gospel dialogue;',
    '%%',
    '(c4)<sp>V/</sp>. Dó(g)mi(h)nus(h) vo(gh)bí(hg)scum.(g.) (::)',
    '<sp>R/</sp>. Et(g) cum(h) spí(h)ri(g)tu(g) tu(h)o.(h.) (::)',
    `<sp>V/</sp>. ${introGabc} (,) se(h)cún(h)dum(h) ${EVANGELIST_GABC[key]} (::)`,
    '<sp>R/</sp>. Gló(h)ri(h)a(h) ti(h)bi(h) Dó(g)mi(g)ne.(g.) (::)',
  ].join('\n');
  const translation = [
    '\\V. The Lord be with you.//\\R. And with thy spirit.',
    `\\V. ${isInitium ? 'The beginning' : 'A continuation'} of the Holy Gospel according to ${EVANGELIST_EN[key]}.//\\R. Glory be to thee, O Lord.`,
  ].join('\n');
  return chantBlock(bid, gabc, { chantTranslation: translation, chantUseDropCap: false });
}

// Traditional English translations for the builder-inserted chants, with
// phrase-per-line breaks so the translation column reads consistently.
const ORDINARY_TRANSLATIONS = {
  kyrie: 'Lord, have mercy.\nChrist, have mercy.\nLord, have mercy.',
  gloria: [
    'Glory be to God on high, and on earth peace to men of good will.',
    'We praise thee, we bless thee,//we adore thee, we glorify thee.',
    'We give thee thanks for thy great glory.',
    'O Lord God, heavenly King,//God the Father almighty.',
    'O Lord Jesus Christ, the only-begotten Son.',
    'O Lord God, Lamb of God, Son of the Father.',
    'Who takest away the sins of the world,//have mercy upon us.',
    'Who takest away the sins of the world,//receive our prayer.',
    'Who sittest at the right hand of the Father,//have mercy upon us.',
    'For thou only art holy, thou only art the Lord,//thou only, O Jesus Christ, art most high.',
    'With the Holy Ghost, in the glory of God the Father. Amen.',
  ].join('\n'),
  sanctus: [
    'Holy, holy, holy, Lord God of hosts.',
    'Heaven and earth are full of thy glory.//Hosanna in the highest.',
    'Blessed is he that cometh in the name of the Lord.//Hosanna in the highest.',
  ].join('\n'),
  agnus: [
    'Lamb of God, who takest away the sins of the world,//have mercy upon us.',
    'Lamb of God, who takest away the sins of the world,//have mercy upon us.',
    'Lamb of God, who takest away the sins of the world,//grant us peace.',
  ].join('\n'),
  ite: 'V. Go, the Mass is ended.//R. Thanks be to God.',
  benedicamus: 'V. Let us bless the Lord.//R. Thanks be to God.',
};

const CREDO_TRANSLATION = [
  'I believe in one God, the Father almighty,//maker of heaven and earth,//and of all things visible and invisible.',
  'And in one Lord Jesus Christ, the only-begotten Son of God,//born of the Father before all ages.',
  'God of God, light of light, true God of true God.',
  'Begotten, not made, consubstantial with the Father://by whom all things were made.',
  'Who for us men, and for our salvation,//came down from heaven.',
  'And was incarnate by the Holy Ghost of the Virgin Mary://and was made man.',
  'He was crucified also for us,//suffered under Pontius Pilate, and was buried.',
  'And the third day he rose again//according to the Scriptures.',
  'And ascended into heaven,//and sitteth at the right hand of the Father.',
  'And he shall come again with glory//to judge both the living and the dead://of whose kingdom there shall be no end.',
  'And in the Holy Ghost, the Lord and giver of life,//who proceedeth from the Father and the Son.',
  'Who together with the Father and the Son//is adored and glorified://who spoke by the prophets.',
  'And in one, holy, catholic and apostolic Church.',
  'I confess one baptism//for the remission of sins.',
  'And I look for the resurrection of the dead,//and the life of the world to come. Amen.',
].join('\n');

const MARIAN_TRANSLATIONS = {
  salve: [
    'Hail, holy Queen, Mother of mercy,//our life, our sweetness and our hope.',
    'To thee do we cry,//poor banished children of Eve.',
    'To thee do we send up our sighs,//mourning and weeping in this vale of tears.',
    'Turn then, most gracious advocate,//thine eyes of mercy toward us.',
    'And after this our exile show unto us//the blessed fruit of thy womb, Jesus.',
    'O clement, O loving,//O sweet Virgin Mary.',
  ].join('\n'),
  alma: [
    'Loving Mother of the Redeemer,//gate of heaven, star of the sea,',
    'assist thy people who have fallen//yet strive to rise again.',
    'Thou who broughtest forth thy holy Creator,//all creation wondering,',
    'yet remainest ever Virgin,//taking from Gabriel\u2019s lips that joyful \u201cHail!\u201d:',
    'be merciful to us sinners.',
  ].join('\n'),
  ave_regina: [
    'Hail, Queen of heaven;//hail, Mistress of the Angels.',
    'Hail, root of Jesse; hail, the gate//through which the Light rose over the earth.',
    'Rejoice, Virgin most renowned//and of unsurpassed beauty.',
    'Farewell, most beautiful maiden,//and pray for us to Christ.',
  ].join('\n'),
  regina_caeli: [
    'Queen of heaven, rejoice, alleluia.',
    'For he whom thou didst merit to bear, alleluia,',
    'hath risen as he said, alleluia.',
    'Pray for us to God, alleluia.',
  ].join('\n'),
};

// ---- assembly --------------------------------------------------------------

function chantBlock(bid, gabc, overrides = {}) {
  return { id: bid(), type: 'chant_gabc', gabc, chantTranslation: '', ...HOUSE_CHANT_STYLE, ...overrides };
}

function titleBlock(bid, text, sizePt = 12) {
  return { id: bid(), type: 'title', text, ...HOUSE_TITLE_STYLE, titleFontSizePt: sizePt };
}

export function defaultBuildOptions() {
  return { framework: true, kyriale: 8, credo: 'auto', readings: 'both', marian: 'salve_simple', size: 'A5' };
}

// ---- per-size tuning, extracted from the hand-curated 8th Sunday pair -----

// Page-layout settings per size (A5 matches the seeded house settings).
const SIZE_SETTINGS = {
  A5: { pageSize: 'A5', marginTopMm: 10, marginBottomMm: 6, marginLeftMm: 10, marginRightMm: 10, sectionGapMm: 5, gapTolerancePx: 8, marginTolerancePx: 8 },
  A4: { pageSize: 'A4', marginTopMm: 14, marginBottomMm: 6, marginLeftMm: 14, marginRightMm: 14, sectionGapMm: 6, gapTolerancePx: 2, marginTolerancePx: 6 },
};

// Horizontal spacing per framework chant per size (hand-tuned values).
const FRAMEWORK_HS = {
  domVobiscum: { A5: 1.1, A4: 1.75 },
  domVobPostcomm: { A5: 1.1, A4: 1.5 },
  domVobIte: { A5: 1.1, A4: 1.7 },
  perOmniaOremus: { A5: 1.35, A4: 1.65 },
  perOmniaSecret: { A5: 1.45, A4: 1.6 },
  perOmniaCanon: { A5: 1.45, A4: 1.65 },
  perOmniaPax: { A5: 1.45, A4: 1.7 },
  perOmniaPostcomm: { A5: 1.35, A4: 1.55 },
  prefaceChant: { A5: 1.3, A4: 1.6 },
  paterChant: { A5: 1.6, A4: 1.65 },
  paxChant: { A5: 1.3, A4: 1.6 },
  iteChant: { A5: 1.6, A4: 1.55 },
};
const GOSPEL_DIALOGUE_HS = { A5: 1.55, A4: 1.5 };
const CREDO_I_HS = { A5: 1.75, A4: 1.6 };
const SALVE_SIMPLE_HS = { A5: 1.8, A4: 1.95 };

// Preface dialogue translation: the last versicle breaks differently.
const PREFACE_TR = {
  A5: '\\V. The Lord be with you.//\\R. And with your spirit.\n\\V. Lift up your hearts.//\\R. We lift them up to the Lord.\n\\V. Let us give thanks to the Lord//our God. \\R. It is right and just.',
  A4: '\\V. The Lord be with you.//\\R. And with your spirit.\n\\V. Lift up your hearts.//\\R. We lift them up to the Lord.\n\\V. Let us give thanks to the Lord our God.//\\R. It is right and just.',
};

// Credo I translation exactly as hand-broken for each size.
const CREDO_I_TR = {
  A5: 'I believe in one God,//the Father almighty,\nmaker of heaven and earth,\nof all things//visible and invisible.\nAnd in one Lord,//Jesus Christ,\nthe only begotten//Son of God,\nborn of the Father//before all ages.\nGod from God,//Light from Light,\ntrue God from true God,//begotten, not made,\none in being//with the Father;\nthrough Whom//all things were made.\nWho for us men//and for our salvation\ncame down from heaven.//And he was made flesh\nby the Holy Spirit//from the Virgin Mary,\nand was made man.//He was crucified for us\nunder Pontius Pilate;//suffered, and was buried.\nOn the third day//He rose again\naccording//to the Scriptures;\nHe ascended into heaven\nand sits at the right//hand of the Father.\nAnd He will come again//in glory\nto judge the living//and the dead,\nand of His kingdom//there shall be no end.\nAnd in the Holy Spirit,//the Lord and giver of Life,\nWho proceeds from//the Father and the Son.\nWho, with the Father//and the Son,//is adored and glorified:\nWho has spoken//through the Prophets.\nAnd in one holy, catholic//and apostolic Church.\nI confess one baptism//for the remission of sins.\nAnd I look for the//resurrection of the dead,\nand the life//of the age to come.\nAmen.',
  A4: 'I believe in one God,//the Father almighty,\nmaker of heaven and earth,//of all things visible and invisible.\nAnd in one Lord, Jesus Christ, the only begotten Son of God,\nborn of the Father before all ages.//God from God, Light from Light,\ntrue God from true God,//begotten, not made,\none in being with the Father;//through Whom all things were made.\nWho for us men and for our//salvation came down from heaven.\nAnd he was made flesh by the Holy Spirit from the Virgin Mary,//and was made man.\nHe was crucified for us//under Pontius Pilate;//suffered, and was buried.\nOn the third day He rose again according to the Scriptures;\nHe ascended into heaven and sits//at the right hand of the Father.\nAnd He will come again in glory//to judge the living and the dead,\nand of His kingdom//there shall be no end.\nAnd in the Holy Spirit,//the Lord and giver of Life,\nWho proceeds from//the Father and the Son.\nWho, with the Father and the Son,//is adored and glorified:\nWho has spoken//through the Prophets.\nAnd in one holy, catholic//and apostolic Church.\nI confess one baptism//for the remission of sins.\nAnd I look for//the resurrection of the dead,\nand the life of the age to come.//Amen.',
};

// Salve Regina (simple tone) translation per size, as hand-broken.
const SALVE_SIMPLE_TR = {
  A5: 'Hail, holy Queen,//Mother of mercy,\nour life, our sweetness//and our hope.\nTo thee do we cry, poor//banished children of Eve.\nTo thee do we//send up our sighs,\nmourning and weeping//in this vale of tears.\nTurn then,//most gracious advocate,\nthine eyes of mercy//toward us.\nAnd after this our exile show unto us\nthe blessed fruit//of thy womb, Jesus.\nO clement, O loving,//O sweet Virgin Mary.',
  A4: 'Hail, holy Queen, Mother of mercy,//our life, our sweetness and our hope.\nTo thee do we cry,//poor banished children of Eve.\nTo thee do we send up our sighs,\nmourning and weeping//in this vale of tears.\nTurn then, most gracious advocate,//thine eyes of mercy toward us.\nAnd after this our exile show unto us//the blessed fruit of thy womb, Jesus.\nO clement, O loving,//O sweet Virgin Mary.',
};

// Character budgets measured from the curated pair.
const REFLOW = {
  A5: { maxLine: 46, breakOver: 28 },
  A4: { maxLine: 56, breakOver: 36 },
};

/**
 * Best break position near the middle of a line (within the middle 40%):
 * prefer after punctuation, else the nearest space.
 */
function midBreak(line) {
  const mid = line.length / 2;
  const lo = line.length * 0.3;
  const hi = line.length * 0.7;
  let best = -1;
  let bestDist = Infinity;
  const re = /[,;:]\s|\s/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const pos = m.index + m[0].length;
    if (pos < lo || pos > hi) continue;
    const isPunct = /[,;:]/.test(m[0][0]);
    const dist = Math.abs(pos - mid) - (isPunct ? 4 : 0); // prefer punctuation
    if (dist < bestDist) { bestDist = dist; best = pos; }
  }
  return best;
}

/**
 * Re-break a chant translation for the target size: existing // marks are
 * discarded, hard newlines kept, long lines wrapped to the size budget and
 * given a // break near the middle (at punctuation when possible).
 */
export function reflowTranslation(text, size) {
  if (!text) return text;
  const b = REFLOW[size] || REFLOW.A5;
  return String(text).split('\n').map((hard) => {
    const flat = hard.replace(/\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) return '';
    // Balanced wrap: aim for equal-width lines rather than a full first line
    // with an orphan word at the end.
    const lineCount = Math.max(1, Math.ceil(flat.length / b.maxLine));
    const target = Math.ceil(flat.length / lineCount);
    const lines = [];
    let rest = flat;
    while (lines.length < lineCount - 1 && rest.length > target) {
      let cut = rest.lastIndexOf(' ', Math.min(target + 6, b.maxLine));
      if (cut <= 0) cut = rest.indexOf(' ');
      if (cut <= 0) break;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
    lines.push(rest);
    return lines.map((line) => {
      if (line.length <= b.breakOver) return line;
      const pos = midBreak(line);
      return pos > 0 ? line.slice(0, pos).trimEnd() + '//' + line.slice(pos).trimStart() : line;
    }).join('\n');
  }).join('\n');
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
  const size = opts.size === 'A4' ? 'A4' : 'A5';
  // Framework chant with hand-tuned per-size spacing (and preface breaks).
  const fwChant = (name, overrides = {}) => {
    const o = { ...overrides };
    if (FRAMEWORK_HS[name]) o.chantHorizSpacing = FRAMEWORK_HS[name][size];
    if (name === 'prefaceChant') o.chantTranslation = PREFACE_TR[size];
    return clone(sk[name], o);
  };

  const kyrialeIdx = opts.kyriale === 'none' ? null : parseInt(opts.kyriale, 10);
  const mass = kyrialeIdx >= 1 && kyrialeIdx <= 16 ? ordinaryData().masses[kyrialeIdx - 1] : null;
  const kyChant = (part) => {
    if (!mass || !mass[part]) return null;
    const def = Array.isArray(mass[part]) ? mass[part][0] : mass[part];
    const gabc = gabcById(def.id);
    return gabc ? chantBlock(bid, gabc, { chantTranslation: reflowTranslation(ORDINARY_TRANSLATIONS[part] || '', size) }) : null;
  };

  let credoBlock = null;
  if (opts.credo !== 'none') {
    const wantCredo = opts.credo === 'auto' ? meta.credo !== false : true;
    if (wantCredo) {
      const id = opts.credo === 'auto' ? 'I' : String(opts.credo);
      const def = ordinaryData().adLib.credo.find((c) => c.name === `Credo ${id}`) || ordinaryData().adLib.credo[0];
      const gabc = def && gabcById(def.id);
      if (gabc) {
        credoBlock = def.name === 'Credo I'
          ? chantBlock(bid, gabc, { chantTranslation: CREDO_I_TR[size], chantHorizSpacing: CREDO_I_HS[size] })
          : chantBlock(bid, gabc, { chantTranslation: reflowTranslation(CREDO_TRANSLATION, size) });
      }
    }
  }

  let marianBlock = null;
  if (opts.marian && opts.marian !== 'none') {
    const def = marianOptions().find((m) => m.id === opts.marian);
    if (def) {
      const gabc = normalizeGabcLyrics(readText(path.join(JGABC, 'gabc', def.file)));
      const baseId = def.id.replace(/_simple$/, '');
      marianBlock = def.id === 'salve_simple'
        ? chantBlock(bid, gabc, { chantTranslation: SALVE_SIMPLE_TR[size], chantHorizSpacing: SALVE_SIMPLE_HS[size] })
        : chantBlock(bid, gabc, { chantTranslation: reflowTranslation(MARIAN_TRANSLATIONS[baseId] || '', size) });
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
  // Where a polyphonic/spoken ordinary part will go: a "Missa <setting>"
  // note when a setting name was given, else a plain placeholder heading.
  const settingName = String(opts.settingName || '').trim().slice(0, 120);
  const settingNote = () => clone(sk.settingNote, {
    text: `<div style="text-align:justify">Missa ${settingName || '—'}</div>`,
    translation: '',
  });
  const placeholder = (label) => (settingName ? null : titleBlock(bid, label));
  const noKyriale = !mass;

  push(...grp('head'));
  if (fw) push(clone(sk.rubricStandBell));

  push(...grp('introit'));
  if (noKyriale && settingName) {
    // One note covers Kyrie + Gloria, as in the hand-made booklets.
    push(settingNote());
  } else {
    push(kyChant('kyrie') || (noKyriale ? placeholder('Kyrie') : null));
    if (meta.gloria !== false) push(kyChant('gloria') || (noKyriale ? placeholder('Gloria') : null));
  }

  const collect = grp('collect');
  if (collect.length) {
    push(...collect.filter((b) => b.type === 'title'));
    if (fw) push(fwChant('domVobiscum'));
    push(...collect.filter((b) => b.type !== 'title'));
    if (fw) push(fwChant('perOmniaOremus'));
  }

  const lesson = grp('lesson');
  if (lesson.length) {
    push(...lesson.filter((b) => b.type === 'title'));
    if (fw) push(clone(sk.rubricSit));
    push(...lesson.filter((b) => b.type !== 'title').map(transformReading));
  }

  push(...grp('between'));

  const gospel = grp('gospel');
  const gospelIntro = grp('gospel_intro');
  if (gospel.length) {
    push(...gospel.filter((b) => b.type === 'title'));
    if (fw) push(clone(sk.rubricStand));
    if (fw && meta.gospelIntro && meta.gospelIntro.evangelist) {
      // Sung dialogue replaces the spoken introduction text.
      const dlg = gospelDialogueChant(bid, meta.gospelIntro);
      if (dlg) dlg.chantHorizSpacing = GOSPEL_DIALOGUE_HS[size];
      push(dlg || gospelIntro.map(transformReading)[0]);
    } else {
      push(...gospelIntro.map(transformReading));
    }
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
  } else if (opts.credo === 'none' && meta.credo !== false) {
    push(titleBlock(bid, 'Credo'));
  }

  const offertory = grp('offertory');
  push(...offertory.filter((b) => b.type === 'title'));
  if (fw) push(clone(sk.rubricSitOffertory));
  push(...offertory.filter((b) => b.type !== 'title'));

  const secret = grp('secret');
  if (secret.length) {
    push(...secret);
    if (fw) push(fwChant('perOmniaSecret'));
  }

  if (fw) {
    push(titleBlock(bid, 'Preface'));
    push(clone(sk.rubricStandPreface));
    push(fwChant('prefaceChant'));
    push(clone(sk.prefaceText));
  }
  push(kyChant('sanctus') || (noKyriale ? (settingName ? settingNote() : placeholder('Sanctus')) : null));
  if (fw) {
    push(clone(sk.rubricKneel));
    push(titleBlock(bid, 'Canon'));
    push(fwChant('perOmniaCanon'));
    push(titleBlock(bid, 'Pater noster'));
    push(clone(sk.rubricStandPater));
    push(clone(sk.paterIntro));
    push(fwChant('paterChant'));
    push(clone(sk.liberaNos));
    push(fwChant('perOmniaPax'));
    push(fwChant('paxChant'));
  }

  const communion = grp('communion');
  // Agnus follows the "All kneel" rubric, as in the hand-made booklets.
  if (fw) push(clone(sk.rubricKneelCommunion));
  push(kyChant('agnus') || (noKyriale ? (settingName ? settingNote() : placeholder('Agnus Dei')) : null));
  if (fw) {
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
      push(fwChant('domVobPostcomm'));
    }
    push(...postcomm.filter((b) => b.type !== 'title'));
    if (fw) push(fwChant('perOmniaPostcomm'));
  }

  if (fw || mass) {
    push(titleBlock(bid, 'Conclusion'));
    if (fw) push(fwChant('domVobIte'));
    push(kyChant('ite') || (fw ? fwChant('iteChant') : null));
  }
  if (fw) push(clone(sk.lastGospel));
  if (marianBlock) {
    push(marianBlock);
  }

  // Day propers keep their slot tags; re-break their translations for the
  // target size (character budgets measured from the curated booklets).
  for (const b of out) {
    if (b.type === 'chant_gabc' && b.tplSlot && b.chantTranslation) {
      b.chantTranslation = reflowTranslation(b.chantTranslation, size);
    }
  }

  return {
    schemaVersion: core.schemaVersion || 8,
    projectTitle: core.projectTitle,
    settings: { ...core.settings, ...SIZE_SETTINGS[size] },
    blocks: out,
  };
}
