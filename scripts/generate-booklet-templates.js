/**
 * Seed the booklet template library with slot-tagged Mass PROPERS CORES:
 * the day's chants (from vendored jgabc data) and texts with translations
 * (from vendored Divinum Officium files), each block tagged with tplSlot
 * so the mix-and-match builder (src/services/massBuilder.js) can assemble
 * a full booklet at load time (framework dialogues, Kyriale ordinary,
 * Credo, readings options, Marian antiphon).
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
import { getMassSections, doPathForKey, doRuleFlags, COMMONS_DO } from './lib/do-texts.js';
import { normalizeLatinText, normalizeGabcLyrics, formatChantTranslation } from '../src/services/latinNormalize.js';

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
  marginTopMm: 10,
  marginBottomMm: 6,
  marginLeftMm: 10,
  marginRightMm: 10,
  sectionGapMm: 5,
  gapTolerancePx: 8,
  marginTolerancePx: 8,
  minOrphanLines: 3,
  descClipPx: 3,
  ascClipPx: 3,
  dropCapOffsetEm: 0.05,
  previewDisplay: 'scroll',
  fontFamilyKey: 'EB Garamond',
  rubricColor: '#8b1538',
  liturgicalSymbolColor: '#000000',
  autoHyphenate: true,
  pageNumbers: 'footer-center',
  pageNumberVMm: 6,
  pageNumberSkipFirst: true,
  pageNumberColor: '#000000',
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

// ---- Reading styles, cloned from the hand-made booklet --------------------

const SKELETON_PARTS = {
  prayerReadingStyle: [9, 'reading', /./],
  lessonReadingStyle: [13, 'reading', /./],
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
    title(text, slot, sizePt = 12) {
      return { id: bid(), type: 'title', text, tplSlot: slot, ...HOUSE_TITLE_STYLE, titleFontSizePt: sizePt };
    },
    reading(styleName, latin, english, sourceRef, slot) {
      const base = JSON.parse(JSON.stringify(skeleton[styleName]));
      return {
        ...base,
        id: bid(),
        tplSlot: slot,
        text: textToHtml(normalizeLatinText(latin)),
        translation: english ? textToHtml(english) : '',
        sectionTitle: '',
        sectionSourceRef: sourceRef || '',
        dropCapStyle: base.dropCapStyle === 'ornamental' ? 'ornamental' : 'plain',
        dropCapColor: base.dropCapColor || '',
        dropCapDecorationColor: base.dropCapDecorationColor || '',
        dropCapSizeEm: base.dropCapSizeEm ?? null,
        dropCapMarginTopEm: base.dropCapMarginTopEm ?? null,
        dropCapMarginRightEm: base.dropCapMarginRightEm ?? null,
        dropCapMarginBottomEm: base.dropCapMarginBottomEm ?? null,
        dropCapMarginLeftEm: base.dropCapMarginLeftEm ?? null,
      };
    },
    chant(gabc, translation, slot) {
      return { id: bid(), type: 'chant_gabc', gabc, chantTranslation: translation || '', tplSlot: slot, ...HOUSE_CHANT_STYLE };
    },
    rubric(text, slot) {
      return {
        id: bid(), type: 'rubric', text, tplSlot: slot,
        rubricColor: '#c80000', bodyFontSizePt: 11, lineHeightPt: 16,
        titleFontSizePt: 11, sourceFontSizePt: 9, fontScale: 1, sectionGapAfterMm: 8,
      };
    },
  };
}

/** DO English section text -> chant translation box (phrase-per-line). */
function chantTranslationFrom(section) {
  return section && section.text ? formatChantTranslation(section.text) : '';
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
    const gabc = normalizeGabcLyrics(readText(gabcPath));
    const nameM = gabc.match(/^name:\s*([^;]+);/mi);
    found.push({ label, gabc, chantName: nameM ? nameM[1].trim() : '' });
  }
  return found;
}

/**
 * Build a slot-tagged Mass PROPERS CORE (no ordinary, no dialogues) for the
 * mix-and-match builder to assemble at load time.
 * @param dayTitle   e.g. '7th Sunday after Pentecost'
 * @param chants     from loadProperChants()
 * @param doLa/doEn  DO sections (may be null: readings are omitted)
 * @param flags      { gloria, credo } from the DO [Rule]
 */
