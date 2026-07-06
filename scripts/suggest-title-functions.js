/**
 * Daily matcher: propose liturgical functions for titles by looking up their
 * incipits in Cantus Index (https://cantusindex.org), the federated catalogue
 * of chant texts. Writes rows to the suggestions table for human review in
 * the admin queue — nothing is applied automatically.
 *
 * The functions vocabulary in this catalogue is mostly FEASTS/OCCASIONS
 * (Advent I, Easter, saints' days...), so we map the Cantus `feast` field
 * onto function names. Genre (Introit, Antiphona...) is kept in the payload
 * as review context only.
 *
 * Usage: node scripts/suggest-title-functions.js [batchSize]
 * Intended for Heroku Scheduler (daily). Polite to the API: 1 request/sec.
 */
import { pool } from '../src/db.js';

// No hard API quota on Cantus Index, so large batches are fine; the only
// cost is runtime (~1s/request politeness). Cap generously.
const BATCH = Math.min(Math.max(parseInt(process.argv[2], 10) || 40, 1), 1000);
const TEXT_API = 'https://cantusindex.org/json-text/';
const CID_API = 'https://cantusindex.org/json-cid/';
// json-text returns only {cid, fulltext, genre}; the feast lives in
// json-cid/{cid} → info.field_feast, so matching is two-stage.
const MAX_CIDS_PER_TITLE = 4;

// Cantus feast names (and stems) → function names in this catalogue.
// Checked with startsWith against the lowercase Cantus feast string, so
// "Dominica 1 Adventus" matches the "dominica 1 adventus" key.
const FEAST_MAP = new Map(Object.entries({
  'dominica 1 adventus': 'Advent I',
  'dominica 2 adventus': 'Advent II',
  'dominica 3 adventus': 'Advent III',
  'dominica 4 adventus': 'Advent IV',
  'adventus': 'Advent',
  'nativitas domini': 'Christmas',
  'vigilia nat. domini': 'Christmas Vigil',
  'circumcisio domini': 'Circumcision',
  'epiphania': 'Epiphany',
  'purificatio mariae': 'Candlemas',
  'annuntiatio mariae': 'Annunciation',
  'visitatio mariae': 'Visitation',
  'assumptio mariae': 'Assumption',
  'nativitas mariae': 'Nativity of BVM',
  'praesentatio mariae': 'Presentation of BVM',
  'conceptio mariae': 'Immaculate Conception',
  'de bmv': 'BVM',
  'com. bmv': 'BVM',
  'dominica in palmis': 'Palm Sunday',
  'fer. 4 cinerum': 'Ash Wednesday',
  'fer. 5 in cena domini': 'Maundy Thursday',
  'fer. 6 in parasceve': 'Good Friday',
  'sabbato sancto': 'Holy Saturday',
  'dominica resurrectionis': 'Easter',
  'fer. 2 paschae': 'Easter Monday',
  'octava paschae': 'Low Sunday (Easter I)',
  'dominica 2 post pascha': 'Easter II',
  'dominica 3 post pascha': 'Easter III',
  'dominica 4 post pascha': 'Easter IV',
  'dominica 5 post pascha': 'Easter V',
  'ascensio domini': 'Ascension',
  'dominica pentecostes': 'Pentecost',
  'de trinitate': 'Trinity',
  'trinitatis': 'Trinity',
  'corporis christi': 'Corpus Christi',
  'de corpore christi': 'Corpus Christi',
  'exaltatio s. crucis': 'Holy Cross',
  'inventio s. crucis': 'Holy Cross',
  'transfiguratio domini': 'Transfiguration',
  'omnium sanctorum': 'All Saints',
  'in dedicatione ecclesiae': 'Dedication of Church',
  'pro defunctis': 'Requiem',
  'officium defunctorum': 'Office for the dead',
  'nativitas johannis baptist': 'John the Baptist',
  'johannis baptistae': 'John the Baptist',
  'petri, pauli': 'Ss Peter & Paul',
  'conversio s. pauli': 'Conversion of St Paul',
  'michaelis': 'St Michael',
  'stephani': 'St Stephen',
  'laurentii': 'St Lawrence',
  'andreae': 'St Andrew',
  'nicolai': 'St Nicholas',
  'martini': 'St Martin',
  'ceciliae': 'St Cecilia',
  'catharinae': 'St Catherine',
  'agathae': 'St Agatha',
  'agnetis': 'St Agnes',
  'luciae': 'St Lucy',
  'barbarae': 'St Barbara',
  'annae': 'St Anne',
  'mariae magdalenae': 'Mary Magdalene',
  'josephi': 'St Joseph',
  'benedicti': 'St Benedict',
  'bernardi': 'St Bernard',
  'francisci': 'St Francis',
  'dominici': 'St Dominic',
  'augustini': 'St Augustine',
  'ambrosii': 'St Ambrose',
  'gregorii': 'St Gregory',
  'sebastiani': 'St Sebastian',
  'innocentium': 'Holy Innocents',
  'nominis jesu': 'Holy Name of Jesus',
}));

