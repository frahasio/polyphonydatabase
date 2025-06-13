import express from 'express';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Get list of sources
app.get('/sources', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        s.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as publishers,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', sc.id,
              'name', sc.name
            )
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scribes
      FROM sources s
      LEFT JOIN publishers_sources ps ON s.id = ps.source_id
      LEFT JOIN publishers p ON ps.publisher_id = p.id
      LEFT JOIN scribes_sources ss ON s.id = ss.source_id
      LEFT JOIN scribes sc ON ss.scribe_id = sc.id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += `
        WHERE s.code ILIKE $1 OR s.title ILIKE $1
      `;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY s.id
      ORDER BY s.code
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      sources: result.rows.map(row => ({
        ...row,
        publishers: row.publishers || [],
        scribes: row.scribes || []
      }))
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/sources/:id', async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Fetch source details with publishers and scribes
    const sourceQuery = `
      SELECT 
        s.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as publishers,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', sc.id,
              'name', sc.name
            )
          ) FILTER (WHERE sc.id IS NOT NULL),
          '[]'
        ) as scribes
      FROM sources s
      LEFT JOIN publishers_sources ps ON s.id = ps.source_id
      LEFT JOIN publishers p ON ps.publisher_id = p.id
      LEFT JOIN scribes_sources ss ON s.id = ss.source_id
      LEFT JOIN scribes sc ON ss.scribe_id = sc.id
      WHERE s.id = $1
      GROUP BY s.id
    `;

    const sourceResult = await pool.query(sourceQuery, [sourceId]);
    
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const source = sourceResult.rows[0];

    // Fetch total count of inclusions
    const countQuery = `
      SELECT COUNT(*) 
      FROM inclusions 
      WHERE source_id = $1
    `;
    const countResult = await pool.query(countQuery, [sourceId]);
    const totalInclusions = parseInt(countResult.rows[0].count);

    // Fetch paginated inclusions with related data
    const inclusionsQuery = `
      SELECT 
        i.*,
        c.title as composition_title,
        c.composition_type_id,
        ct.name as composition_type,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', comp.id,
              'name', comp.name
            )
          ) FILTER (WHERE comp.id IS NOT NULL),
          '[]'
        ) as composers
      FROM inclusions i
      LEFT JOIN compositions c ON i.composition_id = c.id
      LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
      LEFT JOIN composers_compositions cc ON c.id = cc.composition_id
      LEFT JOIN composers comp ON cc.composer_id = comp.id
      WHERE i.source_id = $1
      GROUP BY i.id, c.id, ct.id
      ORDER BY i.position
      LIMIT $2 OFFSET $3
    `;

    const inclusionsResult = await pool.query(inclusionsQuery, [sourceId, limit, offset]);
    const inclusions = inclusionsResult.rows;

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalInclusions / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      source: {
        ...source,
        publishers: source.publishers || [],
        scribes: source.scribes || []
      },
      inclusions,
      pagination: {
        total: totalInclusions,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    });
  } catch (error) {
    console.error('Error fetching source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 