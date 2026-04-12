import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        catalogue BOOLEAN NOT NULL DEFAULT true,
        booklet_creator BOOLEAN NOT NULL DEFAULT false,
        import_source BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by INTEGER REFERENCES users(id)
      )
    `);
    console.log('Migrations: user_permissions table ready');
  } catch (error) {
    console.error('Migration error:', error.message);
  }
}

async function ensureUserPermissions(userId) {
  await pool.query(
    `INSERT INTO user_permissions (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export { pool, ensureUserPermissions, runMigrations };