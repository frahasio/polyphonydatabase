import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigrations() {
  try {
    const sql = readFileSync(join(__dirname, '..', 'migrations', '002_user_permissions.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migrations: user_permissions table ready');
  } catch (error) {
    console.error('Migration error:', error.message);
  }
}

runMigrations();

async function ensureUserPermissions(userId) {
  await pool.query(
    `INSERT INTO user_permissions (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export { pool, ensureUserPermissions };