function buildProperCore(key, dayTitle, subtitle, chants, doLa, doEn, skeleton, flags) {
  const b = makeBuilder(key, skeleton);
  const la = doLa || {};
  const en = doEn || {};
  const blocks = [];
  const chantBy = (label) => chants.find((c) => c.label === label);
  const translationFor = (label) => chantTranslationFrom(en[SLOT_DO_SECTION[label]]);

  // Prayers flow as a single paragraph (the ending formula runs straight on).
  const flow = (s) => (s ? String(s).replace(/\s*\n+\s*/g, ' ').trim() : s);

  blocks.push(b.title(dayTitle, 'head', 18));

  const introit = chantBy('Introit');
  if (introit) {
    blocks.push(b.title('Introit', 'introit'));
    blocks.push(b.chant(introit.gabc, translationFor('Introit'), 'introit'));
  }

  if (la.Oratio) {
    blocks.push(b.title('Collect', 'collect'));
    blocks.push(b.reading('prayerReadingStyle', flow(la.Oratio.text), flow(en.Oratio?.text), '', 'collect'));
  }

  if (la.Lectio) {
    // Strip the "Léctio Epístolæ…" announcement line (the citation lives in
    // the source ref), as in the hand-made booklets.
    const lessonLa = la.Lectio.text.replace(/^L[ée]ctio[^\n]*\n+/i, '');
    const lessonEn = (en.Lectio?.text || '').replace(/^(Lesson|Reading|Epistle|Continuation)[^\n]*\n+/i, '');
    blocks.push(b.title('Lesson', 'lesson'));
    blocks.push(b.reading('lessonReadingStyle', lessonLa, lessonEn, la.Lectio.citation, 'lesson'));
  }

  // Between the readings: gradual/alleluia/tract/sequence as available.
  const between = ['Gradual', 'Alleluia', 'Alleluia (Paschal)', 'Alleluia II', 'Tract', 'Sequence']
    .map(chantBy).filter(Boolean);
  if (between.length) {
    blocks.push(b.title(
      between.map((c) => c.label.replace(/ \(.*/, '')).filter((v, i, a) => a.indexOf(v) === i).join(' & '),
      'between'
    ));
    for (const c of between) blocks.push(b.chant(c.gabc, translationFor(c.label), 'between'));
  }

  // Gospel: split the "Sequéntia/Inítium sancti Evangélii…" introduction
  // into its own slot so the builder can notate it, and record the
  // evangelist for the sung dialogue.
  let gospelIntro = null;
  if (la.Evangelium) {
    let gospelLa = la.Evangelium.text;
    let gospelEn = en.Evangelium?.text || '';
    const mIntro = gospelLa.match(/^((?:Sequéntia|Inítium)[^\n]*)\n+/i);
    if (mIntro) {
      const introLa = mIntro[1].trim();
      gospelLa = gospelLa.slice(mIntro[0].length);
      let introEn = '';
      const mIntroEn = gospelEn.match(/^((?:Continuation|The continuation|Beginning|The beginning)[^\n]*)\n+/i);
      if (mIntroEn) {
        introEn = mIntroEn[1].trim();
        gospelEn = gospelEn.slice(mIntroEn[0].length);
      }
      const mEv = introLa.match(/secúndum\s+([A-ZÀ-Þ]\S+?)\.?$/u);
      gospelIntro = {
        type: /^Inítium/i.test(introLa) ? 'initium' : 'sequentia',
        evangelist: mEv ? mEv[1].replace(/[.,;]+$/, '') : '',
      };
      blocks.push(b.title('Gospel', 'gospel'));
      blocks.push(b.reading('prayerReadingStyle', introLa, introEn, '', 'gospel_intro'));
      blocks.push(b.reading('lessonReadingStyle', gospelLa, gospelEn, la.Evangelium.citation, 'gospel'));
    } else {
      blocks.push(b.title('Gospel', 'gospel'));
      blocks.push(b.reading('lessonReadingStyle', gospelLa, gospelEn, la.Evangelium.citation, 'gospel'));
    }
  }

  const offertory = chantBy('Offertory');
  if (offertory) {
    blocks.push(b.title('Offertory', 'offertory'));
    blocks.push(b.chant(offertory.gabc, translationFor('Offertory'), 'offertory'));
  }

  if (la.Secreta) {
    blocks.push(b.title('Secret', 'secret'));
    blocks.push(b.reading('prayerReadingStyle', flow(la.Secreta.text), flow(en.Secreta?.text), '', 'secret'));
  }

  const communio = chantBy('Communion');
  if (communio) {
    blocks.push(b.title('Communion', 'communion'));
    blocks.push(b.chant(communio.gabc, translationFor('Communion'), 'communion'));
  }

  if (la.Postcommunio) {
    blocks.push(b.title('Postcommunion', 'postcommunion'));
    blocks.push(b.reading('prayerReadingStyle', flow(la.Postcommunio.text), flow(en.Postcommunio?.text), '', 'postcommunion'));
  }

  return {
    schemaVersion: 8,
    projectTitle: dayTitle,
    settings: { ...HOUSE_SETTINGS },
    meta: { gloria: flags.gloria, credo: flags.credo, buildable: 'mass', gospelIntro },
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
  // preserve that decision across re-runs, and NEVER overwrite a template an
  // admin has hand-curated.
  const prev = await pool.query(
    'SELECT published, curated FROM booklet_templates WHERE feast_key = $1 AND official = true LIMIT 1', [key]
  );
  if (prev.rows.length && prev.rows[0].curated) return;
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
    const flags = doPath ? doRuleFlags(doPath) : { gloria: true, credo: true };
    const project = buildProperCore(entry.key, title, entry.title !== entry.en ? entry.title : '', chants, doLa, doEn, skeleton, flags);
    await upsert({
      name: `${title} — Mass`,
      description: doLa ? 'Mass propers with texts & translations (buildable).' : 'Mass propers (buildable).',
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
    const flags = doPath ? doRuleFlags(doPath) : { gloria: true, credo: false };
    const project = buildProperCore(entry.key, title, '', chants, doLa, doEn, skeleton, flags);
    await upsert({
      name: `${title} — Mass`,
      description: doLa ? 'Mass propers with texts & translations (buildable).' : 'Mass propers (buildable).',
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
    const project = buildProperCore(key, title, '', chants, doLa, doEn, skeleton, { gloria: true, credo: false });
    await upsert({
      name: `${title} — Mass`,
      description: 'Common of saints: Mass propers with texts & translations (buildable).',
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
    const project = buildProperCore(entry.key, title, entry.title !== entry.en ? entry.title : '', chants, null, null, skeleton, { gloria: false, credo: false });
    await upsert({
      name: `${title} — Mass`,
      description: 'Votive Mass: propers (buildable).',
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
