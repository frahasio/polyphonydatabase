/**
 * Fallback matcher: propose liturgical functions for titles by looking up
 * their incipits in Cantus Index (https://cantusindex.org), the federated
 * catalogue of chant texts. Writes rows to the suggestions table for human
 * review in the admin queue — nothing is applied automatically.
 *
 * Since July 2026 this only handles titles the Divinum Officium corpus
 * does NOT contain (suggest-title-functions-do.js is the primary matcher —
 * positional evidence, generic-text filtering). Titles with any DO match
 * are skipped here (and marked checked), so Cantus API effort goes purely
 * to the long tail: votive antiphons, non-liturgical texts, local uses.
 *
 * The functions vocabulary in this catalogue is mostly FEASTS/OCCASIONS
 * (Advent I, Easter, saints' days...), so we map the Cantus `feast` field
 * onto function names. Genre (Introit, Antiphona...) is kept in the payload
 * as review context only.
 *
 * Usage: node scripts/suggest-title-functions.js [batchSize]
 * Occasional manual runs or a low-frequency schedule. Polite to the API:
 * ~1 request/sec.
 */
import { pool } from '../src/db.js';
import {
  normalizeIncipit, splitIncipitParts, foldSpelling, mapFeast, titleCase, normalizeFeast,
} from './lib/matching.js';
import { buildCorpus, matchPart } from './lib/do-corpus.js';

