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
// cost is runtime (~0.8s/request politeness). Cap generously.
const BATCH = Math.min(Math.max(parseInt(process.argv[2], 10) || 40, 1), 1000);
// Minimum share of feast votes for a suggestion (reviewers filter the rest).
const MIN_SCORE = 0.2;
const TEXT_API = 'https://cantusindex.org/json-text/';
const CID_API = 'https://cantusindex.org/json-cid/';
// json-text returns only {cid, fulltext, genre}; the feast lives in
// json-cid/{cid} → info.field_feast, so matching is two-stage.
const MAX_CIDS_PER_TITLE = 4;

// Cantus feast names (and stems) → function names in this catalogue.
// Checked with startsWith against the lowercase Cantus feast string, so
// "Dominica 1 Adventus" matches the "dominica 1 adventus" key.
// Keys are in NORMALIZED form (lowercase, accents stripped, abbreviations
// already expanded, no dots) so they match the output of normalizeFeast().
// Matched by substring, longest-first (see FEAST_MAP_SORTED).
const FEAST_MAP = new Map(Object.entries({
  'dominica 1 adventus': 'Advent I',
  'dominica 2 adventus': 'Advent II',
  'dominica 3 adventus': 'Advent III',
  'dominica 4 adventus': 'Advent IV',
  'adventus': 'Advent',
  'vigilia nativitas domini': 'Christmas Vigil',
  'nativitas domini': 'Christmas',
  'in nativitate domini': 'Christmas',
  'circumcisio domini': 'Circumcision',
  'epiphania': 'Epiphany',
  'purificatio': 'Candlemas',
  'annuntiatio': 'Annunciation',
  'visitatio': 'Visitation',
  'assumptio': 'Assumption',
  'nativitas mariae': 'Nativity of BVM',
  'nativitas beatae mariae virginis': 'Nativity of BVM',
  'praesentatio': 'Presentation of BVM',
  'conceptio': 'Immaculate Conception',
  'beatae mariae virginis': 'BVM',
  'de sancta maria': 'BVM',
  'dominica in palmis': 'Palm Sunday',
  'feria 4 cinerum': 'Ash Wednesday',
  'feria 5 in cena domini': 'Maundy Thursday',
  'feria 6 in parasceve': 'Good Friday',
  'sabbato sancto': 'Holy Saturday',
  'dominica resurrectionis': 'Easter',
  'sabbato in albis': 'Easter',
  'feria 2 paschae': 'Easter Monday',
  'dominica in albis': 'Low Sunday (Easter I)',
  'octava paschae': 'Low Sunday (Easter I)',
  'dominica 2 post pascha': 'Easter II',
  'dominica 3 post pascha': 'Easter III',
  'dominica 4 post pascha': 'Easter IV',
  'dominica 5 post pascha': 'Easter V',
  'ascensio domini': 'Ascension',
  'ascensio': 'Ascension',
  'dominica pentecostes': 'Pentecost',
  'pentecosten': 'Pentecost',
  'trinitate': 'Trinity',
  'trinitatis': 'Trinity',
  'corporis christi': 'Corpus Christi',
  'corpore christi': 'Corpus Christi',
  'exaltatio sancti crucis': 'Holy Cross',
  'exaltatio crucis': 'Holy Cross',
  'inventio crucis': 'Holy Cross',
  'sancti crucis': 'Holy Cross',
  'transfiguratio': 'Transfiguration',
  'omnium sanctorum': 'All Saints',
  'dedicatione ecclesiae': 'Dedication of Church',
  'dedicatio ecclesiae': 'Dedication of Church',
  'pro defunctis': 'Requiem',
  'defunctorum': 'Office for the dead',
  'johannis baptistae': 'John the Baptist',
  'iohannis baptistae': 'John the Baptist',
  'nativitas iohannis': 'John the Baptist',
  'petri et pauli': 'Ss Peter & Paul',
  'petri pauli': 'Ss Peter & Paul',
  'conversio sancti pauli': 'Conversion of St Paul',
  'sancti michaelis': 'St Michael',
  'michaelis': 'St Michael',
  'sancti stephani': 'St Stephen',
  'stephani': 'St Stephen',
  'laurentii': 'St Lawrence',
  'andreae': 'St Andrew',
  'nicolai': 'St Nicholas',
  'martini': 'St Martin',
  'ceciliae': 'St Cecilia',
  'caeciliae': 'St Cecilia',
  'catharinae': 'St Catherine',
  'katharinae': 'St Catherine',
  'agathae': 'St Agatha',
  'agnetis': 'St Agnes',
  'luciae': 'St Lucy',
  'barbarae': 'St Barbara',
  'annae': 'St Anne',
  'mariae magdalenae': 'Mary Magdalene',
  'iosephi': 'St Joseph',
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
  'nominis iesu': 'Holy Name of Jesus',
}));

