/**
 * Matcher: enrich sources that ALREADY have a manually-checked RISM link
 * with data from RISM Online — dating gaps/discrepancies, digital
 * facsimile links, and the holding library/shelfmark for verification.
 * Writes kind 'source_rism' suggestions for review; nothing is applied
 * automatically.
 *
 * Only sources with rism_link set are considered (those links were entered
 * by hand, so the identification is trusted — this matcher never guesses
 * which RISM record a source is).
 *
 * Checkpoint: sources.rism_checked_at. Re-runs refresh pending cards in
 * place (dedupe sr:{source_id}). To re-sweep after improvements, NULL the
 * checkpoint column.
 *
 * Usage: node scripts/suggest-source-rism.js [batch=200] [--dry-run]
 */
import { pool } from '../src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = Math.min(Math.max(parseInt(process.argv[2], 10) || 200, 1), 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract the numeric RISM source id from the various link styles in use:
// opac.rism.info/search?id=456050440, /id/rismid/rism456050803,
// rism.online/sources/456050440 ...
function rismIdFromLink(link) {
  const s = String(link || '');
  const m = s.match(/sources\/(\d{5,})/) || s.match(/[?&]id=(?:rism)?(\d{5,})/)
    || s.match(/rism(\d{5,})/i) || s.match(/\b(\d{6,})\b/);
  return m ? m[1] : null;
}

const en = (labelObj) => {
  if (!labelObj) return '';
  const arr = labelObj.en || labelObj.none || Object.values(labelObj)[0] || [];
  return Array.isArray(arr) ? arr.join('; ') : String(arr);
};

/** Find a summary entry by its English section label. */
function summaryValue(summary, label) {
  for (const item of summary || []) {
    if ((item.label && item.label.en && item.label.en[0]) === label) return en(item.value);
  }
  return '';
}

function parseYears(datesRaw) {
  // "1500-1535 (1510c, damaged parts replaced 1525c)" -> use the years
  // BEFORE any parenthesis; fall back to all years found. Years may have
  // letters attached ("1570er Jahre", "1510c") but not digits.
  const YEAR_RE = /(?<![0-9])1[0-9]{3}(?![0-9])/g;
  const head = String(datesRaw).split('(')[0];
  let years = (head.match(YEAR_RE) || []).map(Number);
  if (!years.length) years = (String(datesRaw).match(YEAR_RE) || []).map(Number);
  if (!years.length) return { from: null, to: null };
  return { from: Math.min(...years), to: Math.max(...years) };
}

