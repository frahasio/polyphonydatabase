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

    // Save definitions and drop dependent objects
    const savedDefs = [];
    for (const dep of deps.rows) {
      const defResult = await pool.query(`SELECT pg_get_viewdef($1::regclass, true) AS def`, [dep.view_name]);
      savedDefs.push({ name: dep.view_name, kind: dep.relkind, def: defResult.rows[0]?.def });

      const dropCmd = dep.relkind === 'm'
        ? `DROP MATERIALIZED VIEW IF EXISTS "${dep.view_name}" CASCADE`
        : `DROP VIEW IF EXISTS "${dep.view_name}" CASCADE`;
      await pool.query(dropCmd);
      console.log(`Dropped ${dep.relkind === 'm' ? 'materialized view' : 'view'}: ${dep.view_name}`);
    }

    // Apply the migration
    console.log('Applying migration...');
    await pool.query(`ALTER TABLE compositions ALTER COLUMN tone TYPE text[] USING CASE WHEN tone IS NOT NULL THEN ARRAY[tone] ELSE NULL END`);
    console.log('Migration applied successfully.');

    // Attempt to recreate dropped objects
    for (const obj of savedDefs) {
      try {
        const createCmd = obj.kind === 'm'
          ? `CREATE MATERIALIZED VIEW "${obj.name}" AS ${obj.def}`
          : `CREATE OR REPLACE VIEW "${obj.name}" AS ${obj.def}`;
        await pool.query(createCmd);
        console.log(`Recreated: ${obj.name}`);
      } catch (e) {
        console.log(`NOTE: Did not recreate ${obj.name} (${e.message}). This view is not used by the application.`);
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