// Substring matching must prefer the most specific (longest) key.
const FEAST_MAP_SORTED = Array.from(FEAST_MAP.entries())
  .sort((a, b) => b[0].length - a[0].length);

function normalizeIncipit(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\[.*?\]/g, ' ')      // editorial brackets e.g. "[I]"
    .replace(/\{.*?\}/g, ' ')      // placeholder braces e.g. "{psalm}"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Multipart motets are stored as "Prima pars - Secunda pars" (space-hyphen-
// space, sometimes en/em dashes). Each part is a searchable incipit.
function splitIncipitParts(text) {
  return String(text || '')
    .split(/\s+[-\u2013\u2014]\s+/)
    .map(normalizeIncipit)
    .filter((p) => p && p.split(' ').length >= 2)
    .slice(0, 3);
}

// Fold the mediaeval spelling variants both our titles and Cantus mix freely
// (i/j, u/v) so "Iustorum" matches "Justorum" and "euge" matches "evge".
function foldSpelling(s) {
  return String(s || '').replace(/j/g, 'i').replace(/v/g, 'u');
}

// Cantus feast names are heavily abbreviated ("Dom. Resurrectionis",
// "Octava Nat. Domini", "Fer. 4 Cinerum", "S. Andreae"). Expand the common
// abbreviations to full Latin so the FEAST_MAP keys (full spellings) match,
// and match by substring so the map is order-independent.
function normalizeFeast(feast) {
  let f = String(feast || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const expansions = [
    [/\bdom\./g, 'dominica'],
    [/\bnat\./g, 'nativitas'],
    [/\bfer\./g, 'feria'],
    [/\bvig\./g, 'vigilia'],
    [/\boct\./g, 'octava'],
    [/\bcomm?\./g, 'commemoratio'],
    [/\bconv\./g, 'conversio'],
    [/\bexalt\./g, 'exaltatio'],
    [/\binv\./g, 'inventio'],
    [/\bpurif\./g, 'purificatio'],
    [/\bassumpt\./g, 'assumptio'],
    [/\bpraesent\./g, 'praesentatio'],
    [/\bconcept\./g, 'conceptio'],
    [/\bannunt\./g, 'annuntiatio'],
    [/\bss\./g, 'sancti'],
    [/\bs\./g, 'sancti'],
    [/\bb\./g, 'beati'],
    [/\bbmv\b/g, 'beatae mariae virginis'],
    [/\bbvm\b/g, 'beatae mariae virginis'],
  ];
  for (const [re, to] of expansions) f = f.replace(re, to);
  return f.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapFeast(feast) {
  const f = normalizeFeast(feast);
  if (!f) return null;
  // Longest keys first so more specific feasts win (e.g. "dominica
  // resurrectionis" before a bare "dominica").
  for (const [stem, name] of FEAST_MAP_SORTED) {
    if (f.includes(stem)) return name;
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

// Word-initial i+vowel -> j+vowel ("iustorum" -> "justorum"), for querying
// Cantus texts that use the j-spelling.
function jVariant(s) {
  return String(s || '').replace(/\b i(?=[aeou])/g, ' j').replace(/^i(?=[aeou])/, 'j');
}

/**
 * Stage 1 with fuzz: try the incipit as-is, then spelling variants (i/j,
 * u/v folded both ways), then a first-3-words prefix as a last resort.
 * Returns the first non-empty candidate list.
 */
async function searchTextCandidates(part) {
  const tried = new Set();
  const queries = [];
  const push = (q) => { if (q && q.split(' ').length >= 2 && !tried.has(q)) { tried.add(q); queries.push(q); } };

  push(part);
  push(foldSpelling(part));       // j->i, v->u
  push(jVariant(part));           // i->j at word starts
  const words = part.split(' ');
  if (words.length > 3) {
    push(words.slice(0, 3).join(' '));
    push(foldSpelling(words.slice(0, 3).join(' ')));
  }

  for (const q of queries) {
    let chants = null;
    try {
      chants = await fetchJson(TEXT_API + encodeURIComponent(q));
    } catch (err) {
      console.warn(`  text search "${q}": ${err.message}`);
    }
    await sleep(800);
    if (Array.isArray(chants) && chants.length) return chants;
  }
  return [];
}

async function main() {
  // Function name → id lookup (names are the source of truth; ids vary).
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  // Latin/unknown-language titles never checked before. cantus_checked_at is
  // set for EVERY processed title (matched or not) so runs always advance
  // through the catalogue instead of re-checking the same unmatched block.
  const titles = await pool.query(`
    SELECT t.id, t.text
    FROM titles t
    WHERE t.cantus_checked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM functions_titles ft WHERE ft.title_id = t.id)
      AND (t.language IS NULL OR t.language = (SELECT id FROM languages WHERE language = 'Latin'))
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
    LIMIT $1
  `, [BATCH]);

  console.log(`Checking ${titles.rows.length} unchecked titles against Cantus Index...`);
  let inserted = 0;

  for (const title of titles.rows) {
    // Mark as checked up front (even if matching fails midway).
    await pool.query('UPDATE titles SET cantus_checked_at = NOW() WHERE id = $1', [title.id]);

    // Multipart motets ("Prima pars - Secunda pars"): search every part and
    // pool the feast votes — the secunda pars is often the findable one.
    const parts = splitIncipitParts(title.text);
    if (!parts.length) continue;

    const tally = new Map(); // functionName → { count, cantusIds:Set, feasts:Set, genres:Set, parts:Set }
    let total = 0;
    const seenCids = new Set();

    for (const part of parts) {
      const chants = await searchTextCandidates(part);
      if (!chants.length) continue;

      // Prefer chants whose folded full text starts with the folded part
      // (spelling-tolerant); fall back to any hit.
      const folded = foldSpelling(part);
      const starts = chants.filter(
        (c) => c.cid && foldSpelling(normalizeIncipit(c.fulltext)).startsWith(folded)
      );
      const pool_ = (starts.length ? starts : chants.filter((c) => c.cid)).slice(0, MAX_CIDS_PER_TITLE * 2);
      const cids = Array.from(new Set(pool_.map((c) => String(c.cid))))
        .filter((cid) => !seenCids.has(cid))
        .slice(0, MAX_CIDS_PER_TITLE);
      cids.forEach((cid) => seenCids.add(cid));
      const genresByCid = new Map(pool_.map((c) => [String(c.cid), c.genre || '']));

      // Stage 2: per Cantus ID, fetch the canonical record for its feast.
      for (const cid of cids) {
        let record;
        try {
          record = await fetchJson(CID_API + encodeURIComponent(cid));
        } catch (err) {
          console.warn(`  ${title.id} cid ${cid}: ${err.message}`);
          await sleep(800);
          continue;
        }
        await sleep(800);
        const feast = record && record.info ? record.info.field_feast : null;
        const genre = (record && record.info && record.info.field_genre) || genresByCid.get(cid) || '';
        if (!feast) continue;
        total++;
        const fnName = mapFeast(feast);
        if (!fnName || !functionIds.has(fnName)) continue;
        if (!tally.has(fnName)) {
          tally.set(fnName, { count: 0, cantusIds: new Set(), feasts: new Set(), genres: new Set(), parts: new Set() });
        }
        const t = tally.get(fnName);
        t.count++;
        t.cantusIds.add(cid);
        t.feasts.add(feast);
        t.parts.add(part);
        if (genre) t.genres.add(genre);
      }
    }

    // Suggest up to 2 functions per title, scored by how dominant the feast
    // is among the candidate chants (0..1).
    const ranked = Array.from(tally.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 2);

    for (const [fnName, info] of ranked) {
      const score = total > 0 ? Math.round((info.count / total) * 100) / 100 : 0;
      if (score < MIN_SCORE) continue;
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
            matched_incipit: Array.from(info.parts).join(' / '),
            concordances: info.count,
            total_results: total,
          }),
          score,
          `tf:${title.id}:${functionId}`,
        ]
      );
      inserted += result.rowCount;
      console.log(`  ${title.id} "${parts.join(' / ')}" -> ${fnName} (${Math.round(score * 100)}%)`);
    }
  }

  console.log(`Done. Inserted ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
