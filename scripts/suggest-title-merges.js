/**
 * One-shot matcher: find near-duplicate titles (pg_trgm similarity) and write
 * them to the review queue as 'title_merge' suggestions. Accepting a
 * suggestion merges the two titles (reviewer picks which survives); nothing
 * is applied automatically.
 *
 * Usage: node scripts/suggest-title-merges.js [threshold] [maxPairs] [--dry-run]
 *   threshold  minimum trigram similarity 0..1 (default 0.9)
 *   maxPairs   cap on suggestions written per run (default 500)
 *
 * No external APIs, so re-running is cheap; dedupe_key prevents duplicate
 * queue entries. Deliberate part-variants like "Magnificat [I]" vs
 * "Magnificat [II]" are excluded.
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const THRESHOLD = Math.min(Math.max(parseFloat(args[0]) || 0.9, 0.5), 1);
const MAX_PAIRS = Math.min(Math.max(parseInt(args[1], 10) || 500, 1), 5000);

// Same convention as the titles editor: [I], [II]... mark deliberate
// multi-setting variants of the same base title, not duplicates.
const hasPartBracket = (s) => /\[[IVX]+\]/.test(String(s || ''));
const baseText = (s) => String(s || '').replace(/\s*\[[IVX]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

// Multipart motets are "Prima pars - Secunda pars". A single-part title and
// a multipart one (or 2-part vs 3-part) are structurally different pieces
// even when the trigrams are near-identical ("Haec dicit Dominus" vs "Haec
// dicit Dominus - Haec dicit Dominus"), so those pairs are not suggested.
const partCount = (s) => String(s || '').split(/\s+[-\u2013\u2014]\s+/).length;

async function main() {
  console.log(`Finding title pairs with similarity >= ${THRESHOLD} (max ${MAX_PAIRS})${DRY_RUN ? ' [dry run]' : ''}...`);

  // The % operator uses the trigram GIN index (idx_titles_text_trgm); the
  // similarity() filter then applies the real threshold. Language must not
  // conflict, and both titles must be in actual use.
  const pairs = await pool.query(`
    SELECT a.id AS a_id, a.text AS a_text, b.id AS b_id, b.text AS b_text,
           ROUND(similarity(a.text, b.text)::numeric, 2) AS sim,
           (SELECT COUNT(*) FROM compositions c WHERE c.title_id = a.id) AS a_comps,
           (SELECT COUNT(*) FROM compositions c WHERE c.title_id = b.id) AS b_comps,
           (SELECT COUNT(*) FROM functions_titles ft WHERE ft.title_id = a.id) AS a_fns,
           (SELECT COUNT(*) FROM functions_titles ft WHERE ft.title_id = b.id) AS b_fns
    FROM titles a
    JOIN titles b ON a.id < b.id AND a.text % b.text
    WHERE similarity(a.text, b.text) >= $1
      AND (a.language IS NULL OR b.language IS NULL OR a.language = b.language)
    ORDER BY similarity(a.text, b.text) DESC, a.id, b.id
    LIMIT $2
  `, [THRESHOLD, MAX_PAIRS * 2]);

  let inserted = 0;
  let considered = 0;

  for (const p of pairs.rows) {
    if (inserted >= MAX_PAIRS) break;

    // Skip deliberate part-variants ("Magnificat [I]" / "Magnificat [II]" /
    // bare "Magnificat"): same base text but distinguished by brackets.
    if ((hasPartBracket(p.a_text) || hasPartBracket(p.b_text)) &&
        baseText(p.a_text).toLowerCase() === baseText(p.b_text).toLowerCase()) {
      continue;
    }
    // Skip structurally different pieces (single-part vs multipart).
    if (partCount(p.a_text) !== partCount(p.b_text)) continue;
    considered++;

    // Default primary: more compositions, then more function links, then the
    // older (lower) id. The reviewer can flip this in the queue.
    const aScore = [parseInt(p.a_comps, 10), parseInt(p.a_fns, 10), -p.a_id];
    const bScore = [parseInt(p.b_comps, 10), parseInt(p.b_fns, 10), -p.b_id];
    const aPrimary = aScore[0] !== bScore[0] ? aScore[0] > bScore[0]
      : aScore[1] !== bScore[1] ? aScore[1] > bScore[1]
      : p.a_id < p.b_id;

    const primary = aPrimary
      ? { id: p.a_id, text: p.a_text, comps: p.a_comps, fns: p.a_fns }
      : { id: p.b_id, text: p.b_text, comps: p.b_comps, fns: p.b_fns };
    const other = aPrimary
      ? { id: p.b_id, text: p.b_text, comps: p.b_comps, fns: p.b_fns }
      : { id: p.a_id, text: p.a_text, comps: p.a_comps, fns: p.a_fns };

    if (DRY_RUN) {
      console.log(`  [${p.sim}] "${primary.text}" (#${primary.id}, ${primary.comps} comps) <= "${other.text}" (#${other.id}, ${other.comps} comps)`);
      inserted++;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
       VALUES ('title_merge', $1, $2, $3, 'pg_trgm', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        primary.id,
        JSON.stringify({
          other_title_id: other.id,
          primary_text: primary.text,
          other_text: other.text,
          similarity: Number(p.sim),
        }),
        Number(p.sim),
        `tm:${Math.min(p.a_id, p.b_id)}:${Math.max(p.a_id, p.b_id)}`,
      ]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  [${p.sim}] "${primary.text}" (#${primary.id}) <= "${other.text}" (#${other.id})`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} merge suggestions (${considered} pairs considered, ${pairs.rows.length} fetched).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
