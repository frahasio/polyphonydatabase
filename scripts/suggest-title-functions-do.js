/**
 * Matcher: propose liturgical functions for titles from the vendored
 * Divinum Officium corpus (data/divinumofficium — every Mass proper and
 * Office hour of the 1960 calendar, Latin).
 *
 * Complements the Cantus Index matcher: DO is COMPLETE (the whole year,
 * Mass + Office) and POSITIONAL — we know a text is e.g. the Introit of
 * Advent I or a Vespers antiphon of St Andrew, not merely "attested at"
 * some feast. Because the corpus is local, the whole catalogue is matched
 * in one run with no API calls, and texts that recur across many days are
 * recognised as GENERIC and never suggested (the "Cantus happened to file
 * it under one feast" problem).
 *
 * Matching is strict: a title incipit must be the opening words of a
 * liturgical text unit (an antiphon line, introit, gradual verse...).
 * Suggestions reuse the title_function kind and the tf:/tfn: dedupe keys,
 * so a feast already suggested by Cantus is not duplicated.
 *
 * Usage: node scripts/suggest-title-functions-do.js [--dry-run]
 */
import { pool } from '../src/db.js';
import { splitIncipitParts, foldSpelling } from './lib/matching.js';
import { buildCorpus, matchPart } from './lib/do-corpus.js';

const DRY_RUN = process.argv.includes('--dry-run');

// An INCIPIT found on this many distinct days (union across every text
// unit that opens with it) is generic (ordinary chants, ferial psalmody,
// ubiquitous antiphons) and is never suggested.
const GENERIC_DAYS = parseInt(process.env.DO_GENERIC_DAYS, 10) || 8;
// New-feast proposals only when the incipit is this specific: shared texts
// must not spawn a new feast for every day that borrows them.
const NEW_FEAST_MAX_DAYS = parseInt(process.env.DO_NEW_FEAST_MAX_DAYS, 10) || 3;
// A text may genuinely be proper to several days (Sunday + saint + feria) —
// suggest ALL of them, not just the most specific.
const MAX_SUGGESTIONS_PER_TITLE = 6;
const MAX_POSITIONS_IN_PAYLOAD = 6;

async function main() {
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  console.log('Building Divinum Officium corpus index...');
  const corpus = buildCorpus([...functionIds.keys()]);
  console.log(`  ${corpus.units.size} distinct text units indexed.`);

  // Every Latin/unknown title in use, with its existing function links —
  // all local computation, so no checkpoint needed: dedupe keys make
  // re-runs cheap and idempotent.
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

    // key 'fn:{name}' or 'new:{name}' -> { functionId, proposedName,
    //   minDays, positions:Set, matched:Set }
    const tally = new Map();
    for (const part of parts) {
      const units = matchPart(part, corpus);
      if (!units.length) continue;
      // Specificity of the INCIPIT: union of days across every unit that
      // opens with it. Different continuations of the same opening words
      // (Gradual verse vs Communio) must count as one shared text, or a
      // widely-used incipit masquerades as "proper to 1 day".
      const unionDays = new Set();
      for (const u of units) for (const d of u.days) unionDays.add(d);
      const specificity = unionDays.size;
      if (specificity >= GENERIC_DAYS) continue; // generic incipit

      for (const unit of units) {
        for (const place of unit.places) {
          let key, functionId, proposedName;
          if (place.fn && functionIds.has(place.fn)) {
            key = `fn:${place.fn}`; functionId = functionIds.get(place.fn); proposedName = place.fn;
          } else if (place.newName && specificity <= NEW_FEAST_MAX_DAYS) {
            key = `new:${place.newName.toLowerCase()}`; functionId = null; proposedName = place.newName;
          } else continue;
          if (!tally.has(key)) {
            tally.set(key, { functionId, proposedName, minDays: specificity, positions: new Set(), matched: new Set() });
          }
          const t = tally.get(key);
          t.minDays = Math.min(t.minDays, specificity);
          if (t.positions.size < MAX_POSITIONS_IN_PAYLOAD) {
            t.positions.add(`${place.position} — ${place.dayLabel}`);
          }
          t.matched.add(unit.sample);
        }
      }
    }

    const ranked = [...tally.values()]
      .filter((t) => !(t.functionId && existingFnIds.has(t.functionId)))
      // Most specific first; on equal specificity prefer feasts the
      // catalogue already knows over creating new ones.
      .sort((a, b) => a.minDays - b.minDays
        || (a.functionId ? 0 : 1) - (b.functionId ? 0 : 1)
        || b.positions.size - a.positions.size)
      .slice(0, MAX_SUGGESTIONS_PER_TITLE);

    for (const t of ranked) {
      // Specificity score: a text unique to one day scores 1.0, sliding
      // down as it appears on more days.
      const score = Math.max(0.4, Math.round((1 - 0.08 * (t.minDays - 1)) * 100) / 100);
      const isNew = !t.functionId;
      const dedupeKey = isNew
        ? `tfn:${title.id}:${t.proposedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : `tf:${title.id}:${t.functionId}`;
      if (DRY_RUN) {
        inserted++;
        console.log(`  ${title.id} "${title.text.slice(0, 50)}" -> ${t.proposedName}${isNew ? ' (NEW)' : ''} [${[...t.positions][0]}] days=${t.minDays}`);
        continue;
      }
      const result = await pool.query(
        `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
         VALUES ('title_function', $1, $2, $3, 'divinumofficium', $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          title.id,
          JSON.stringify({
            function_id: t.functionId,
            function_name: t.proposedName,
            new_function: isNew || undefined,
            positions: [...t.positions],
            matched_incipit: [...t.matched][0] || null,
            days: t.minDays,
          }),
          score,
          dedupeKey,
        ]
      );
      if (result.rowCount) {
        inserted++;
        console.log(`  ${title.id} "${title.text.slice(0, 50)}" -> ${t.proposedName}${isNew ? ' (NEW)' : ''} (${Math.round(score * 100)}%)`);
      }
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
