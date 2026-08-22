/**
 * Anon-resolver matcher: find pairs of compositions in DIFFERENT groups that
 * look like the same piece — same title, identical clef combination in at
 * least one catalogued source each, and no conflicting attributes (type,
 * tone, even/odd, voices) — where at least one side is anonymous. Writes
 * 'anon_match' suggestions to the review queue with links to the source
 * images so a reviewer can compare the actual music.
 *
 * Accepting GROUPS the two (the anonymous setting moves into the kept
 * group; an emptied group's editions/recordings follow it). Rejecting
 * permanently records that the two are NOT the same piece — the dedupe key
 * stays behind and the pair is never proposed again.
 *
 * Usage: node scripts/suggest-anon-matches.js [maxPairs] [--dry-run]
 * Local SQL only (no APIs), cheap to re-run; ON CONFLICT keeps it idempotent.
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
             c.even_odd, c.number_of_voices,
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
           ARRAY(SELECT unnest(a.combos) INTERSECT SELECT unnest(b.combos)) AS shared_combos,
           (SELECT COUNT(*) FROM inclusions i WHERE i.composition_id = a.id) AS a_incl,
           (SELECT COUNT(*) FROM inclusions i WHERE i.composition_id = b.id) AS b_incl
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

  // Ambiguity: how many candidate partners each composition has. An anon
  // whose ONLY plausible match is one named setting is the gold case; a
  // generic text (Magnificat in a standard clef set...) matches dozens of
  // settings pairwise and is unreviewable — those pairs are dropped.
  const degree = new Map();
  result.rows.forEach((r) => {
    degree.set(r.a_id, (degree.get(r.a_id) || 0) + 1);
    degree.set(r.b_id, (degree.get(r.b_id) || 0) + 1);
  });
  const MAX_DEGREE = 5;

  // Corroborating attributes raise confidence; a named side makes the pair
  // more valuable (it resolves the anon to a known piece); a mutually
  // unique match is the strongest signal of all.
  let dropped = 0;
  const scored = [];
  for (const r of result.rows) {
    const maxDeg = Math.max(degree.get(r.a_id), degree.get(r.b_id));
    if (maxDeg > MAX_DEGREE) { dropped++; continue; }
    let score = 0.4; // same title + identical clefs
    if (r.a_type !== null && r.b_type !== null) score += 0.1;
    if ((r.a_tone || []).length && (r.b_tone || []).length) score += 0.1;
    if (r.a_eo !== null && r.b_eo !== null) score += 0.05;
    if (r.a_named || r.b_named) score += 0.1;
    if (maxDeg === 1) score += 0.25;       // each side matches ONLY the other
    else if (maxDeg === 2) score += 0.1;
    scored.push({
      ...r,
      score: Math.round(score * 100) / 100,
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
      console.log(`  [${r.score}] "${r.title_text}" comp #${r.a_id} (g${r.a_group}${r.a_named ? ', named' : ', anon'}) ~ comp #${r.b_id} (g${r.b_group}${r.b_named ? ', named' : ', anon'}) clefs ${r.shared_combos.join('/')}`);
      inserted++;
      continue;
    }

    const insert = await pool.query(
      `INSERT INTO suggestions (kind, group_id, payload, score, source, dedupe_key)
       VALUES ('anon_match', $1, $2, $3, 'anon-matcher', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
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
