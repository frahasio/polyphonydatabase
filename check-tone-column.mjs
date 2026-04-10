import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const before = await pool.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone'`
  );
  console.log('BEFORE:', JSON.stringify(before.rows[0]));

  if (before.rows[0]?.data_type !== 'ARRAY') {
    console.log('Applying migration: converting tone from varchar to text[]...');
    await pool.query(`ALTER TABLE compositions ALTER COLUMN tone TYPE text[] USING CASE WHEN tone IS NOT NULL THEN ARRAY[tone] ELSE NULL END`);
    console.log('Migration applied successfully.');
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
