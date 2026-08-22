/**
 * One-shot matcher: groups whose display_title doesn't match any of their
 * compositions' titles (the dashboard's old "groups_title_mismatch" alert).
 *
 * AUTO-FIX (Aug 2026): a group with a SINGLE distinct composition title
 * whose display title starts with the same word (after normalizing case /
 * punctuation / accents / i-j / u-v) is just a spelling/length variant of
 * the same text — the display title is set to the composition title
 * automatically and any pending queue card for the group is resolved in
 * place. Groups already REJECTED by a reviewer are never auto-fixed
 * (rejection = "keep the current display title deliberately").
 *
 * Everything else (completely different first word — typically a known
 * contrafactum whose original we haven't catalogued yet, or a multi-title
 * group) still goes to the review queue: the most common composition title
 * is proposed, all distinct titles ride along as options. Accepting sets
 * groups.display_title; rejecting keeps the current display title.
 *
 * Usage: node scripts/suggest-group-titles.js [--dry-run]
 * Cheap (no APIs); dedupe_key gt:{groupId} prevents duplicates, so a
 * rejected group is never re-suggested even if still mismatched.
 */
import { pool } from '../src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_OPTIONS = 8;

// Same normalization family as the title-merge matcher: case, accents,
// punctuation, mediaeval i/j u/v spelling.
function normFirstWord(text) {
  const words = String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/j/g, 'i').replace(/v/g, 'u')
    .split(/\s+/)
    .filter(Boolean);
  return words[0] || '';
}

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

  // A reviewer rejection means "the current display title is deliberate"
  // (e.g. an original madrigal title over a contrafact) — never auto-fix.
  const rejected = await pool.query(
    `SELECT DISTINCT group_id FROM suggestions
     WHERE kind = 'group_title' AND status = 'rejected' AND group_id IS NOT NULL`
  );
  const rejectedGroups = new Set(rejected.rows.map((r) => r.group_id));

  let inserted = 0;
  let autoFixed = 0;

  for (const g of groups.rows) {
    // Most common composition title wins the proposal; every distinct title
    // is offered as an option in the review card.
    const counts = new Map();
    for (const t of g.comp_titles) counts.set(t, (counts.get(t) || 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const [proposed, proposedCount] = ranked[0];
    const options = ranked.slice(0, MAX_OPTIONS).map(([text]) => text);
    const score = Math.round((proposedCount / g.comp_titles.length) * 100) / 100;

    // Auto-fix: one distinct composition title + same first word = the same
    // text, just a spelling/length variant. Set the display title outright.
    const firstWord = normFirstWord(g.display_title);
    if (counts.size === 1 && firstWord && firstWord === normFirstWord(proposed) &&
        !rejectedGroups.has(g.id)) {
      autoFixed++;
      if (DRY_RUN) {
        console.log(`  AUTO ${g.id} "${g.display_title}" -> "${proposed}"`);
        continue;
      }
      await pool.query(
        'UPDATE groups SET display_title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [proposed, g.id]
      );
      // Resolve any pending queue card for this group in place.
      await pool.query(
        `UPDATE suggestions
         SET status = 'accepted', reviewed_at = NOW(),
             payload = payload || '{"auto_accepted": true}'::jsonb
         WHERE kind = 'group_title' AND group_id = $1 AND status IN ('pending', 'skipped')`,
        [g.id]
      );
      console.log(`  AUTO ${g.id} "${g.display_title}" -> "${proposed}"`);
      continue;
    }

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

  console.log(`Done. ${DRY_RUN ? 'Would auto-fix' : 'Auto-fixed'} ${autoFixed} display titles; ${DRY_RUN ? 'would insert' : 'inserted'} ${inserted} group title suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
