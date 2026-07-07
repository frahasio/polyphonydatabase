/**
 * Seed the booklet template library with COMPLETE sung Masses:
 *
 *   - Ordinary skeleton (responses, Credo, preface, canon, Pater noster,
 *     communion devotions, last Gospel, Salve regina) cloned from the
 *     hand-made booklet templates-incoming/7th-Sunday-after-Pentecost.json
 *   - Day propers (GABC chants) from the vendored jgabc data
 *   - Day texts (collect, lesson, gospel, secret, postcommunion) plus
 *     English translations from the vendored Divinum Officium files
 *     (data/divinumofficium), which also fill the chant translation boxes
 *
 * Covers the temporale (sundayKeys), the sanctorale (saintKeys, with fixed
 * feast dates for the calendar), and the commons (mass_* keys mapped to DO
 * Commune files). Upserts official templates keyed by feast_key: re-runs
 * refresh rather than duplicate, and overwrite manual edits — re-run
 * deliberately.
 *
 * Usage: node scripts/generate-booklet-templates.js [--dry]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';
import { getMassSections, doPathForKey, COMMONS_DO } from './lib/do-texts.js';

const DRY = process.argv.includes('--dry');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JGABC = path.join(ROOT, 'public', 'vendor', 'jgabc');
const SKELETON_PATH = path.join(ROOT, 'templates-incoming', '7th-Sunday-after-Pentecost.json');

// Some vendored files are Latin-1; fall back when UTF-8 decoding mangles.
function readText(p) {
  const buf = fs.readFileSync(p);
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

function loadKeyList(name) {
  const src = readText(path.join(JGABC, 'propersdata.js'));
  const start = src.indexOf(`var ${name} = [`);
  const end = src.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error(`${name} not found in propersdata.js`);
  return new Function(`return ${src.slice(start + `var ${name} = `.length, end + 1)};`)();
}

// Proper slots: [label, [id field aliases]] in liturgical order.
const SLOTS = [
  ['Introit', ['introitusID', 'inID']],
  ['Gradual', ['gradualeID', 'grID']],
  ['Alleluia', ['alleluiaID', 'alID']],
  ['Alleluia (Paschal)', ['alPaschID']],
  ['Alleluia II', ['alExtraID']],
  ['Tract', ['tractusID', 'trID', 'trSeptID']],
  ['Sequence', ['sequentiaID', 'seqID']],
  ['Offertory', ['offertoriumID', 'ofID']],
  ['Communion', ['communioID', 'coID']],
];

const SEASONS = [
  [/^Adv/, 'Advent'],
  [/^(Nat|Dec|Jan1$|Jan5a$)/, 'Christmastide'],
  [/^Epi/, 'Epiphanytide'],
  [/^[765]a/, 'Pre-Lent'],
  [/^Quad/, 'Lent'],
  [/^(Pasc|Asc)/, 'Eastertide'],
  [/^(Pent|CorpusChristi|SCJ|ChristusRex|Emb)/, 'Pentecost & after'],
];

function seasonFor(key) {
  for (const [re, name] of SEASONS) if (re.test(key)) return name;
  return 'Other';
}

const HOUSE_SETTINGS = {
  pageSize: 'A5',
  marginMm: 16,
  marginTopMm: 14,
  marginBottomMm: 6,
  marginLeftMm: 10,
  marginRightMm: 10,
  sectionGapMm: 5,
  gapTolerancePx: 6,
  marginTolerancePx: 6,
  minOrphanLines: 3,
  descClipPx: 3,
  ascClipPx: 3,
  dropCapOffsetEm: 0.05,
  previewDisplay: 'scroll',
  fontFamilyKey: 'EB Garamond',
  rubricColor: '#8b1538',
};

// Propers style (from the hand-made Mass booklets): large initial drop caps
// and generous horizontal spacing, unlike dialogue/tone chants.
const HOUSE_CHANT_STYLE = {
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

const HOUSE_TITLE_STYLE = {
  titleFontKey: '',
  titleTextColor: '#212529',
  titleLineColor: '#adb5bd',
  titleBold: false,
  titleItalic: false,
  titleSmallCaps: true,
  sectionGapAfterMm: 8,
};

// ---- Ordinary skeleton, cloned from the hand-made booklet -----------------

/** Fingerprint checks so a reshuffled skeleton file fails loudly. */
const SKELETON_PARTS = {
  rubricStandBell: [4, 'rubric', /All stand/],
  settingNote: [6, 'reading', /Missa /],
  domVobiscum: [8, 'chant_gabc', /Dominus vobiscum/],
  perOmniaOremus: [10, 'chant_gabc', /Per omnia/],
  rubricSit: [12, 'rubric', /All sit/],
  prayerReadingStyle: [9, 'reading', /./],
  lessonReadingStyle: [13, 'reading', /./],
  rubricStand: [18, 'rubric', /All stand/],
  rubricSitHomily: [22, 'rubric', /All sit/],
  rubricStandCredo: [24, 'rubric', /All stand/],
  credoChant: [25, 'chant_gabc', /name:\s*I;/],
  rubricSitOffertory: [27, 'rubric', /All sit/],
  perOmniaSecret: [32, 'chant_gabc', /Per omnia/],
  rubricStandPreface: [34, 'rubric', /All stand/],
  prefaceChant: [35, 'chant_gabc', /Preface/],
  prefaceText: [36, 'reading', /Vere dignum/],
  rubricKneel: [37, 'rubric', /All kneel/],
  perOmniaCanon: [41, 'chant_gabc', /Per omnia/],
  rubricStandPater: [43, 'rubric', /All stand/],
  paterIntro: [44, 'reading', /Præcéptis/],
  paterChant: [45, 'chant_gabc', /Pater noster/],
  liberaNos: [46, 'reading', /Líbera nos/],
  perOmniaPax: [47, 'chant_gabc', /Per omnia/],
  paxChant: [48, 'chant_gabc', /Pax Domini/],
  rubricKneelCommunion: [50, 'rubric', /All kneel/],
  panemCaelestem: [53, 'reading', /Panem cæléstem/],
  rubricBreast: [54, 'rubric', /Three times/],
  domineNonSum: [55, 'reading', /non sum dignus/],
  rubricStandPostcomm: [59, 'rubric', /All stand/],
  domVobPostcomm: [60, 'chant_gabc', /Dominus vobiscum/],
  perOmniaPostcomm: [62, 'chant_gabc', /Per omnia/],
  domVobIte: [65, 'chant_gabc', /Dominus vobiscum/],
  iteChant: [66, 'chant_gabc', /name:\s*XI;/],
  lastGospel: [68, 'reading', /In princípio erat Verbum/],
  salveRegina: [70, 'chant_gabc', /Salve regina/i],
};

