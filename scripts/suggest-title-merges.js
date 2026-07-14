/**
 * One-shot matcher: find duplicate titles and write them to the review queue
 * as 'title_merge' suggestions. Accepting merges the two titles (reviewer
 * picks which survives); nothing is applied automatically.
 *
 * Match rule: WORD ORDER IS SIGNIFICANT (word-order variants are legitimate
 * different pieces). Two titles are merge candidates only when, after
 * normalizing case / punctuation / accents / i-j / u-v spelling, one is
 * IDENTICAL to the other or a word-for-word PREFIX of it (one incipit simply
 * quotes more of the first line, e.g. "Specie tua et pulchritudine" vs
 * "Specie tua et pulchritudine tua").
 *
 * Usage: node scripts/suggest-title-merges.js [maxPairs] [--dry-run]
 * No external APIs, so re-running is cheap; dedupe_key prevents duplicate
 * queue entries. Deliberate part-variants like "Magnificat [I]" vs
 * "Magnificat [II]" and single-part vs multipart titles are excluded.
 */
import { pool } from '../src/db.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAIRS = Math.min(Math.max(parseInt(args[0], 10) || 500, 1), 5000);
// A one-word prefix ("Alleluia" vs "Alleluia dies sanctificatus") is far too
// weak evidence; require at least this many shared leading words.
const MIN_PREFIX_WORDS = 2;

// Same convention as the titles editor: [I], [II]... mark deliberate
// multi-setting variants of the same base title, not duplicates.
const hasPartBracket = (s) => /\[[IVX]+\]/.test(String(s || ''));
const bracketStripped = (s) => String(s || '').replace(/\s*\[[IVX]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

// Multipart motets are "Prima pars - Secunda pars". A single-part title and
// a multipart one are structurally different pieces; the part separator is
// kept as a token so prefixes can't silently cross a part boundary.
const partCount = (s) => String(s || '').split(/\s+[-\u2013\u2014]\s+/).length;

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+[-\u2013\u2014]\s+/g, ' | ')          // keep part boundaries
    .replace(/[^a-z0-9|\s]/g, ' ')                     // digits stay: "Mass for 3 voices" != "for 4"
    .replace(/j/g, 'i').replace(/v/g, 'u')             // mediaeval spelling
    .split(/\s+/)
    .filter(Boolean);
}

async function main() {
  console.log(`Finding equal/prefix duplicate titles (max ${MAX_PAIRS})${DRY_RUN ? ' [dry run]' : ''}...`);

  const all = await pool.query(`
    SELECT t.id, t.text, t.language,
           (SELECT COUNT(*) FROM compositions c WHERE c.title_id = t.id) AS comps,
           (SELECT COUNT(*) FROM functions_titles ft WHERE ft.title_id = t.id) AS fns
    FROM titles t
    ORDER BY t.id
  `);

  const entries = all.rows.map((r) => ({
    id: r.id,
    text: r.text,
    language: r.language,
    comps: parseInt(r.comps, 10),
    fns: parseInt(r.fns, 10),
    words: normalizeWords(r.text),
    parts: partCount(r.text),
  })).filter((e) => e.words.length >= MIN_PREFIX_WORDS);

  // Sort by normalized text: any title whose word list is a prefix of
  // another's sorts immediately before it (and equals sort adjacent), so a
  // single forward scan per entry finds all candidates.
  entries.forEach((e) => { e.norm = e.words.join(' '); });
  entries.sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));

  const pairs = [];
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j];
      if (b.norm !== a.norm && !b.norm.startsWith(a.norm + ' ')) break;
      // Language conflict (both set, different) → different pieces.
      if (a.language !== null && b.language !== null && a.language !== b.language) continue;
      // Structurally different (single vs multipart) → skip.
      if (a.parts !== b.parts) continue;
      // Deliberate [I]/[II] variants of the same base text → skip.
      if ((hasPartBracket(a.text) || hasPartBracket(b.text)) &&
          bracketStripped(a.text).toLowerCase() === bracketStripped(b.text).toLowerCase()) {
        continue;
      }
      // Prefix whose extra words are purely numbers ("In nomine" vs
      // "In nomine 1") is deliberate numbering, not a duplicate.
      const extra = b.words.slice(a.words.length);
      if (extra.length && extra.every((w) => /^\d+$/.test(w))) continue;
      // Exact normalized match scores 1; a prefix scores by how much of the
      // longer incipit the shorter one covers.
      const score = Math.round((a.words.length / b.words.length) * 100) / 100;
      pairs.push({ a, b, score });
    }
  }

  pairs.sort((x, y) => y.score - x.score || x.a.id - y.a.id);

  let inserted = 0;
  for (const { a, b, score } of pairs) {
    if (inserted >= MAX_PAIRS) break;

    // Default primary: more compositions, then more function links, then the
    // longer (more complete) incipit. The reviewer can flip this in the queue.
    const aPrimary = a.comps !== b.comps ? a.comps > b.comps
      : a.fns !== b.fns ? a.fns > b.fns
      : a.words.length !== b.words.length ? a.words.length > b.words.length
      : a.id < b.id;
    const primary = aPrimary ? a : b;
    const other = aPrimary ? b : a;

    if (DRY_RUN) {
      console.log(`  [${score}] "${primary.text}" (#${primary.id}, ${primary.comps} comps) <= "${other.text}" (#${other.id}, ${other.comps} comps)`);
      inserted++;
      continue;
    }
    const result = await pool.query(
      `INSERT INTO suggestions (kind, title_id, payload, score, source, dedupe_key)
       VALUES ('title_merge', $1, $2, $3, 'prefix-match', $4)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        primary.id,
        JSON.stringify({
          other_title_id: other.id,
          primary_text: primary.text,
          other_text: other.text,
          match: score === 1 ? 'identical after normalization' : 'shorter incipit is a prefix of the longer',
        }),
        score,
        `tm:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`,
      ]
    );
    if (result.rowCount) {
      inserted++;
      console.log(`  [${score}] "${primary.text}" (#${primary.id}) <= "${other.text}" (#${other.id})`);
    }
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted'} ${inserted} merge suggestions (${pairs.length} candidate pairs).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
