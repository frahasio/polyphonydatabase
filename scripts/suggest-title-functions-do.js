/**
 * Matcher: propose liturgical functions for titles from the vendored
 * Divinum Officium corpus (data/divinumofficium — every Mass proper and
 * Office hour of the 1960 calendar, Latin).
 *
 * Complements the Cantus Index matcher: DO is COMPLETE (the whole year,
 * Mass + Office) and POSITIONAL — we know a text is e.g. the Introit of
 * Advent I or a Vespers antiphon of St Andrew, not merely "attested at"
 * some feast. Because the corpus is local, the whole catalogue is matched
 * in one run with no API calls.
 *
 * Emits ONE suggestion per title carrying ALL plausible functions
 * (payload.multi): a text may genuinely have 4-5 uses through the year.
 * Two kinds of entry:
 *   - specific: the text opens a proper of a small number of days.
 *   - season:   the text recurs on MANY days but concentrated in one
 *     season (Advent / Christmas / Lent / Easter / Pentecost octave) —
 *     previously these were discarded as "generic"; now they're matched
 *     to the catalogue's season-level functions.
 * Texts spread evenly across the year (ordinary chants, ferial psalmody)
 * still produce nothing.
 *
 * Re-runs REFRESH pending cards in place (dedupe key tfm:{title_id},
 * upsert while status='pending'); entries the reviewer already rejected
 * in old single-function cards are never re-proposed.
 *
 * Usage: node scripts/suggest-title-functions-do.js [--dry-run]
 */
import { pool } from '../src/db.js';
import { splitIncipitParts, foldSpelling } from './lib/matching.js';
import { buildCorpus, matchPart, seasonOfDay } from './lib/do-corpus.js';

const DRY_RUN = process.argv.includes('--dry-run');

// An incipit found on this many distinct days (union across every text
// unit that opens with it) is too widespread for SPECIFIC suggestions.
const GENERIC_DAYS = parseInt(process.env.DO_GENERIC_DAYS, 10) || 8;
// New-feast proposals only when the incipit is this specific.
const NEW_FEAST_MAX_DAYS = parseInt(process.env.DO_NEW_FEAST_MAX_DAYS, 10) || 3;
// Specific entries preselected in the card when this specific.
const PRESELECT_MAX_DAYS = 2;
// Season entries: listed at >= MIN days in season covering >= MIN_SHARE of
// the incipit's appearances; preselected when clearly seasonal.
const SEASON_MIN_DAYS = 3;
const SEASON_MIN_SHARE = 0.5;
const SEASON_PRESELECT_DAYS = 4;
const SEASON_PRESELECT_SHARE = 0.6;
const MAX_FUNCTIONS_PER_CARD = 8;
const MAX_POSITIONS_PER_FUNCTION = 4;