function loadSkeleton() {
  const doc = JSON.parse(readText(SKELETON_PATH));
  const parts = {};
  for (const [name, [idx, type, fingerprint]] of Object.entries(SKELETON_PARTS)) {
    const b = doc.blocks[idx];
    const haystack = `${b?.text || ''} ${b?.html || ''} ${b?.gabc || ''}`;
    if (!b || b.type !== type || !fingerprint.test(haystack)) {
      throw new Error(`Skeleton block mismatch at index ${idx} (${name}): got ${b?.type}`);
    }
    parts[name] = b;
  }
  return parts;
}

// ---- Block builders --------------------------------------------------------

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function textToHtml(text) {
  return `<div style="text-align:justify">${escHtml(text).replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')}</div>`;
}

function makeBuilder(key, skeleton) {
  let n = 0;
  const bid = () => `tpl_${key}_${n++}`;
  return {
    clone(partName, overrides = {}) {
      return { ...JSON.parse(JSON.stringify(skeleton[partName])), id: bid(), ...overrides };
    },
    title(text, sizePt = 12) {
      return { id: bid(), type: 'title', text, ...HOUSE_TITLE_STYLE, titleFontSizePt: sizePt };
    },
    reading(styleName, latin, english, sourceRef, skeleton2) {
      const base = JSON.parse(JSON.stringify(skeleton2[styleName]));
      return {
        ...base,
        id: bid(),
        text: textToHtml(latin),
        translation: english ? textToHtml(english) : '',
        sectionTitle: '',
        sectionSourceRef: sourceRef || '',
      };
    },
    chant(gabc, translation) {
      return { id: bid(), type: 'chant_gabc', gabc, chantTranslation: translation || '', ...HOUSE_CHANT_STYLE };
    },
    pageBreak() {
      return { id: bid(), type: 'page_break' };
    },
    spacer() {
      return { id: bid(), type: 'spacer' };
    },
  };
}