async function fetchRismSource(id) {
  const resp = await fetch(`https://rism.online/sources/${id}`, {
    headers: { Accept: 'application/ld+json' },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function main() {
  const sources = await pool.query(`
    SELECT s.id, s.code, s.title, s.town, s.rism_link, s.from_year, s.to_year,
           (SELECT COUNT(*) FROM source_images si WHERE si.source_id = s.id)::int AS image_count
    FROM sources s
    WHERE COALESCE(s.rism_link, '') <> '' AND s.rism_checked_at IS NULL
    ORDER BY s.id
    LIMIT $1
  `, [BATCH]);
  console.log(`Checking ${sources.rows.length} RISM-linked sources...${DRY_RUN ? ' [dry run]' : ''}`);

  let inserted = 0;
  for (const src of sources.rows) {
    const rismId = rismIdFromLink(src.rism_link);
    if (!rismId) {
      if (!DRY_RUN) await pool.query('UPDATE sources SET rism_checked_at = NOW() WHERE id = $1', [src.id]);
      console.log(`  ${src.id} ${src.code}: could not parse a RISM id from "${src.rism_link}"`);
      continue;
    }
    let record;
    try {
      record = await fetchRismSource(rismId);
    } catch (err) {
      // Transient failure: leave unchecked so the next run retries.
      console.warn(`  ${src.id} ${src.code}: RISM fetch failed (${err.message})`);
      await sleep(2000);
      continue;
    }
    await sleep(500); // polite ~2 req/s, whatever happens below
    if (!DRY_RUN) await pool.query('UPDATE sources SET rism_checked_at = NOW() WHERE id = $1', [src.id]);
    if (!record) {
      console.log(`  ${src.id} ${src.code}: RISM record ${rismId} not found (404)`);
      continue;
    }

    const summary = (record.contents && record.contents.summary) || [];
    const datesRaw = summaryValue(summary, 'Dates');
    let { from, to } = parseYears(datesRaw);
    // Single-year datings ("1516" — most prints): our convention stores
    // these as from_year only, so a bare to_year "fill" would just echo
    // what we already know. Only treat it as a discrepancy when OUR years
    // disagree with the year itself.
    if (from && to && from === to) {
      if (src.from_year === from || src.to_year === to) { from = null; to = null; }
      else if (!src.to_year) to = null;
    }
    // Approximate RISM datings ("1538-1545 ca.") within a couple of years
    // of ours are agreement, not a correction worth reviewing.
    const tolerance = /\bca\b|\bca\.|circa/i.test(datesRaw) ? 3 : 0;
    if (from && src.from_year && Math.abs(src.from_year - from) <= tolerance) from = null;
    if (to && src.to_year && Math.abs(src.to_year - to) <= tolerance) to = null;

    const resources = (record.externalResources && record.externalResources.items) || [];
    const digit = resources.find((r) => r.resourceType === 'rism:DigitizationLink' && r.url);
    const iiif = resources.find((r) => String(r.resourceType || '').includes('IIIF') && r.url);

    const holdings = ((record.exemplars && record.exemplars.items) || [])
      .map((h) => en(h.label)).filter(Boolean).slice(0, 3);

    // Proposals: fill or correct dates; offer RISM's digitization link only
    // when the source has NO image links at all (source_images is where
    // facsimiles live — many sources already carry them).
    const proposal = {};
    if (from && src.from_year !== from) proposal.from_year = from;
    if (to && src.to_year !== to) proposal.to_year = to;
    if (digit && src.image_count === 0) proposal.facsimile_url = digit.url;
    if (!Object.keys(proposal).length) continue; // nothing to suggest

    // Confidence: pure gap-filling is safe; date CORRECTIONS need a closer
    // look, so they rank lower.
    const replacesDates = (proposal.from_year && src.from_year) || (proposal.to_year && src.to_year);
    const score = replacesDates ? 0.6 : 0.85;

    inserted += 1;
    if (DRY_RUN) {
      const what = Object.entries(proposal).map(([k, v]) => `${k}=${v}`).join(', ');
      console.log(`  ${src.id} ${src.code}: ${what}${datesRaw ? ` [RISM dates: ${datesRaw}]` : ''}`);
      continue;
    }
    await pool.query(
      `INSERT INTO suggestions (kind, source_id, payload, score, source, dedupe_key)
       VALUES ('source_rism', $1, $2, $3, 'rism', $4)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET payload = EXCLUDED.payload, score = EXCLUDED.score
         WHERE suggestions.status = 'pending'`,
      [
        src.id,
        JSON.stringify({
          rism_id: rismId,
          rism_url: `https://rism.online/sources/${rismId}`,
          rism_label: en(record.label),
          rism_dates_raw: datesRaw || null,
          holdings,
          facsimile_label: digit ? en(digit.label) : null,
          iiif_manifest: iiif ? iiif.url : null,
          ...proposal,
          current: { from_year: src.from_year, to_year: src.to_year, image_count: src.image_count },
        }),
        score,
        `sr:${src.id}`,
      ]
    );
    console.log(`  ${src.id} ${src.code}: suggested ${Object.keys(proposal).join(', ')}`);
  }

  console.log(`Done. ${DRY_RUN ? 'Would insert' : 'Inserted/refreshed'} ${inserted} suggestions.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
