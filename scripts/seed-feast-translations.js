/**
 * Populate/refresh the feast_translations dictionary from the Divinum
 * Officium corpus: one row per distinct day label, with the matcher's
 * current best guess as the English name. Reviewer-curated rows
 * (source = 'manual') are NEVER overwritten — this only adds new labels
 * and refreshes the guesses/day counts of untouched 'auto' rows.
 *
 * Run after vendoring new DO data or improving the auto-translation:
 *   node scripts/seed-feast-translations.js [--dry-run]
 */
import { pool } from '../src/db.js';
import { enumerateDayLabels } from './lib/do-corpus.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const fnRows = await pool.query('SELECT name FROM functions');
  const labels = enumerateDayLabels(fnRows.rows.map((r) => r.name));
  console.log(`${labels.length} distinct day labels in the corpus.`);

  if (DRY_RUN) {
    const unmapped = labels.filter((l) => !l.english);
    const proposals = labels.filter((l) => l.english && !l.mapsToExisting);
    console.log(`  ${labels.filter((l) => l.mapsToExisting).length} map to existing functions`);
    console.log(`  ${proposals.length} auto-translated proposals (would create new functions)`);
    console.log(`  ${unmapped.length} unmapped (ferial/unclassified)`);
    for (const l of proposals.slice(0, 30)) console.log(`    ${l.latin_display} -> ${l.english}`);
    await pool.end();
    return;
  }

  let added = 0;
  let refreshed = 0;
  for (const l of labels) {
    const result = await pool.query(
      `INSERT INTO feast_translations (latin, latin_display, english, source, day_count, sample_day)
       VALUES ($1, $2, $3, 'auto', $4, $5)
       ON CONFLICT (latin) DO UPDATE
         SET latin_display = EXCLUDED.latin_display,
             english = EXCLUDED.english,
             day_count = EXCLUDED.day_count,
             sample_day = EXCLUDED.sample_day,
             updated_at = CURRENT_TIMESTAMP
         WHERE feast_translations.source = 'auto'
       RETURNING (xmax = 0) AS inserted`,
      [l.latin, l.latin_display, l.english, l.day_count, l.sample_day]
    );
    if (result.rows.length) {
      if (result.rows[0].inserted) added++;
      else refreshed++;
    }
  }
  console.log(`Done. ${added} added, ${refreshed} auto rows refreshed (manual rows untouched).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