function normalizeIncipit(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')      // editorial brackets e.g. "[I]"
    .replace(/\{.*?\}/g, ' ')      // placeholder braces e.g. "{psalm}"
    .replace(/\s*[-–—]\s.*$/, '')  // secunda pars after a dash
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapFeast(feast) {
  const f = String(feast || '').toLowerCase().trim();
  if (!f) return null;
  for (const [stem, name] of FEAST_MAP) {
    if (f.startsWith(stem)) return name;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'PolyphonyDatabase-Matcher/1 (polyphonydatabase@gmail.com)' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // Responses carry a UTF-8 BOM that JSON.parse rejects.
  return JSON.parse((await resp.text()).replace(/^\uFEFF/, ''));
}

async function main() {
  // Function name → id lookup (names are the source of truth; ids vary).
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  // Latin/unknown-language titles with no function link and no prior
  // title_function suggestion of any status (rejections stay rejected).
  const titles = await pool.query(`
    SELECT t.id, t.text
    FROM titles t
    WHERE NOT EXISTS (SELECT 1 FROM functions_titles ft WHERE ft.title_id = t.id)
      AND (t.language IS NULL OR t.language = (SELECT id FROM languages WHERE language = 'Latin'))
      AND NOT EXISTS (
        SELECT 1 FROM suggestions s WHERE s.kind = 'title_function' AND s.title_id = t.id
      )
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
    LIMIT $1
  `, [BATCH]);

  console.log(`Checking ${titles.rows.length} unmatched titles against Cantus Index...`);
  let inserted = 0;

  for (const title of titles.rows) {
    const incipit = normalizeIncipit(title.text);
    if (incipit.split(' ').length < 2) continue; // too short to match reliably

    // Stage 1: find candidate chants (cid + fulltext + genre) by text.
    let chants;
    try {
      chants = await fetchJson(TEXT_API + encodeURIComponent(incipit));
    } catch (err) {
      console.warn(`  ${title.id} "${incipit}": ${err.message}`);
      await sleep(1000);
      continue;
    }
    await sleep(1000);
    if (!Array.isArray(chants) || chants.length === 0) continue;

    // Prefer chants whose full text starts with our incipit; fall back to
    // any hit. Dedupe by Cantus ID, cap lookups per title.
    const starts = chants.filter(
      (c) => c.cid && normalizeIncipit(c.fulltext).startsWith(incipit)
    );
    const pool_ = (starts.length ? starts : chants.filter((c) => c.cid)).slice(0, MAX_CIDS_PER_TITLE * 2);
    const cids = Array.from(new Set(pool_.map((c) => String(c.cid)))).slice(0, MAX_CIDS_PER_TITLE);
    const genresByCid = new Map(pool_.map((c) => [String(c.cid), c.genre || '']));

    // Stage 2: per Cantus ID, fetch the canonical record for its feast.
    const tally = new Map(); // functionName → { count, cantusIds:Set, feasts:Set, genres:Set }
    let total = 0;
    for (const cid of cids) {
      let record;
      try {
        record = await fetchJson(CID_API + encodeURIComponent(cid));
      } catch (err) {
        console.warn(`  ${title.id} cid ${cid}: ${err.message}`);
        await sleep(1000);
        continue;
      }
      await sleep(1000);
      const feast = record && record.info ? record.info.field_feast : null;
      const genre = (record && record.info && record.info.field_genre) || genresByCid.get(cid) || '';
      if (!feast) continue;
      total++;
      const fnName = mapFeast(feast);
      if (!fnName || !functionIds.has(fnName)) continue;
      if (!tally.has(fnName)) {
        tally.set(fnName, { count: 0, cantusIds: new Set(), feasts: new Set(), genres: new Set() });
      }
      const t = tally.get(fnName);
      t.count++;
      t.cantusIds.add(cid);
      t.feasts.add(feast);
      if (genre) t.genres.add(genre);
    }

    // Suggest up to 2 functions per title, scored by how dominant the feast
    // is among the candidate chants (0..1).
    const ranked = Array.from(tally.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 2);

    for (const [fnName, info] of ranked) {
      const score = total > 0 ? Math.round((info.count / total) * 100) / 100 : 0;
      if (score < 0.25) continue;
      const functionId = functionIds.get(fnName);
      const result = await pool.query(
        `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
         VALUES ('title_function', $1, $2, $3, 'cantusindex.org', $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          title.id,
          JSON.stringify({
            function_id: functionId,
            function_name: fnName,
            feasts: Array.from(info.feasts).slice(0, 5),
            genres: Array.from(info.genres).slice(0, 8),
            cantus_id: Array.from(info.cantusIds)[0] || null,
            matched_incipit: incipit,
            concordances: info.count,
            total_results: total,
          }),
          score,
          `tf:${title.id}:${functionId}`,
        ]
      );
      inserted += result.rowCount;
      console.log(`  ${title.id} "${incipit}" → ${fnName} (${Math.round(score * 100)}%)`);
    }
  }

  console.log(`Done. Inserted ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
