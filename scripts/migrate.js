// Heroku release-phase entrypoint: apply pending migrations and exit.
// A non-zero exit aborts the deploy, so a failed migration never goes live.
import { runMigrations, pool } from '../src/db.js';

try {
  await runMigrations();
  console.log('Migrations complete');
  await pool.end();
  process.exit(0);
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
