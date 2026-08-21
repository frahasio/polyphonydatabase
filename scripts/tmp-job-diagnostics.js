// Temporary read-only diagnostics for suggestion jobs (safe to delete)
import fs from 'fs';
import pg from 'pg';

if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const q = (sql) => pool.query(sql).then(r => r.rows);

  console.log('=== Suggestions by type/status (last 60 days activity) ===');
  console.table(await q(`
    SELECT type, status, COUNT(*) AS n,
           MAX(created_at)::date AS last_created,
           MAX(updated_at)::date AS last_updated
    FROM suggestions
    GROUP BY type, status
    ORDER BY type, status
  `));

  console.log('=== Suggestions created per type in last 30 days ===');
  console.table(await q(`
    SELECT type, COUNT(*) AS created_last_30d, MAX(created_at) AS most_recent
    FROM suggestions
    WHERE created_at > now() - interval '30 days'
    GROUP BY type ORDER BY type
  `));

  console.log('=== Checkpoint coverage ===');
  console.table(await q(`
    SELECT 'titles.cantus_checked_at' AS checkpoint,
           COUNT(*) FILTER (WHERE cantus_checked_at IS NOT NULL) AS checked,
           COUNT(*) FILTER (WHERE cantus_checked_at IS NULL) AS unchecked,
           MAX(cantus_checked_at)::date AS last_run
    FROM titles
    UNION ALL
    SELECT 'groups.youtube_checked_at',
           COUNT(*) FILTER (WHERE youtube_checked_at IS NOT NULL),
           COUNT(*) FILTER (WHERE youtube_checked_at IS NULL),
           MAX(youtube_checked_at)::date
    FROM groups
    UNION ALL
    SELECT 'groups.spotify_checked_at',
           COUNT(*) FILTER (WHERE spotify_checked_at IS NOT NULL),
           COUNT(*) FILTER (WHERE spotify_checked_at IS NULL),
           MAX(spotify_checked_at)::date
    FROM groups
    UNION ALL
    SELECT 'composers.wikidata_checked_at',
           COUNT(*) FILTER (WHERE wikidata_checked_at IS NOT NULL),
           COUNT(*) FILTER (WHERE wikidata_checked_at IS NULL),
           MAX(wikidata_checked_at)::date
    FROM composers
  `));

  console.log('=== Titles without functions (DO matcher candidates) ===');
  console.table(await q(`
    SELECT COUNT(*) AS titles_total,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM functions_titles ft WHERE ft.title_id = t.id
           )) AS titles_without_functions,
           COUNT(*) FILTER (WHERE language IS NULL) AS titles_without_language
    FROM titles t
  `));

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
