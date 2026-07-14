/**
 * One-shot matcher: groups whose display_title doesn't match any of their
 * compositions' titles (the dashboard's old "groups_title_mismatch" alert).
 * Proposes the most common composition title; all distinct titles ride
 * along as options for the reviewer. Accepting sets groups.display_title.
 * Rejecting keeps the current display title (some are deliberate, e.g. an
 * original madrigal title over sacred contrafact titles).
 *
 * Usage: node scripts/suggest-group-titles.js [--dry-run]
 * Cheap (no APIs); dedupe_key gt:{groupId} prevents duplicates, so a
 * rejected group is never re-suggested even if still mismatched.
 */
import { pool } from '../src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_OPTIONS = 8;

async function main() {
  const groups = await pool.query(`
    SELECT g.id, g.display_title,
           ARRAY_AGG(t.text) AS comp_titles
    FROM groups g
    JOIN compositions c ON c.group_id = g.id
    JOIN titles t ON t.id = c.title_id
    WHERE g.display_title NOT IN (
      SELECT t2.text FROM compositions c2 JOIN titles t2 ON c2.title_id = t2.id
      WHERE c2.group_id = g.id
    )
    GROUP BY g.id, g.display_title
    ORDER BY g.id
  `);

  console.log(`Found ${groups.rows.length} groups with mismatched display titles${DRY_RUN ? ' [dry run]' : ''}...`);
  let inserted = 0;

  for (const g of groups.rows) {
    // Most common composition title wins the proposal; every distinct title
    // is offered as an option in the review card.
    const counts = new Map();
    for (const t of g.comp_titles) counts.set(t, (counts.get(t) || 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const [proposed, proposedCount] = ranked[0];
    const options = ranked.slice(0, MAX_OPTIONS).map(([text]) => text);
    const score = Math.round((proposedCount / g.comp_titles.length) * 100) / 100;

    if (DRY_RUN) {
      inserted++;
      console.log(`  ${g.id} "${g.display_title}" -> "${proposed}"${options.length > 1 ? ` (+${options.length - 1} alt)` : ''} (${Math.round(score * 100)}%)`);
      continue;
    }
    const result = await pool.query(
      `INSERT INTO suggestions (kind, group_id, payload, score, source, dedupe_key)
       VALUES ('group_title', $1, $2, $3, 'catalogue', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        g.id,
        JSON.stringify({
          current_title: g.display_title,
          proposed_title: proposed,
          options,
        }),
        score,
        `gt:${g.id}`,
      ]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  ${g.id} "${g.display_title}" -> "${proposed}" (${Math.round(score * 100)}%)`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} group title suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
