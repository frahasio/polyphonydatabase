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
import { splitIncipitParts, foldSpelling, isOrdinaryText } from './lib/matching.js';
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
// Function clusters (feast + its octave/vigil days): minimum share of the
// incipit's appearances concentrated on one function to call it the text's
// main purpose.
const CLUSTER_MIN_SHARE = parseFloat(process.env.DO_CLUSTER_MIN_SHARE) || 0.34;
const MAX_FUNCTIONS_PER_CARD = 8;
const MAX_POSITIONS_PER_FUNCTION = 4;

async function main() {
  const fnRows = await pool.query('SELECT id, name FROM functions');
  const functionIds = new Map(fnRows.rows.map((r) => [r.name, r.id]));

  // Reviewer-curated Latin->English feast names (the /modules/functions
  // dictionary) override every built-in mapping heuristic.
  let overrides = new Map();
  try {
    const curated = await pool.query(
      `SELECT latin, english FROM feast_translations WHERE source = 'manual' AND english IS NOT NULL AND english <> ''`
    );
    overrides = new Map(curated.rows.map((r) => [r.latin, r.english]));
    if (overrides.size) console.log(`${overrides.size} curated feast translations loaded.`);
  } catch {
    // Table not migrated yet — built-in mappings only.
  }

  console.log('Building Divinum Officium corpus index...');
  const corpus = buildCorpus([...functionIds.keys()], overrides);
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
  let autoAccepted = 0;
  for (const title of titles.rows) {
    const existingFnIds = new Set(title.existing_function_ids || []);
    const parts = splitIncipitParts(title.text).map(foldSpelling);
    if (!parts.length) continue;

    // Specific tallies: key 'fn:{name}' or 'new:{name}'.
    const tally = new Map();
    // Season tallies: season function name -> best per-part cluster.
    const seasonBest = new Map();
    // Function clusters: a feast + its octave/vigil is many day files but
    // ONE function — concentration there identifies the text's main
    // purpose even when the raw day count looks "generic".
    const clusterBest = new Map();
    const partDays = new Map();
    const matched = new Set();
    const citations = new Set();

    for (const part of parts) {
      // Mass-ordinary / daily-Office texts (Gloria, Sanctus, Magnificat...)
      // live outside DO's per-day files, so day counting can't see their
      // ubiquity — skip them outright.
      if (isOrdinaryText(part)) continue;
      const units = matchPart(part, corpus);
      if (!units.length) continue;
      // Specificity of the INCIPIT: union of days across every unit that
      // opens with it (different continuations count as one shared text).
      const unionDays = new Set();
      for (const u of units) for (const d of u.days) unionDays.add(d);
      const specificity = unionDays.size;
      // Full appearance breakdown for the card: EVERY day the incipit
      // appears on — including days that produce no suggestion (ferial
      // lessons, unmapped days) — with position where known, so the
      // reviewer can see exactly how (non-)specific the text is.
      const posByDay = new Map();
      for (const u of units) {
        for (const place of u.places) {
          if (!posByDay.has(place.day)) posByDay.set(place.day, place.position);
        }
      }
      const breakdown = [...unionDays].map((d) => ({
        label: corpus.dayLabels.get(d) || d.replace(/^.*\//, ''),
        position: posByDay.get(d) || null,
      })).sort((a, b) => (a.position ? 0 : 1) - (b.position ? 0 : 1));
      const prev = partDays.get(part);
      if (!prev || prev.days > specificity) {
        partDays.set(part, { days: specificity, breakdown: breakdown.slice(0, 10), more: Math.max(0, breakdown.length - 10) });
      }

      const samplePositions = (predicate) => {
        const positions = new Set();
        for (const u of units) {
          for (const place of u.places) {
            if (positions.size >= MAX_POSITIONS_PER_FUNCTION) break;
            if (predicate(place)) positions.add(`${place.position} — ${place.dayLabel}`);
          }
        }
        return positions;
      };

      // ---- function clustering across ALL matched days ----
      const byFn = new Map();
      for (const d of unionDays) {
        for (const fn of (corpus.dayFunctions.get(d) || [])) {
          byFn.set(fn, (byFn.get(fn) || 0) + 1);
        }
      }
      for (const [fn, count] of byFn) {
        const share = count / specificity;
        if (count < 2 || share < CLUSTER_MIN_SHARE) continue;
        if (!clusterBest.has(fn)) {
          clusterBest.set(fn, { days: count, share, positions: samplePositions((p) => p.fn === fn), parts: new Set() });
        } else if (count > clusterBest.get(fn).days) {
          Object.assign(clusterBest.get(fn), { days: count, share, positions: samplePositions((p) => p.fn === fn) });
        }
        clusterBest.get(fn).parts.add(part);
        matched.add(units[0].sample);
      }

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
          seasonBest.set(season, {
            days: days.size,
            share,
            positions: samplePositions((p) => seasonOfDay(p.day) === season),
          });
        }
      }

      // ---- specific propers ----
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
            tally.set(key, { functionId, proposedName, minDays: specificity, positions: new Set(), parts: new Set() });
          }
          const t = tally.get(key);
          t.minDays = Math.min(t.minDays, specificity);
          t.parts.add(part);
          if (t.positions.size < MAX_POSITIONS_PER_FUNCTION) {
            t.positions.add(`${place.position} — ${place.dayLabel}`);
          }
          matched.add(unit.sample);
          if (unit.citation && citations.size < 4) citations.add(unit.citation);
        }
      }
    }

    // ---- assemble the card's function list ----
    // Function clusters (feast + octave concentration) identify the text's
    // MAIN purpose: they lead the card, and when one exists, scattered
    // 1-day matches elsewhere are listed but NOT preticked.
    // The main purpose may already be LINKED to the title (the reviewer
    // catalogued it) — it still counts as dominant, so a coincidental
    // 1-day hit elsewhere must not be preticked; it's just not re-listed.
    const dominantFns = [...clusterBest.keys()]
      .filter((fn) => functionIds.has(fn) && !isRejected(title.id, functionIds.get(fn), fn));
    const hasDominant = dominantFns.length > 0
      || [...existingFnIds].length > 0; // an already-catalogued title needs no aggressive preticks

    // CORROBORATION: on a multipart motet, a function matched by TWO OR
    // MORE parts (respond + verse both in that day's propers) is far
    // stronger evidence than a single-part hit. Corroborated candidates
    // rank first; when any exists, uncorroborated specifics lose their
    // pretick (the parts pointing elsewhere are usually coincidence).
    // Requiring ALL parts would overshoot: secunda partes are often free
    // continuations the liturgy doesn't contain.
    const totalParts = parts.length;
    const corroborationExists = totalParts > 1 && (
      [...tally.values()].some((t) => t.parts.size > 1)
      || [...clusterBest.values()].some((c) => c.parts.size > 1)
    );

    const clusters = dominantFns
      .filter((fn) => !existingFnIds.has(functionIds.get(fn)))
      .sort((a, b) => (clusterBest.get(b).parts.size - clusterBest.get(a).parts.size)
        || (clusterBest.get(b).days - clusterBest.get(a).days))
      .map((fn) => {
        const c = clusterBest.get(fn);
        return {
          function_id: functionIds.get(fn),
          function_name: fn,
          level: 'cluster',
          days: c.days,
          share: Math.round(c.share * 100) / 100,
          positions: [...c.positions],
          parts_matched: c.parts.size,
          parts_total: totalParts,
          preselected: !corroborationExists || c.parts.size > 1,
        };
      });
    const clusterNames = new Set(clusters.map((f) => f.function_name.toLowerCase()));

    const specifics = [...tally.values()]
      .filter((t) => !(t.functionId && existingFnIds.has(t.functionId)))
      .filter((t) => !isRejected(title.id, t.functionId, t.proposedName))
      .filter((t) => !clusterNames.has(t.proposedName.toLowerCase()))
      .sort((a, b) => (b.parts.size - a.parts.size)
        || (a.minDays - b.minDays)
        || (a.functionId ? 0 : 1) - (b.functionId ? 0 : 1)
        || b.positions.size - a.positions.size)
      .map((t) => ({
        function_id: t.functionId,
        function_name: t.proposedName,
        new_function: !t.functionId || undefined,
        level: 'specific',
        days: t.minDays,
        positions: [...t.positions],
        parts_matched: t.parts.size,
        parts_total: totalParts,
        preselected: t.parts.size > 1
          ? (!hasDominant && t.minDays <= PRESELECT_MAX_DAYS + 2) // corroborated: relax the day bar
          : (!hasDominant && !corroborationExists && t.minDays <= PRESELECT_MAX_DAYS),
      }));

    const takenNames = new Set([...clusterNames, ...specifics.map((f) => f.function_name.toLowerCase())]);
    const seasons = [...seasonBest.entries()]
      .filter(([season]) => functionIds.has(season)
        && !existingFnIds.has(functionIds.get(season))
        && !takenNames.has(season.toLowerCase())
        && !isRejected(title.id, functionIds.get(season), season))
      .sort((a, b) => b[1].days - a[1].days)
      .map(([season, s]) => ({
        function_id: functionIds.get(season),
        function_name: season,
        level: 'season',
        days: s.days,
        share: Math.round(s.share * 100) / 100,
        positions: [...s.positions],
        preselected: !hasDominant && s.days >= SEASON_PRESELECT_DAYS && s.share >= SEASON_PRESELECT_SHARE,
      }));

    // AUTO-ACCEPT: on a multipart motet, when EVERY part appears in the
    // same day's propers (respond + verse both present), the match is as
    // strong as evidence gets — link it without review. Existing functions
    // only (never auto-create), rejections already filtered above.
    const autoIds = new Set();
    if (totalParts > 1) {
      const fullMatches = [...clusters, ...specifics].filter((f) =>
        f.function_id && f.parts_matched === totalParts);
      for (const fm of fullMatches) {
        autoIds.add(fm.function_id);
        autoAccepted++;
        if (DRY_RUN) {
          console.log(`  AUTO ${title.id} "${title.text.slice(0, 45)}" -> ${fm.function_name} (all ${totalParts} parts)`);
          continue;
        }
        await pool.query(
          `INSERT INTO functions_titles (function_id, title_id)
           SELECT $1, $2
           WHERE NOT EXISTS (SELECT 1 FROM functions_titles WHERE function_id = $1 AND title_id = $2)`,
          [fm.function_id, title.id]
        );
        // Record it as an accepted suggestion so it shows in the queue's
        // history and is never re-proposed.
        await pool.query(
          `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key, status, reviewed_at)
           VALUES ('title_function', $1, $2, 1.0, 'divinumofficium', $3, 'accepted', NOW())
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [
            title.id,
            JSON.stringify({
              function_id: fm.function_id,
              function_name: fm.function_name,
              positions: fm.positions,
              days: fm.days,
              parts_matched: fm.parts_matched,
              parts_total: fm.parts_total,
              matched_incipit: [...matched][0] || null,
              citations: [...citations],
              auto_accepted: true,
            }),
            `tfa:${title.id}:${fm.function_id}`,
          ]
        );
      }
    }

    const functions = [...clusters, ...specifics, ...seasons]
      .filter((f) => !f.function_id || !autoIds.has(f.function_id))
      .slice(0, MAX_FUNCTIONS_PER_CARD);
    if (!functions.length) {
      // Everything auto-accepted: clear any pending card left from earlier
      // runs so the reviewer isn't asked about a decision already made.
      if (autoIds.size && !DRY_RUN) {
        await pool.query(
          `DELETE FROM suggestions WHERE dedupe_key = $1 AND status = 'pending'`,
          [`tfm:${title.id}`]
        );
      }
      continue;
    }
    // A NEW-feast proposal is never preticked when there are alternatives —
    // creating a function should be a deliberate reviewer choice.
    if (functions.length > 1) {
      for (const f of functions) if (f.new_function) f.preselected = false;
    }
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
          part_days: [...partDays.entries()].map(([incipit, info]) => ({
            incipit,
            days: info.days,
            breakdown: info.breakdown,
            more: info.more || undefined,
          })),
        }),
        score,
        `tfm:${title.id}`,
      ]
    );
    if (result.rowCount) inserted++;
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted/refreshed'} ${inserted} suggestions; ${autoAccepted} all-parts matches auto-${DRY_RUN ? 'acceptable' : 'accepted'}.`);

  if (!DRY_RUN) await backfillLinkEvidence(corpus, functionIds);
  await pool.end();
}

/**
 * Annotate title->function links with the DO text they match (text +
 * citation + position) — the public search shows these as tooltips.
 * Only fills rows with no evidence yet; links with no DO basis (manual
 * cataloguing, non-liturgical categories) are left NULL.
 */
async function backfillLinkEvidence(corpus, functionIds) {
  const idToName = new Map([...functionIds.entries()].map(([name, id]) => [id, name]));
  const rows = await pool.query(`
    SELECT ft.function_id, ft.title_id, t.text
    FROM functions_titles ft JOIN titles t ON t.id = ft.title_id
    WHERE ft.match_text IS NULL
  `);
  if (!rows.rows.length) return;

  // Invert the corpus: function name -> first-two-words -> matching units.
  const byFn = new Map();
  for (const unit of corpus.units.values()) {
    for (const place of unit.places) {
      if (!place.fn) continue;
      let m = byFn.get(place.fn);
      if (!m) { m = new Map(); byFn.set(place.fn, m); }
      const f2 = unit.words.slice(0, 2).join(' ');
      if (!m.has(f2)) m.set(f2, []);
      m.get(f2).push({ unit, place });
    }
  }

  let updated = 0;
  for (const row of rows.rows) {
    const fnName = idToName.get(row.function_id);
    const m = fnName && byFn.get(fnName);
    if (!m) continue;
    let best = null;
    for (const part of splitIncipitParts(row.text).map(foldSpelling)) {
      const words = part.split(' ').filter(Boolean);
      if (words.length < 2) continue;
      for (const cand of (m.get(words.slice(0, 2).join(' ')) || [])) {
        const n = Math.min(words.length, cand.unit.words.length);
        let ok = true;
        for (let i = 0; i < n; i++) if (words[i] !== cand.unit.words[i]) { ok = false; break; }
        if (ok && (!best || n > best.n)) best = { unit: cand.unit, place: cand.place, n };
      }
    }
    if (!best) continue;
    await pool.query(
      `UPDATE functions_titles SET match_text = $1, match_citation = $2, match_position = $3
       WHERE function_id = $4 AND title_id = $5`,
      [
        best.unit.sample.slice(0, 200),
        best.unit.citation || null,
        `${best.place.position} — ${best.place.dayLabel}`,
        row.function_id,
        row.title_id,
      ]
    );
    updated++;
  }
  console.log(`Evidence backfill: ${updated} of ${rows.rows.length} unannotated links matched to DO texts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