/** DO English section text -> chant translation box (plain text). */
function chantTranslationFrom(section) {
  return section && section.text ? section.text : '';
}

// Which DO section translates which proper slot label.
const SLOT_DO_SECTION = {
  Introit: 'Introitus',
  Gradual: 'Graduale',
  Alleluia: 'Graduale', // DO folds the alleluia into [Graduale]
  Tract: 'Tractus',
  Sequence: 'Sequentia',
  Offertory: 'Offertorium',
  Communion: 'Communio',
};

function loadProperChants(propers) {
  const found = [];
  for (const [label, aliases] of SLOTS) {
    const idField = aliases.find((f) => propers[f] != null);
    if (!idField) continue;
    const gabcPath = path.join(JGABC, 'gabc', `${propers[idField]}.gabc`);
    if (!fs.existsSync(gabcPath)) continue;
    const gabc = readText(gabcPath);
    const nameM = gabc.match(/^name:\s*([^;]+);/mi);
    found.push({ label, gabc, chantName: nameM ? nameM[1].trim() : '' });
  }
  return found;
}

/**
 * Build a complete sung Mass project.
 * @param dayTitle   e.g. '7th Sunday after Pentecost'
 * @param chants     from loadProperChants()
 * @param doLa/doEn  DO sections (may be null: readings are omitted)
 */
