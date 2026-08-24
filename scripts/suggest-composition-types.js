/**
 * Type-suggesting matcher: proposes a composition type for titles whose
 * settings are (partly) untyped. One card per title; accepting sets the
 * type on every setting of that title that is STILL untyped at accept time
 * (manual types are never overwritten), and the reviewer can pick a
 * different type on the card before accepting.
 *
 * Rules, strongest first:
 *   1. CONSENSUS — some settings of the title are already typed and they
 *      all agree: propose that type for the untyped ones. Self-bootstraps
 *      from the ~8k typed compositions (covers hymns, responsories etc.
 *      without any dictionary). Titles whose typed settings DISAGREE are
 *      skipped — that's a cataloguer judgment, not a bulk fill.
 *   2. KEYWORDS — title text implies the genre: missa/mass/messe/misa ->
 *      Mass (requiem / missa pro defunctis -> Requiem first), passio ->
 *      Passion, lamentatio -> Lamentation, litaniae -> Litany, alleluia ->
 *      Alleluia, magnificat / nunc dimittis -> Alternatim psalm/canticle.
 *   3. TONE — a recorded tone is a psalm tone: when EVERY untyped setting
 *      of the title carries one, propose Alternatim psalm/canticle (mixed
 *      titles are skipped).
 *
 * Usage: node scripts/suggest-composition-types.js [maxCards] [--dry-run]
 * Local SQL only, cheap manual run. Dedupe key ctype:{titleId}:{typeId} —
 * a rejected proposal is never re-made; still-pending cards are refreshed
 * in place; pending cards for titles that have since become fully typed
 * are deleted.
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_CARDS = Math.min(Math.max(parseInt(args[0], 10) || 500, 1), 5000);

// Keyword rules in priority order (first hit wins). Type names must match
// composition_types.name in the database exactly.
const KEYWORD_RULES = [
  { type: 'Requiem/Burial service', score: 0.85, re: /\brequiem\b|missa\s+pro\s+defunctis|officium\s+defunctorum|burial/i },
  { type: 'Mass', score: 0.85, re: /\bmissa\b|\bmass\b|\bmesse\b|\bmisa\b/i },
  { type: 'Passion', score: 0.85, re: /\bpassio\b|\bpassion\b/i },
  { type: 'Lamentation', score: 0.85, re: /\blamentatio(n?e?s)?\b/i },
  { type: 'Litany', score: 0.85, re: /\blitan(y|ies|iae?|ia)\b/i },
  { type: 'Alleluia', score: 0.85, re: /^\{?alleluia\b/i },
  { type: 'Alternatim psalm/canticle', score: 0.75, re: /\bmagnificat\b|\bnunc\s+dimittis\b/i },
];

async function main() {
  console.log(`Proposing composition types for untyped settings (max ${MAX_CARDS})${DRY_RUN ? ' [dry run]' : ''}...`);

  // composition_types.id is bigint — pg hands it back as a string, so
  // normalize to numbers once here (payloads and comparisons stay numeric).
  const types = await pool.query('SELECT id, name FROM composition_types');
  const typeIdByName = new Map(types.rows.map((r) => [r.name, Number(r.id)]));
  for (const rule of KEYWORD_RULES) {
    if (!typeIdByName.has(rule.type)) {
      console.warn(`WARNING: type "${rule.type}" not found in composition_types — rule skipped.`);
    }
  }

  // Housekeeping: a pending card whose title no longer has any untyped
  // setting (typed manually, or via an earlier accept) has nothing to do.
  if (!DRY_RUN) {
    const stale = await pool.query(`
      DELETE FROM suggestions s
      WHERE s.kind = 'composition_type' AND s.status IN ('pending', 'skipped')
        AND NOT EXISTS (
          SELECT 1 FROM compositions c
          WHERE c.title_id = s.title_id AND c.composition_type_id IS NULL
        )
    `);
    if (stale.rowCount) console.log(`Removed ${stale.rowCount} stale card(s) for titles already fully typed.`);
  }

  const result = await pool.query(`
    SELECT t.id AS title_id, t.text,
           COUNT(*) FILTER (WHERE c.composition_type_id IS NULL)::int AS untyped,
           COUNT(*) FILTER (WHERE c.composition_type_id IS NOT NULL)::int AS typed,
           ARRAY(SELECT DISTINCT x.composition_type_id FROM compositions x
                 WHERE x.title_id = t.id AND x.composition_type_id IS NOT NULL) AS typed_types,
           bool_and(COALESCE(cardinality(c.tone), 0) > 0)
             FILTER (WHERE c.composition_type_id IS NULL) AS untyped_all_toned
    FROM titles t
    JOIN compositions c ON c.title_id = t.id
    GROUP BY t.id, t.text
    HAVING COUNT(*) FILTER (WHERE c.composition_type_id IS NULL) > 0
    ORDER BY t.id
  `);
  console.log(`${result.rows.length} title(s) with untyped settings.`);

  const typeNameById = new Map(types.rows.map((r) => [Number(r.id), r.name]));
  const proposals = [];
  let conflicted = 0;
  for (const r of result.rows) {
    let typeId = null;
    let score = 0;
    let rule = null;
    let evidence = null;

    if (r.typed_types.length === 1) {
      typeId = Number(r.typed_types[0]);
      score = Math.min(0.95, 0.75 + 0.05 * r.typed);
      rule = 'consensus';
      evidence = `${r.typed} setting${r.typed === 1 ? ' is' : 's are'} already typed ${typeNameById.get(typeId)}`;
    } else if (r.typed_types.length > 1) {
      conflicted++;
      continue; // typed settings disagree — not a bulk decision
    } else {
      for (const kw of KEYWORD_RULES) {
        if (kw.re.test(r.text) && typeIdByName.has(kw.type)) {
          typeId = typeIdByName.get(kw.type);
          score = kw.score;
          rule = 'keyword';
          evidence = `title implies ${kw.type}`;
          break;
        }
      }
      if (!typeId && r.untyped_all_toned && typeIdByName.has('Alternatim psalm/canticle')) {
        typeId = typeIdByName.get('Alternatim psalm/canticle');
        score = 0.7;
        rule = 'tone';
        evidence = `all ${r.untyped} untyped setting${r.untyped === 1 ? '' : 's'} carry a psalm tone`;
      }
    }
    if (!typeId) continue;

    proposals.push({
      title_id: r.title_id,
      title_text: r.text,
      type_id: typeId,
      type_name: typeNameById.get(typeId),
      score,
      rule,
      evidence,
      untyped: r.untyped,
      typed: r.typed,
    });
  }
  if (conflicted) console.log(`${conflicted} title(s) skipped: their typed settings disagree.`);

  proposals.sort((a, b) => b.score - a.score || a.title_id - b.title_id);
  let inserted = 0;
  for (const p of proposals) {
    if (inserted >= MAX_CARDS) break;
    if (DRY_RUN) {
      console.log(`  [${p.score.toFixed(2)}] "${p.title_text}" -> ${p.type_name} (${p.rule}: ${p.evidence}; ${p.untyped} untyped)`);
      inserted++;
      continue;
    }
    const insert = await pool.query(
      `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
       VALUES ('composition_type', $1, $2, $3, 'type-matcher', $4)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET payload = EXCLUDED.payload, score = EXCLUDED.score
         WHERE suggestions.status = 'pending'`,
      [
        p.title_id,
        JSON.stringify({
          type_id: p.type_id,
          type_name: p.type_name,
          rule: p.rule,
          evidence: p.evidence,
          untyped_count: p.untyped,
          typed_count: p.typed,
        }),
        p.score,
        `ctype:${p.title_id}:${p.type_id}`,
      ]
    );
    if (insert.rowCount) inserted++;
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted/refreshed'} ${inserted} type suggestion(s) (of ${proposals.length} proposal(s)).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
