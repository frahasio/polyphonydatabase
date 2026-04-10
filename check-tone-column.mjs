import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const colType = await pool.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone'`
  );
  console.log('COLUMN_TYPE:', JSON.stringify(colType.rows[0]));

  const sample = await pool.query(`SELECT id, tone FROM compositions WHERE tone IS NOT NULL LIMIT 5`);
  console.log('SAMPLE_ROWS:', JSON.stringify(sample.rows));
} catch (e) { console.error('ERROR:', e.message); }
pool.end();