async function main() {
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  console.log('Building Divinum Officium corpus index...');
  const corpus = buildCorpus([...functionIds.keys()]);
  console.log(`  ${corpus.units.size} distinct text units indexed.`);

  // Functions the reviewer explicitly rejected for a title (in the old
  // one-function-per-card era or after) must stay rejected.
  const rejectedRows = await pool.query(`
    SELECT title_id, payload->>'function_id' AS fid, payload->>'function_name' AS fname
    FROM suggestions WHERE kind = 'title_function' AND status = 'rejected' AND title_id IS NOT NULL
  `);
  const rejected = new Set();
  for (const r of rejectedRows.rows) {
    if (r.fid) rejected.add(`${r.title_id}:id:${r.fid}`);
    if (r.fname) rejected.add(`${r.title_id}:name:${String(r.fname).toLowerCase()}`);
  }
  const isRejected = (titleId, fnId, fnName) =>
    (fnId && rejected.has(`${titleId}:id:${fnId}`)) ||
    rejected.has(`${titleId}:name:${String(fnName).toLowerCase()}`);

  // Every Latin/unknown title in use — INCLUDING titles that already have
  // functions (they may have several more uses through the year); only the
  // already-linked functions themselves are excluded from the card.
  const titles = await pool.query(`
    SELECT t.id, t.text,
           ARRAY(SELECT ft.function_id FROM functions_titles ft WHERE ft.title_id = t.id) AS existing_function_ids
    FROM titles t
    WHERE (t.language IS NULL OR t.language = (SELECT id FROM languages WHERE language = 'Latin'))
      AND EXISTS (SELECT 1 FROM compositions c WHERE c.title_id = t.id)
    ORDER BY t.id
  `);
  console.log(`Matching ${titles.rows.length} titles...${DRY_RUN ? ' [dry run]' : ''}`);

  let inserted = 0;
  for (const title of titles.rows) {
    const existingFnIds = new Set(title.existing_function_ids || []);
    const parts = splitIncipitParts(title.text).map(foldSpelling);
    if (!parts.length) continue;

    // Specific tallies: key 'fn:{name}' or 'new:{name}'.
    const tally = new Map();
    // Season tallies: season function name -> best per-part cluster.
    const seasonBest = new Map();
    const partDays = new Map();
    const matched = new Set();
    const citations = new Set();

    for (const part of parts) {
      const units = matchPart(part, corpus);
      if (!units.length) continue;
      // Specificity of the INCIPIT: union of days across every unit that
      // opens with it (different continuations count as one shared text).
      const unionDays = new Set();
      for (const u of units) for (const d of u.days) unionDays.add(d);
      const specificity = unionDays.size;
      if (!partDays.has(part) || partDays.get(part) > specificity) partDays.set(part, specificity);

      // ---- season clustering: which seasons do the appearances sit in? ----
      const bySeason = new Map();
      for (const d of unionDays) {
        const s = seasonOfDay(d);
        if (!s) continue;
        if (!bySeason.has(s)) bySeason.set(s, new Set());
        bySeason.get(s).add(d);
      }
      for (const [season, days] of bySeason) {
        const share = days.size / specificity;
        if (days.size < SEASON_MIN_DAYS || share < SEASON_MIN_SHARE) continue;
        const prev = seasonBest.get(season);
        if (!prev || days.size > prev.days) {
          // Sample positions within the season from the matched units.
          const positions = new Set();
          for (const u of units) {
            for (const place of u.places) {
              if (positions.size >= MAX_POSITIONS_PER_FUNCTION) break;
              if (seasonOfDay(place.day) === season) positions.add(`${place.position} — ${place.dayLabel}`);
            }
          }
          seasonBest.set(season, { days: days.size, share, positions });
        }
      }

      // ---- specific propers (unchanged logic) ----
      if (specificity >= GENERIC_DAYS) continue;
      for (const unit of units) {
        for (const place of unit.places) {
          let key, functionId, proposedName;
          if (place.fn && functionIds.has(place.fn)) {
            key = `fn:${place.fn}`; functionId = functionIds.get(place.fn); proposedName = place.fn;
          } else if (place.newName && specificity <= NEW_FEAST_MAX_DAYS) {
            key = `new:${place.newName.toLowerCase()}`; functionId = null; proposedName = place.newName;
          } else continue;
          if (!tally.has(key)) {
            tally.set(key, { functionId, proposedName, minDays: specificity, positions: new Set() });
          }
          const t = tally.get(key);
          t.minDays = Math.min(t.minDays, specificity);
          if (t.positions.size < MAX_POSITIONS_PER_FUNCTION) {
            t.positions.add(`${place.position} — ${place.dayLabel}`);
          }
          matched.add(unit.sample);
          if (unit.citation && citations.size < 4) citations.add(unit.citation);
        }
      }
    }

    // ---- assemble the card's function list ----
    const specifics = [...tally.values()]
      .filter((t) => !(t.functionId && existingFnIds.has(t.functionId)))
      .filter((t) => !isRejected(title.id, t.functionId, t.proposedName))
      .sort((a, b) => a.minDays - b.minDays
        || (a.functionId ? 0 : 1) - (b.functionId ? 0 : 1)
        || b.positions.size - a.positions.size)
      .map((t) => ({
        function_id: t.functionId,
        function_name: t.proposedName,
        new_function: !t.functionId || undefined,
        level: 'specific',
        days: t.minDays,
        positions: [...t.positions],
        preselected: t.minDays <= PRESELECT_MAX_DAYS,
      }));

    const specificNames = new Set(specifics.map((f) => f.function_name.toLowerCase()));
    const seasons = [...seasonBest.entries()]
      .filter(([season]) => functionIds.has(season)
        && !existingFnIds.has(functionIds.get(season))
        && !specificNames.has(season.toLowerCase())
        && !isRejected(title.id, functionIds.get(season), season))
      .sort((a, b) => b[1].days - a[1].days)
      .map(([season, s]) => ({
        function_id: functionIds.get(season),
        function_name: season,
        level: 'season',
        days: s.days,
        share: Math.round(s.share * 100) / 100,
        positions: [...s.positions],
        preselected: s.days >= SEASON_PRESELECT_DAYS && s.share >= SEASON_PRESELECT_SHARE,
      }));

    const functions = [...specifics, ...seasons].slice(0, MAX_FUNCTIONS_PER_CARD);
    if (!functions.length) continue;
    // A card with nothing preselected and nothing specific under GENERIC
    // days would be pure noise — require at least one credible entry.
    if (!functions.some((f) => f.preselected
      || (f.level === 'specific' && f.days <= 4)
      || (f.level === 'season' && f.days >= SEASON_PRESELECT_DAYS))) continue;

    const score = Math.max(...functions.map((f) => f.level === 'specific'
      ? Math.max(0.4, Math.round((1 - 0.08 * (f.days - 1)) * 100) / 100)
      : Math.min(0.85, 0.4 + 0.06 * f.days)));

    if (DRY_RUN) {
      inserted++;
      const desc = functions.map((f) => `${f.function_name}${f.new_function ? ' (NEW)' : ''}${f.level === 'season' ? ` [season ${f.days}d]` : ` [${f.days}d]`}${f.preselected ? '*' : ''}`).join(', ');
      console.log(`  ${title.id} "${title.text.slice(0, 45)}" -> ${desc}`);
      continue;
    }

    const result = await pool.query(
      `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
       VALUES ('title_function', $1, $2, $3, 'divinumofficium', $4)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET payload = EXCLUDED.payload, score = EXCLUDED.score
         WHERE suggestions.status = 'pending'`,
      [
        title.id,
        JSON.stringify({
          multi: true,
          functions,
          matched_incipit: [...matched][0] || null,
          citations: [...citations],
          part_days: [...partDays.entries()].map(([incipit, days]) => ({ incipit, days })),
        }),
        score,
        `tfm:${title.id}`,
      ]
    );
    if (result.rowCount) inserted++;
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted/refreshed'} ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
