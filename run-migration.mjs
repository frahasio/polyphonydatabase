import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone_connector'`
  );
  if (check.rows.length > 0) {
    console.log('Column tone_connector already exists.');
  } else {
    await pool.query(`ALTER TABLE compositions ADD COLUMN tone_connector varchar(3) DEFAULT 'et'`);
    console.log('Added tone_connector column successfully.');
  }
  const verify = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'compositions' AND column_name = 'tone_connector'`
  );
  console.log('VERIFY:', JSON.stringify(verify.rows[0]));
} catch (e) { console.error('ERROR:', e.message); }
pool.end();
