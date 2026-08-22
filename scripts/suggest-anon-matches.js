/**
 * Anon-resolver matcher: find pairs of compositions in DIFFERENT groups that
 * look like the same piece — same title, identical clef combination in at
 * least one catalogued source each, and no conflicting attributes (type,
 * tone, even/odd, voices) — where at least one side is anonymous. Writes
 * 'anon_match' suggestions to the review queue with links to the source
 * images so a reviewer can compare the actual music.
 *
 * Chronology (hard filter): a pair is IMPOSSIBLE when the anon side sits in
 * a source whose latest possible date is before every named-side composer
 * was born — such pairs are never proposed, and any pending card for them
 * is removed on the next run. Shared source (hard filter): two candidates
 * appearing in the SAME source are different pieces — the chance of one
 * work being copied twice in a source, once unattributed, without the
 * cataloguer noticing is vanishingly small. Provenance (soft weight): the named composer
 * already having attributed works in the anon's source (or another source
 * from the same town) boosts the score and shows as a badge; its absence
 * costs nothing (plenty of Palestrina in Spanish sources he never visited).
 *
 * Accepting GROUPS the two (the anonymous setting moves into the kept
 * group; an emptied group's editions/recordings follow it). Rejecting
 * permanently records that the two are NOT the same piece — the dedupe key
 * stays behind and the pair is never proposed again.
 *
 * Usage: node scripts/suggest-anon-matches.js [maxPairs] [--dry-run]
 * Local SQL only (no APIs), cheap to re-run; re-runs refresh the score and
 * evidence on still-pending cards in place.
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAIRS = Math.min(Math.max(parseInt(args[0], 10) || 500, 1), 5000);
// A title that produces a blizzard of pairs (many anonymous settings sharing
// a standard clef set) is probably a generic text where clef identity is
// coincidence — cap what one title may contribute, best-scored pairs first.
const MAX_PAIRS_PER_TITLE = 20;

async function main() {
  console.log(`Finding anon compositions matching another group's setting (max ${MAX_PAIRS})${DRY_RUN ? ' [dry run]' : ''}...`);

  // "named" = has a composer other than Anonymous (id 23).
  // Clef combos come from the trigger-maintained sorted_clef_combination_required
  // column: an identical non-optional clef set in at least one source on each
  // side is required.
  const result = await pool.query(`
    WITH comp AS (
      SELECT c.id, c.group_id, c.title_id, c.composition_type_id, c.tone,
             c.even_odd, c.number_of_voices, c.composer_id_list,
             EXISTS (
               SELECT 1 FROM unnest(COALESCE(c.composer_id_list, '{}'::integer[])) AS u(x)
               WHERE x IS NOT NULL AND x != 23
             ) AS named,
             ARRAY(
               SELECT DISTINCT i.sorted_clef_combination_required
               FROM inclusions i
               WHERE i.composition_id = c.id
                 AND i.sorted_clef_combination_required IS NOT NULL
                 AND i.sorted_clef_combination_required <> ''
             ) AS combos
      FROM compositions c
      WHERE c.group_id IS NOT NULL AND c.title_id IS NOT NULL
    )
    SELECT a.id AS a_id, a.group_id AS a_group, a.named AS a_named,
           b.id AS b_id, b.group_id AS b_group, b.named AS b_named,
           a.title_id, t.text AS title_text,
           a.composition_type_id AS a_type, b.composition_type_id AS b_type,
           a.tone AS a_tone, b.tone AS b_tone,
           a.even_odd AS a_eo, b.even_odd AS b_eo,
           a.composer_id_list AS a_composers, b.composer_id_list AS b_composers,
           ARRAY(SELECT unnest(a.combos) INTERSECT SELECT unnest(b.combos)) AS shared_combos,
           (SELECT COUNT(*) FROM inclusions i WHERE i.composition_id = a.id) AS a_incl,
           (SELECT COUNT(*) FROM inclusions i WHERE i.composition_id = b.id) AS b_incl,
           (SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'town', s.town,
                                              'from_year', s.from_year, 'to_year', s.to_year))
              FROM inclusions i JOIN sources s ON s.id = i.source_id
             WHERE i.composition_id = a.id) AS a_sources,
           (SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'town', s.town,
                                              'from_year', s.from_year, 'to_year', s.to_year))
              FROM inclusions i JOIN sources s ON s.id = i.source_id
             WHERE i.composition_id = b.id) AS b_sources
    FROM comp a
    JOIN comp b
      ON b.title_id = a.title_id
     AND b.id > a.id
     AND b.group_id <> a.group_id
    JOIN titles t ON t.id = a.title_id
    WHERE NOT (a.named AND b.named)                -- at least one side is anon
      AND a.combos && b.combos                     -- identical clef set in some source each
      AND (a.number_of_voices IS NULL OR b.number_of_voices IS NULL
           OR a.number_of_voices = b.number_of_voices)
      AND (a.composition_type_id IS NULL OR b.composition_type_id IS NULL
           OR a.composition_type_id = b.composition_type_id)
      AND (COALESCE(cardinality(a.tone), 0) = 0 OR COALESCE(cardinality(b.tone), 0) = 0
           OR a.tone && b.tone)
      AND (a.even_odd IS NULL OR b.even_odd IS NULL OR a.even_odd = b.even_odd)
    ORDER BY a.id, b.id
  `);

  console.log(`${result.rows.length} candidate pair(s) found.`);

  // Chronology + provenance context for the named side: birth years rule
  // out impossible matches; a composer's attributed presence in the anon's
  // source (or another source from the same town) strengthens a match.
  const namedIds = new Set();
  result.rows.forEach((r) => {
    [...(r.a_named ? r.a_composers || [] : []), ...(r.b_named ? r.b_composers || [] : [])]
      .forEach((id) => { if (id && id !== 23) namedIds.add(id); });
  });
  const composerBirth = new Map();      // composer id -> birth year (from_year)
  const composerSources = new Map();    // composer id -> Set(source ids with his attributed works)
  const composerTowns = new Map();      // composer id -> Set(normalized towns of those sources)
  if (namedIds.size) {
    const info = await pool.query(
      'SELECT id, from_year FROM composers WHERE id = ANY($1)',
      [[...namedIds]]
    );
    info.rows.forEach((r) => { if (Number.isInteger(r.from_year)) composerBirth.set(r.id, r.from_year); });
    const attributed = await pool.query(
      `SELECT DISTINCT u.cid, i.source_id, LOWER(TRIM(s.town)) AS town
       FROM compositions c
       CROSS JOIN LATERAL unnest(COALESCE(c.composer_id_list, '{}'::integer[])) AS u(cid)
       JOIN inclusions i ON i.composition_id = c.id
       JOIN sources s ON s.id = i.source_id
       WHERE u.cid = ANY($1)`,
      [[...namedIds]]
    );
    attributed.rows.forEach((r) => {
      if (!composerSources.has(r.cid)) composerSources.set(r.cid, new Set());
      composerSources.get(r.cid).add(r.source_id);
      if (r.town) {
        if (!composerTowns.has(r.cid)) composerTowns.set(r.cid, new Set());
        composerTowns.get(r.cid).add(r.town);
      }
    });
  }

  // Impossible pairs: (1) the two candidates appear in the SAME source —
  // one work copied twice in a source, once unattributed, unnoticed at
  // cataloguing time is vanishingly unlikely, so they are different pieces;
  // (2) the anon side sits in a source whose LATEST possible date is before
  // every named-side composer was born — the piece existed before he did
  // (only applies when all named composers have known births and the source
  // is dated). Provenance never excludes (plenty of Palestrina in Spain),
  // it only boosts.
  function pairContext(r) {
    const sides = [
      { named: r.a_named, comps: r.a_composers || [], sources: r.a_sources || [] },
      { named: r.b_named, comps: r.b_composers || [], sources: r.b_sources || [] },
    ];
    const aSourceIds = new Set((r.a_sources || []).map((s) => s.id));
    if ((r.b_sources || []).some((s) => aSourceIds.has(s.id))) {
      return { impossible: true, provenance: null, provenance_detail: null };
    }
    const named = sides.find((s) => s.named);
    const anon = sides.find((s) => !s.named);
    if (!named || !anon) return { impossible: false, provenance: null, provenance_detail: null };
    const compIds = named.comps.filter((id) => id && id !== 23);
    const births = compIds.map((id) => composerBirth.get(id)).filter((v) => Number.isInteger(v));
    let impossible = false;
    if (compIds.length && births.length === compIds.length) {
      const earliestBirth = Math.min(...births);
      impossible = anon.sources.some((s) => {
        const latest = Number.isInteger(s.to_year) ? s.to_year : s.from_year;
        return Number.isInteger(latest) && latest < earliestBirth;
      });
    }
    let provenance = null;
    let provenance_detail = null;
    const srcUnion = new Set();
    const townUnion = new Set();
    compIds.forEach((id) => {
      (composerSources.get(id) || []).forEach((x) => srcUnion.add(x));
      (composerTowns.get(id) || []).forEach((x) => townUnion.add(x));
    });
    const sameSource = anon.sources.filter((s) => srcUnion.has(s.id));
    if (sameSource.length) {
      provenance = 'same_source';
      provenance_detail = [...new Set(sameSource.map((s) => s.code))];
    } else {
      const sameTown = anon.sources.filter((s) => s.town && townUnion.has(String(s.town).trim().toLowerCase()));
      if (sameTown.length) {
        provenance = 'same_town';
        provenance_detail = [...new Set(sameTown.map((s) => s.town))];
      }
    }
    return { impossible, provenance, provenance_detail };
  }

  const possible = [];
  const impossibleKeys = [];
  for (const r of result.rows) {
    const ctx = pairContext(r);
    if (ctx.impossible) {
      impossibleKeys.push(`am:${r.a_id}:${r.b_id}`);
      continue;
    }
    r.provenance = ctx.provenance;
    r.provenance_detail = ctx.provenance_detail;
    possible.push(r);
  }
  if (impossibleKeys.length) {
    console.log(`${impossibleKeys.length} pair(s) excluded as impossible (shared source, or a source of the anon predates the composer's birth).`);
    if (!DRY_RUN) {
      // Earlier runs may have queued pairs the date check now rules out.
      const del = await pool.query(
        `DELETE FROM suggestions WHERE dedupe_key = ANY($1) AND status IN ('pending', 'skipped')`,
        [impossibleKeys]
      );
      if (del.rowCount) console.log(`Removed ${del.rowCount} now-impossible pending suggestion(s) from the queue.`);
    }
  }

  // Ambiguity: how many candidate partners each composition has. An anon
  // whose ONLY plausible match is one named setting is the gold case; a
  // generic text (Magnificat in a standard clef set...) matches dozens of
  // settings pairwise and is unreviewable — those pairs are dropped.
  const degree = new Map();
  possible.forEach((r) => {
    degree.set(r.a_id, (degree.get(r.a_id) || 0) + 1);
    degree.set(r.b_id, (degree.get(r.b_id) || 0) + 1);
  });
  const MAX_DEGREE = 5;

  // Corroborating attributes raise confidence; a named side makes the pair
  // more valuable (it resolves the anon to a known piece); a mutually
  // unique match is the strongest signal of all; the composer's attributed
  // presence in the anon's source (or its town) adds provenance weight.
  let dropped = 0;
  const scored = [];
  for (const r of possible) {
    const maxDeg = Math.max(degree.get(r.a_id), degree.get(r.b_id));
    if (maxDeg > MAX_DEGREE) { dropped++; continue; }
    let score = 0.4; // same title + identical clefs
    if (r.a_type !== null && r.b_type !== null) score += 0.1;
    if ((r.a_tone || []).length && (r.b_tone || []).length) score += 0.1;
    if (r.a_eo !== null && r.b_eo !== null) score += 0.05;
    if (r.a_named || r.b_named) score += 0.1;
    if (maxDeg === 1) score += 0.25;       // each side matches ONLY the other
    else if (maxDeg === 2) score += 0.1;
    if (r.provenance === 'same_source') score += 0.1;
    else if (r.provenance === 'same_town') score += 0.05;
    scored.push({
      ...r,
      score: Math.min(1, Math.round(score * 100) / 100),
      a_matches: degree.get(r.a_id),
      b_matches: degree.get(r.b_id),
    });
  }
  if (dropped) console.log(`${dropped} pair(s) dropped as too ambiguous (a side matches more than ${MAX_DEGREE} settings).`);
  scored.sort((x, y) => y.score - x.score || x.a_id - y.a_id);

  let inserted = 0;
  const perTitle = new Map();
  const cappedTitles = new Set();
  for (const r of scored) {
    if (inserted >= MAX_PAIRS) break;
    const seen = (perTitle.get(r.title_id) || 0) + 1;
    perTitle.set(r.title_id, seen);
    if (seen > MAX_PAIRS_PER_TITLE) {
      if (!cappedTitles.has(r.title_id)) {
        cappedTitles.add(r.title_id);
        console.log(`  ~ capping "${r.title_text}" at ${MAX_PAIRS_PER_TITLE} pairs (probably a generic text)`);
      }
      continue;
    }

    // Default kept group: the named side; both anon -> the better-attested
    // side (more catalogued inclusions), then the lower group id.
    const keepA = r.a_named ? true
      : r.b_named ? false
      : parseInt(r.a_incl, 10) !== parseInt(r.b_incl, 10)
        ? parseInt(r.a_incl, 10) > parseInt(r.b_incl, 10)
        : r.a_group < r.b_group;
    const keepGroup = keepA ? r.a_group : r.b_group;

    if (DRY_RUN) {
      const prov = r.provenance ? ` [${r.provenance}: ${(r.provenance_detail || []).join(', ')}]` : '';
      console.log(`  [${r.score}] "${r.title_text}" comp #${r.a_id} (g${r.a_group}${r.a_named ? ', named' : ', anon'}) ~ comp #${r.b_id} (g${r.b_group}${r.b_named ? ', named' : ', anon'}) clefs ${r.shared_combos.join('/')}${prov}`);
      inserted++;
      continue;
    }

    // ON CONFLICT DO UPDATE (pending only): a re-run refreshes the score and
    // evidence on cards nobody has reviewed yet, so scoring improvements
    // reach the queue without touching decided suggestions.
    const insert = await pool.query(
      `INSERT INTO suggestions (kind, group_id, payload, score, source, dedupe_key)
       VALUES ('anon_match', $1, $2, $3, 'anon-matcher', $4)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET payload = EXCLUDED.payload, score = EXCLUDED.score
         WHERE suggestions.status = 'pending'`,
      [
        keepGroup,
        JSON.stringify({
          comp1_id: r.a_id,
          comp2_id: r.b_id,
          keep_group_id: keepGroup,
          title_text: r.title_text,
          shared_clefs: r.shared_combos,
          // Other candidate partners each side has (1 = mutually unique
          // match) — shown on the card as a confidence hint.
          comp1_matches: r.a_matches,
          comp2_matches: r.b_matches,
          // Provenance of the named composer relative to the anon's sources:
          // 'same_source' (attributed works in that very source) or
          // 'same_town' (attributed works in another source from the town).
          provenance: r.provenance || null,
          provenance_detail: r.provenance_detail || null,
        }),
        r.score,
        `am:${r.a_id}:${r.b_id}`,
      ]
    );
    if (insert.rowCount) {
      inserted++;
      console.log(`  [${r.score}] "${r.title_text}" comp #${r.a_id} ~ comp #${r.b_id} (clefs ${r.shared_combos.join('/')})`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} anon-match suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