function buildFullMass(key, dayTitle, subtitle, chants, doLa, doEn, skeleton) {
  const b = makeBuilder(key, skeleton);
  const la = doLa || {};
  const en = doEn || {};
  const blocks = [];
  const chantBy = (label) => chants.find((c) => c.label === label);
  const translationFor = (label) => chantTranslationFrom(en[SLOT_DO_SECTION[label]]);

  blocks.push(b.title(dayTitle, 18));
  if (subtitle) blocks.push(b.clone('settingNote', { text: `<div style="text-align:justify">${escHtml(subtitle)}</div>`, translation: '' }));
  blocks.push(b.clone('rubricStandBell'));

  const introit = chantBy('Introit');
  if (introit) {
    blocks.push(b.title(`Introit${introit.chantName ? ' · ' + introit.chantName : ''}`));
    blocks.push(b.chant(introit.gabc, translationFor('Introit')));
  }
  blocks.push(b.clone('settingNote', { text: '<div style="text-align:justify">Missa —</div>', translation: '' }));

  blocks.push(b.title('Collect'));
  blocks.push(b.clone('domVobiscum'));
  if (la.Oratio) blocks.push(b.reading('prayerReadingStyle', la.Oratio.text, en.Oratio?.text, '', skeleton));
  blocks.push(b.clone('perOmniaOremus'));

  blocks.push(b.title('Lesson'));
  blocks.push(b.clone('rubricSit'));
  if (la.Lectio) blocks.push(b.reading('lessonReadingStyle', la.Lectio.text, en.Lectio?.text, la.Lectio.citation, skeleton));

  // Between the readings: gradual/alleluia/tract/sequence as available.
  const between = ['Gradual', 'Alleluia', 'Alleluia (Paschal)', 'Alleluia II', 'Tract', 'Sequence']
    .map(chantBy).filter(Boolean);
  if (between.length) {
    blocks.push(b.title(between.map((c) => c.label.replace(/ \(.*/, '')).filter((v, i, a) => a.indexOf(v) === i).join(' & ')));
    for (const c of between) blocks.push(b.chant(c.gabc, translationFor(c.label)));
  }

  blocks.push(b.title('Gospel'));
  blocks.push(b.clone('rubricStand'));
  if (la.Evangelium) blocks.push(b.reading('lessonReadingStyle', la.Evangelium.text, en.Evangelium?.text, la.Evangelium.citation, skeleton));

  blocks.push(b.title('Homily'));
  blocks.push(b.clone('rubricSitHomily'));

  blocks.push(b.title('Credo'));
  blocks.push(b.clone('rubricStandCredo'));
  blocks.push(b.clone('credoChant'));

  const offertory = chantBy('Offertory');
  blocks.push(b.title(`Offertory${offertory?.chantName ? ' · ' + offertory.chantName : ''}`));
  blocks.push(b.clone('rubricSitOffertory'));
  if (offertory) blocks.push(b.chant(offertory.gabc, translationFor('Offertory')));

  blocks.push(b.title('Secret'));
  if (la.Secreta) blocks.push(b.reading('prayerReadingStyle', la.Secreta.text, en.Secreta?.text, '', skeleton));
  blocks.push(b.clone('perOmniaSecret'));

  blocks.push(b.title('Preface'));
  blocks.push(b.clone('rubricStandPreface'));
  blocks.push(b.clone('prefaceChant'));
  blocks.push(b.clone('prefaceText'));
  blocks.push(b.clone('rubricKneel'));
  blocks.push(b.clone('settingNote', { text: '<div style="text-align:justify">Missa —</div>', translation: '' }));
  blocks.push(b.pageBreak());

  blocks.push(b.title('Canon'));
  blocks.push(b.clone('perOmniaCanon'));

  blocks.push(b.title('Pater noster'));
  blocks.push(b.clone('rubricStandPater'));
  blocks.push(b.clone('paterIntro'));
  blocks.push(b.clone('paterChant'));
  blocks.push(b.clone('liberaNos'));
  blocks.push(b.clone('perOmniaPax'));
  blocks.push(b.clone('paxChant'));
  blocks.push(b.pageBreak());

  blocks.push(b.clone('rubricKneelCommunion'));
  blocks.push(b.clone('settingNote', { text: '<div style="text-align:justify">Missa —</div>', translation: '' }));

  const communio = chantBy('Communion');
  blocks.push(b.title(`Communion${communio?.chantName ? ' · ' + communio.chantName : ''}`));
  blocks.push(b.clone('panemCaelestem'));
  blocks.push(b.clone('rubricBreast'));
  blocks.push(b.clone('domineNonSum'));
  if (communio) blocks.push(b.chant(communio.gabc, translationFor('Communion')));

  blocks.push(b.title('Postcommunion'));
  blocks.push(b.clone('rubricStandPostcomm'));
  blocks.push(b.clone('domVobPostcomm'));
  if (la.Postcommunio) blocks.push(b.reading('prayerReadingStyle', la.Postcommunio.text, en.Postcommunio?.text, '', skeleton));
  blocks.push(b.clone('perOmniaPostcomm'));
  blocks.push(b.pageBreak());

  blocks.push(b.title('Conclusion'));
  blocks.push(b.clone('domVobIte'));
  blocks.push(b.clone('iteChant'));
  blocks.push(b.spacer());
  blocks.push(b.clone('lastGospel'));
  blocks.push(b.pageBreak());
  blocks.push(b.clone('salveRegina'));

  return {
    schemaVersion: 8,
    projectTitle: dayTitle,
    settings: { ...HOUSE_SETTINGS },
    blocks,
  };
}

// ---- Seeding ---------------------------------------------------------------

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

async function upsert({ name, description, season, key, project, feastMonth, feastDay }) {
  if (DRY) {
    console.log(`[dry] ${key} -> "${name}" (${season}, ${project.blocks.length} blocks)`);
    return;
  }
  // Seeded templates are drafts until an admin reviews and publishes them;
  // preserve that decision across re-runs.
  const prev = await pool.query(
    'SELECT published FROM booklet_templates WHERE feast_key = $1 AND official = true LIMIT 1', [key]
  );
  const published = prev.rows.length ? prev.rows[0].published : false;
  await pool.query('DELETE FROM booklet_templates WHERE feast_key = $1 AND official = true', [key]);
  await pool.query(`
    INSERT INTO booklet_templates (name, description, season, feast_key, official, owner_name, project, office_type, feast_month, feast_day, published)
    VALUES ($1, $2, $3, $4, true, '', $5, 'mass', $6, $7, $8)
  `, [name, description, season, key, JSON.stringify(project), feastMonth || null, feastDay || null, published]);
}

async function main() {
  const skeleton = loadSkeleton();
  const propria = JSON.parse(readText(path.join(JGABC, 'propriadata-new.json')));

  let created = 0;
  let skipped = 0;
  let withTexts = 0;

  // Temporale
  for (const entry of loadKeyList('sundayKeys')) {
    if (!entry || !entry.key) continue;
    const propers = propria[entry.key];
    if (!propers) { skipped++; continue; }
    const chants = loadProperChants(propers);
    if (!chants.length) { skipped++; continue; }

    const doPath = doPathForKey(entry.key);
    const doLa = doPath ? getMassSections(doPath, 'Latin') : null;
    const doEn = doPath ? getMassSections(doPath, 'English') : null;
    if (doLa) withTexts++;

    const title = entry.en || entry.title || entry.key;
    const project = buildFullMass(entry.key, title, entry.title !== entry.en ? entry.title : '', chants, doLa, doEn, skeleton);
    await upsert({
      name: `${title} — Mass`,
      description: doLa ? 'Complete sung Mass: propers, ordinary, texts & translations.' : 'Sung Mass: propers and ordinary.',
      season: seasonFor(entry.key),
      key: entry.key,
      project,
    });
    created++;
  }

  // Sanctorale (fixed feast dates for the calendar)
  for (const entry of loadKeyList('saintKeys')) {
    if (!entry || !entry.key) continue;
    const m = entry.key.match(/^([A-Z][a-z]{2})(\d{1,2})$/);
    if (!m || !MONTHS[m[1]]) continue;
    const propers = propria[entry.key];
    if (!propers) { skipped++; continue; }
    const chants = loadProperChants(propers);
    if (!chants.length) { skipped++; continue; }

    const doPath = doPathForKey(entry.key);
    const doLa = doPath ? getMassSections(doPath, 'Latin') : null;
    const doEn = doPath ? getMassSections(doPath, 'English') : null;
    if (doLa) withTexts++;

    // "Jan 17: St Anthony" -> "St Anthony"
    const title = (entry.en || entry.title || entry.key).replace(/^[A-Z][a-z]{2}\s+\d{1,2}:\s*/, '');
    const project = buildFullMass(entry.key, title, '', chants, doLa, doEn, skeleton);
    await upsert({
      name: `${title} — Mass`,
      description: doLa ? 'Complete sung Mass: propers, ordinary, texts & translations.' : 'Sung Mass: propers and ordinary.',
      season: 'Sanctorale',
      key: entry.key,
      project,
      feastMonth: MONTHS[m[1]],
      feastDay: parseInt(m[2], 10),
    });
    created++;
  }

  // Commons (Commune Virginum etc.)
  for (const [key, doFile] of Object.entries(COMMONS_DO)) {
    const propers = propria[key];
    if (!propers) { skipped++; continue; }
    const chants = loadProperChants(propers);
    if (!chants.length) { skipped++; continue; }

    const doLa = getMassSections(`horas/<lang>/Commune/${doFile}.txt`, 'Latin');
    const doEn = getMassSections(`horas/<lang>/Commune/${doFile}.txt`, 'English');
    if (doLa) withTexts++;

    const title = propers.title || key;
    const project = buildFullMass(key, title, '', chants, doLa, doEn, skeleton);
    await upsert({
      name: `${title} — Mass`,
      description: 'Common of saints: complete sung Mass with texts & translations.',
      season: 'Commons',
      key,
      project,
    });
    created++;
  }

  // Votives & other Masses (chant propers + ordinary; DO texts where trivially available)
  for (const entry of loadKeyList('otherKeys')) {
    if (!entry || !entry.key || entry.key === 'custom') continue;
    const propers = propria[entry.key];
    if (!propers) { skipped++; continue; }
    const chants = loadProperChants(propers);
    if (!chants.length) { skipped++; continue; }

    const title = entry.en || entry.title || entry.key;
    const project = buildFullMass(entry.key, title, entry.title !== entry.en ? entry.title : '', chants, null, null, skeleton);
    await upsert({
      name: `${title} — Mass`,
      description: 'Votive Mass: propers and ordinary.',
      season: 'Votive & special',
      key: entry.key,
      project,
    });
    created++;
  }

  console.log(`Done. ${created} templates ${DRY ? 'would be ' : ''}seeded (${withTexts} with DO texts), ${skipped} skipped (no chant data).`);
  if (!DRY) await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
