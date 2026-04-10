import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const before = await pool.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone'`
  );
  console.log('BEFORE:', JSON.stringify(before.rows[0]));

  if (before.rows[0]?.data_type !== 'ARRAY') {
    // Find dependent views
    const deps = await pool.query(`
      SELECT DISTINCT v.table_name AS view_name
      FROM information_schema.view_column_usage v
      WHERE v.column_name = 'tone' AND v.table_name != 'compositions'
    `);
    console.log('Dependent views:', JSON.stringify(deps.rows));

    // Get view definitions so we can recreate them
    const viewDefs = {};
    for (const dep of deps.rows) {
      const def = await pool.query(`SELECT pg_get_viewdef($1::regclass, true) AS definition`, [dep.view_name]);
      viewDefs[dep.view_name] = def.rows[0]?.definition;
      console.log(`View ${dep.view_name} definition saved.`);
    }

    // Drop dependent views
    for (const viewName of Object.keys(viewDefs)) {
      await pool.query(`DROP VIEW IF EXISTS ${viewName} CASCADE`);
      console.log(`Dropped view: ${viewName}`);
    }

    // Apply the migration
    console.log('Applying migration: converting tone from varchar to text[]...');
    await pool.query(`ALTER TABLE compositions ALTER COLUMN tone TYPE text[] USING CASE WHEN tone IS NOT NULL THEN ARRAY[tone] ELSE NULL END`);
    console.log('Migration applied successfully.');

    // Recreate views
    for (const [viewName, definition] of Object.entries(viewDefs)) {
      try {
        await pool.query(`CREATE OR REPLACE VIEW ${viewName} AS ${definition}`);
        console.log(`Recreated view: ${viewName}`);
      } catch (e) {
        console.error(`Failed to recreate view ${viewName}: ${e.message}`);
      }
    }
  } else {
    console.log('Column is already text[], no migration needed.');
  }

  const after = await pool.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone'`
  );
  console.log('AFTER:', JSON.stringify(after.rows[0]));

  const sample = await pool.query(`SELECT id, tone FROM compositions WHERE tone IS NOT NULL LIMIT 3`);
  console.log('SAMPLE_ROWS:', JSON.stringify(sample.rows));
} catch (e) { console.error('ERROR:', e.message); }
pool.end();
