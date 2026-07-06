import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations'
);

// Arbitrary constant identifying this app's migration lock.
const MIGRATION_LOCK_ID = 727274;

/**
 * Apply numbered SQL migrations from migrations/ in filename order, tracking
 * applied files in app_migrations. (Named app_migrations because the
 * database still contains a schema_migrations table from the app's Rails era.)
 *
 * - Concurrent boots (multiple dynos) are serialised with an advisory lock.
 * - Each migration runs in its own transaction; failure rolls back and throws,
 *   so callers can refuse to start with a half-migrated schema.
 * - Existing databases that predate the runner are "baselined": if the users
 *   table exists but no migrations are recorded, all current files are marked
 *   applied without being run (the 000 baseline was dumped FROM production).
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+.*\.sql$/i.test(f))
      .sort();

    const appliedResult = await client.query('SELECT filename FROM app_migrations');
    const applied = new Set(appliedResult.rows.map((r) => r.filename));

    if (applied.size === 0) {
      const existing = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables WHERE table_name = 'users'
        ) AS has_schema
      `);
      if (existing.rows[0].has_schema) {
        for (const f of files) {
          await client.query(
            'INSERT INTO app_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [f]
          );
        }
        console.log(
          `Migrations: existing database detected — baselined ${files.length} file(s) as already applied`
        );
        return;
      }
    }

    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      console.log(`Migrations: applying ${f}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO app_migrations (filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
        ran++;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${error.message}`);
      }
    }
    console.log(
      ran > 0 ? `Migrations: applied ${ran} new migration(s)` : 'Migrations: up to date'
    );
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch {
      /* lock is released with the connection anyway */
    }
    client.release();
  }
}

async function ensureUserPermissions(userId) {
  await pool.query(
    `INSERT INTO user_permissions (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export { pool, ensureUserPermissions, runMigrations };
