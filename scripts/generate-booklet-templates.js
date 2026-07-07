/**
 * Seed the booklet template library from the vendored jgabc propers data
 * (the same data Ben Bloomfield's propers tool uses, already in this repo):
 *
 *   - public/vendor/jgabc/propersdata.js      -> sundayKeys (day key + names)
 *   - public/vendor/jgabc/propriadata-new.json -> day key -> chant ids per slot
 *   - public/vendor/jgabc/gabc/<id>.gabc       -> the chant scores
 *
 * For every day in sundayKeys with propers data, emits a booklet-schema-v8
 * project (title rule + chant blocks per proper) and upserts it into
 * booklet_templates as an OFFICIAL template (keyed by feast_key, so re-runs
 * refresh rather than duplicate — admin manual edits to generated templates
 * will be overwritten by a re-run, so re-run deliberately).
 *
 * Usage: node scripts/generate-booklet-templates.js [--dry]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const DRY = process.argv.includes('--dry');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JGABC = path.join(ROOT, 'public', 'vendor', 'jgabc');

// Some vendored files are Latin-1; fall back when UTF-8 decoding mangles.
function readText(p) {
  const buf = fs.readFileSync(p);
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? buf.toString('latin1') : utf8;
}

function loadSundayKeys() {
  const src = readText(path.join(JGABC, 'propersdata.js'));
  const start = src.indexOf('var sundayKeys = [');
  const end = src.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error('sundayKeys not found in propersdata.js');
  const literal = src.slice(start + 'var sundayKeys = '.length, end + 1);
  // A plain data literal (objects/strings only) — evaluate in isolation.
  return new Function(`return ${literal};`)();
}

// Slot definitions: [label, [id field aliases]] in liturgical order.
const SLOTS = [
  ['Introitus', ['introitusID', 'inID']],
  ['Graduale', ['gradualeID', 'grID']],
  ['Alleluia', ['alleluiaID', 'alID']],
  ['Alleluia (Tempore Paschali)', ['alPaschID']],
  ['Alleluia II', ['alExtraID']],
  ['Tractus', ['tractusID', 'trID', 'trSeptID']],
  ['Sequentia', ['sequentiaID', 'seqID']],
  ['Offertorium', ['offertoriumID', 'ofID']],
  ['Communio', ['communioID', 'coID']],
];

const SEASONS = [
  [/^Adv/, 'Advent'],
  [/^(Nat|InNat|Circum|Epiph?$|Dec|Jan)/, 'Christmastide'],
  [/^Epi/, 'Epiphanytide'],
  [/^(Sept|Sex|Quinq)/, 'Pre-Lent'],
  [/^(Quad|Cin)/, 'Lent'],
  [/^(Pass|Palm)/, 'Passiontide'],
  [/^(Pasc|Resur|Ascen)/, 'Eastertide'],
  [/^Pent/, 'Pentecost & after'],
  [/^(SM|votive|SCJ|ECJ|ChristusRex|litaniis)/i, 'Votive & special'],
];

function seasonFor(key) {
  for (const [re, name] of SEASONS) if (re.test(key)) return name;
  return 'Other';
}

function gabcHeaderValue(gabc, field) {
  const m = gabc.match(new RegExp(`^${field}:\\s*([^;]+);`, 'mi'));
  return m ? m[1].trim() : '';
}

function buildProject(entry, propers, key) {
  const blocks = [];
  let n = 0;
  const bid = () => `tpl_${key}_${n++}`;

  blocks.push({ id: bid(), type: 'title', text: entry.title || entry.en || key });
  if (entry.en && entry.en !== entry.title) {
    blocks.push({ id: bid(), type: 'rubric', text: entry.en });
  }

  let chants = 0;
  for (const [label, aliases] of SLOTS) {
    const idField = aliases.find((f) => propers[f] != null);
    if (!idField) continue;
    const gabcPath = path.join(JGABC, 'gabc', `${propers[idField]}.gabc`);
    if (!fs.existsSync(gabcPath)) continue;
    const gabc = readText(gabcPath);
    const chantName = gabcHeaderValue(gabc, 'name');
    blocks.push({
      id: bid(),
      type: 'title',
      text: label + (chantName ? ` · ${chantName}` : ''),
    });
    blocks.push({ id: bid(), type: 'chant_gabc', gabc });
    chants++;
  }
  if (!chants) return null;

  return {
    schemaVersion: 8,
    projectTitle: entry.en || entry.title || key,
    settings: {},
    blocks,
  };
}

async function main() {
  const sundayKeys = loadSundayKeys();
  const propria = JSON.parse(readText(path.join(JGABC, 'propriadata-new.json')));

  let created = 0;
  let skipped = 0;
  for (const entry of sundayKeys) {
    if (!entry || !entry.key) continue; // section headers in the list
    const propers = propria[entry.key];
    if (!propers) { skipped++; continue; }

    const project = buildProject(entry, propers, entry.key);
    if (!project) { skipped++; continue; }

    const name = `${entry.en || entry.title} — Mass propers`;
    const description = entry.title && entry.en && entry.title !== entry.en ? entry.title : '';
    const season = seasonFor(entry.key);

    if (DRY) {
      console.log(`[dry] ${entry.key} -> "${name}" (${season}, ${project.blocks.length} blocks)`);
      created++;
      continue;
    }

    await pool.query('DELETE FROM booklet_templates WHERE feast_key = $1 AND official = true', [entry.key]);
    await pool.query(`
      INSERT INTO booklet_templates (name, description, season, feast_key, official, owner_name, project)
      VALUES ($1, $2, $3, $4, true, '', $5)
    `, [name, description, season, entry.key, JSON.stringify(project)]);
    created++;
  }

  console.log(`Done. ${created} templates ${DRY ? 'would be' : ''} seeded, ${skipped} keys skipped (no data).`);
  if (!DRY) await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
