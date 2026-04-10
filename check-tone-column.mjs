import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const before = await pool.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone'`
  );
  console.log('BEFORE:', JSON.stringify(before.rows[0]));

  if (before.rows[0]?.data_type !== 'ARRAY') {
    // Find ALL dependent views/rules using pg_depend
    const deps = await pool.query(`
      SELECT DISTINCT c.relname AS view_name, c.relkind
      FROM pg_depend d
      JOIN pg_rewrite r ON d.objid = r.oid
      JOIN pg_class c ON r.ev_class = c.oid
      JOIN pg_attribute a ON d.refobjid = a.attrelid AND d.refobjsubid = a.attnum
      WHERE a.attrelid = 'compositions'::regclass
        AND a.attname = 'tone'
        AND c.relname != 'compositions'
    `);
    console.log('Dependent objects:', JSON.stringify(deps.rows));

    // Also find any views that reference the compositions table at all
    const allViews = await pool.query(`
      SELECT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition
      FROM pg_class c
      JOIN pg_depend d ON c.oid = d.objid
      JOIN pg_class t ON d.refobjid = t.oid
      WHERE c.relkind = 'v'
        AND t.relname = 'compositions'
      GROUP BY c.relname, c.oid
    `);
    console.log('All views referencing compositions:', allViews.rows.map(r => r.view_name));

    // Save and drop all dependent views
    const viewDefs = {};
    for (const v of allViews.rows) {
      viewDefs[v.view_name] = v.definition;
      await pool.query(`DROP VIEW IF EXISTS "${v.view_name}" CASCADE`);
      console.log(`Dropped view: ${v.view_name}`);
    }

    // Apply the migration
    console.log('Applying migration...');
    await pool.query(`ALTER TABLE compositions ALTER COLUMN tone TYPE text[] USING CASE WHEN tone IS NOT NULL THEN ARRAY[tone] ELSE NULL END`);
    console.log('Migration applied successfully.');

    // Recreate views
    for (const [name, def] of Object.entries(viewDefs)) {
      try {
        await pool.query(`CREATE OR REPLACE VIEW "${name}" AS ${def}`);
        console.log(`Recreated view: ${name}`);
      } catch (e) {
        console.error(`WARN: Could not recreate view ${name}: ${e.message}`);
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