// No hard API quota on Cantus Index, so large batches are fine; the only
// cost is runtime (~0.8s/request politeness). Cap generously.
const BATCH = Math.min(Math.max(parseInt(process.argv[2], 10) || 40, 1), 1000);
// Quality bars: a chant only counts as evidence when at least 75% of the
// title's words appear in its incipit region, and a function is only
// suggested when at least 3 distinct Cantus records support it. A title CAN
// yield several functions (multiple genuine liturgical uses) if each clears
// both bars. Overridable via env for tuning without a code change.
const TEXT_MATCH_MIN = Number(process.env.CANTUS_TEXT_MATCH_MIN) || 0.75;
const MIN_RECORDS = parseInt(process.env.CANTUS_MIN_RECORDS, 10) || 3;
const MAX_SUGGESTIONS_PER_TITLE = 3;
const TEXT_API = 'https://cantusindex.org/json-text/';
const CID_API = 'https://cantusindex.org/json-cid/';
// json-text returns only {cid, fulltext, genre}; the feast lives in
// json-cid/{cid} → info.field_feast, so matching is two-stage.
const MAX_CIDS_PER_TITLE = 8;

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
  // Titles that already have functions ARE included: many pieces have several
  // genuine liturgical uses, and existing links are simply not re-suggested.
  const titles = await pool.query(`
    SELECT t.id, t.text,
           ARRAY(SELECT ft.function_id FROM functions_titles ft WHERE ft.title_id = t.id) AS existing_function_ids
    FROM titles t
    WHERE t.cantus_checked_at IS NULL
      AND (t.language IS NULL OR t.language = (SELECT id FROM languages WHERE language = 'Latin'))
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
    LIMIT $1
  `, [BATCH]);

  console.log(`Checking ${titles.rows.length} unchecked titles against Cantus Index...`);
  console.log('Building Divinum Officium index (titles DO covers are skipped here)...');
  const doCorpus = buildCorpus([]);
  let inserted = 0;
  let doSkipped = 0;

  for (const title of titles.rows) {
    // Mark as checked up front (even if matching fails midway).
    await pool.query('UPDATE titles SET cantus_checked_at = NOW() WHERE id = $1', [title.id]);

    // Multipart motets ("Prima pars - Secunda pars"): search every part and
    // pool the feast votes — the secunda pars is often the findable one.
    const parts = splitIncipitParts(title.text);
    if (!parts.length) continue;

    // The DO matcher owns anything the Divinum Officium corpus contains
    // (better evidence, no API cost) — spend Cantus requests only on texts
    // DO has never heard of.
    if (parts.some((p) => matchPart(foldSpelling(p), doCorpus).length > 0)) {
      doSkipped++;
      continue;
    }

    // Tally key: 'fn:{name}' for feasts that map onto an existing function,
    // 'new:{normalized feast}' for feasts our catalogue doesn't know yet —
    // those become "create this feast?" suggestions instead of being dropped.
    const tally = new Map(); // key → { functionId, proposedName, count, matchSum, cantusIds:Set, feasts:Set, genres:Set, parts:Set }
    let total = 0;
    const seenCids = new Set();
    const existingFnIds = new Set(title.existing_function_ids || []);

    for (const part of parts) {
      const chants = await searchTextCandidates(part);
      if (!chants.length) continue;

      // A chant only counts as evidence when at least TEXT_MATCH_MIN of the
      // part's words appear in the chant's INCIPIT REGION (first ~15 words,
      // spelling-folded). Scanning the whole text let long chants match on
      // scattered words; no weak "any hit" fallback either.
      const folded = foldSpelling(part);
      const partWords = folded.split(' ');
      const textMatch = (fulltext) => {
        const ft = foldSpelling(normalizeIncipit(fulltext));
        if (ft.startsWith(folded)) return 1;
        const ftWords = new Set(ft.split(' ').slice(0, 15));
        const matched = partWords.filter((w) => ftWords.has(w)).length;
        return Math.round((matched / partWords.length) * 100) / 100;
      };

      const matchByCid = new Map();
      for (const c of chants) {
        if (!c.cid) continue;
        const m = textMatch(c.fulltext);
        if (m < TEXT_MATCH_MIN) continue;
        const cid = String(c.cid);
        if (!matchByCid.has(cid) || matchByCid.get(cid).match < m) {
          matchByCid.set(cid, { match: m, genre: c.genre || '' });
        }
      }

      const cids = Array.from(matchByCid.keys())
        .filter((cid) => !seenCids.has(cid))
        .sort((a, b) => matchByCid.get(b).match - matchByCid.get(a).match)
        .slice(0, MAX_CIDS_PER_TITLE);
      cids.forEach((cid) => seenCids.add(cid));

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
        const genre = (record && record.info && record.info.field_genre) || matchByCid.get(cid).genre || '';
        if (!feast) continue;
        total++;
        const fnName = mapFeast(feast);
        let key, functionId, proposedName;
        if (fnName && functionIds.has(fnName)) {
          key = `fn:${fnName}`;
          functionId = functionIds.get(fnName);
          proposedName = fnName;
        } else {
          // Feast the catalogue doesn't know (or a mapped name whose function
          // row is missing): propose creating it. Reviewer confirms/edits the
          // name at accept time.
          proposedName = fnName || titleCase(normalizeFeast(feast));
          if (!proposedName) continue;
          key = `new:${proposedName.toLowerCase()}`;
          functionId = null;
        }
        if (!tally.has(key)) {
          tally.set(key, { functionId, proposedName, count: 0, matchSum: 0, cantusIds: new Set(), feasts: new Set(), genres: new Set(), parts: new Set() });
        }
        const t = tally.get(key);
        t.count++;
        t.matchSum += matchByCid.get(cid).match;
        t.cantusIds.add(cid);
        t.feasts.add(feast);
        t.parts.add(part);
        if (genre) t.genres.add(genre);
      }
    }

    // Emit every function backed by MIN_RECORDS+ distinct Cantus records —
    // multiple genuine liturgical uses are welcome. Functions the title is
    // already linked to are not re-suggested. Score = average text match of
    // the supporting records (>= TEXT_MATCH_MIN by construction).
    const ranked = Array.from(tally.values())
      .filter((info) => info.count >= MIN_RECORDS)
      .filter((info) => !(info.functionId && existingFnIds.has(info.functionId)))
      .sort((a, b) => b.count - a.count || b.matchSum - a.matchSum)
      .slice(0, MAX_SUGGESTIONS_PER_TITLE);

    for (const info of ranked) {
      const score = Math.round((info.matchSum / info.count) * 100) / 100;
      const isNew = !info.functionId;
      const dedupeKey = isNew
        ? `tfn:${title.id}:${info.proposedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : `tf:${title.id}:${info.functionId}`;
      const result = await pool.query(
        `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
         VALUES ('title_function', $1, $2, $3, 'cantusindex.org', $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          title.id,
          JSON.stringify({
            function_id: info.functionId,
            function_name: info.proposedName,
            new_function: isNew || undefined,
            feasts: Array.from(info.feasts).slice(0, 5),
            genres: Array.from(info.genres).slice(0, 8),
            cantus_id: Array.from(info.cantusIds)[0] || null,
            matched_incipit: Array.from(info.parts).join(' / '),
            concordances: info.count,
            total_results: total,
          }),
          score,
          dedupeKey,
        ]
      );
      inserted += result.rowCount;
      console.log(`  ${title.id} "${parts.join(' / ')}" -> ${info.proposedName}${isNew ? ' (NEW feast)' : ''} (${Math.round(score * 100)}%)`);
    }
  }

  console.log(`Done. Inserted ${inserted} suggestions (${doSkipped} titles skipped: covered by Divinum Officium).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
