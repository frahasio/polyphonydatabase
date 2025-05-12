const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
  } else {
    console.log('Database connected successfully');
  }
});

// Serve static files from public directory
app.use(express.static('public'));

// Basic route to test server
app.get('/', (req, res) => {
  res.send('Polyphony Database Node.js API is running');
});

// Route to show database schema
app.get('/schema', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        character_maximum_length,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);
    
    // Format the results for better readability
    const schema = result.rows.reduce((acc, row) => {
      if (!acc[row.table_name]) {
        acc[row.table_name] = [];
      }
      acc[row.table_name].push({
        column: row.column_name,
        type: row.data_type,
        maxLength: row.character_maximum_length,
        default: row.column_default,
        nullable: row.is_nullable
      });
      return acc;
    }, {});

    res.json(schema);
  } catch (err) {
    console.error('Error fetching schema:', err);
    res.status(500).json({ error: 'Error fetching database schema' });
  }
});

// Route to get all sources
app.get('/sources', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, title, from_year, to_year, catalogued
      FROM sources
      ORDER BY code
    `);
    res.json({ sources: result.rows });
  } catch (err) {
    console.error('Error fetching sources:', err);
    res.status(500).json({ error: 'Error fetching sources' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
