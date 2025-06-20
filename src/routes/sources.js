import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Get list of sources
router.get('/', async (req, res) => {
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

// Get source by ID
router.get('/:id', async (req, res) => {
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
        c.title as composition_name,
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
      GROUP BY i.id, c.id, ct.id, c.title
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

// Add new source
router.post('/', async (req, res) => {
  try {
    const { code, title, type, format, town, rismLink, catalogued } = req.body;
    const now = new Date();

    const query = `
      INSERT INTO sources (
        code, title, type, format, town, rism_link, catalogued,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rismLink, catalogued,
      now, now
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update source
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, title, type, format, town, rism_link, catalogued } = req.body;
    const now = new Date();

    const query = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, updated_at = $8
      WHERE id = $9
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rism_link, catalogued, now, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete source
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM sources WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk save source with inclusions (temporary table approach)
router.post('/:id/save-with-inclusions', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const sourceId = parseInt(req.params.id);
    const { source, inclusions } = req.body;
    
    // Update source first
    const updateSourceQuery = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, updated_at = $8
      WHERE id = $9
      RETURNING *
    `;
    
    const now = new Date();
    await client.query(updateSourceQuery, [
      source.code, source.title, source.type, source.format, source.town,
      source.rism_link, source.catalogued, now, sourceId
    ]);

    // Create temporary table for processing inclusions
    await client.query(`
      CREATE TEMP TABLE temp_inclusions (
        id SERIAL PRIMARY KEY,
        source_id INTEGER,
        position INTEGER,
        composition_name TEXT,
        composition_type TEXT,
        composers TEXT,
        clefs TEXT,
        composition_id INTEGER,
        processed BOOLEAN DEFAULT FALSE
      )
    `);

    // Insert inclusions into temporary table
    for (const inclusion of inclusions) {
      await client.query(`
        INSERT INTO temp_inclusions (source_id, position, composition_name, composition_type, composers, clefs, composition_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        sourceId,
        inclusion.position || 0,
        inclusion.composition_name || '',
        inclusion.composition_type || '',
        inclusion.composers || '',
        inclusion.clefs || '',
        inclusion.composition_id || null
      ]);
    }

    // Process compositions (simplified for now - you can expand this)
    // 1. First pass: try to match existing compositions by title
    const matchExistingQuery = `
      UPDATE temp_inclusions 
      SET composition_id = c.id, processed = TRUE
      FROM compositions c
      INNER JOIN titles t ON c.title_id = t.id
      WHERE temp_inclusions.composition_name = t.text
      AND temp_inclusions.composition_id IS NULL
      AND temp_inclusions.composition_name != ''
    `;
    await client.query(matchExistingQuery);

    // 2. Second pass: create new compositions for unmatched items
    const unmatchedInclusions = await client.query(`
      SELECT * FROM temp_inclusions 
      WHERE processed = FALSE AND composition_name != ''
    `);

    for (const tempInclusion of unmatchedInclusions.rows) {
      // Create new title
      const titleResult = await client.query(`
        INSERT INTO titles (text, created_at, updated_at)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [tempInclusion.composition_name, now, now]);

      const titleId = titleResult.rows[0].id;

      // Get composition type ID if specified
      let compositionTypeId = null;
      if (tempInclusion.composition_type) {
        const typeResult = await client.query(`
          SELECT id FROM composition_types WHERE name = $1
        `, [tempInclusion.composition_type]);
        
        if (typeResult.rows.length > 0) {
          compositionTypeId = typeResult.rows[0].id;
        }
      }

      // Create new composition
      const compositionResult = await client.query(`
        INSERT INTO compositions (title_id, composition_type_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [titleId, compositionTypeId, now, now]);

      const compositionId = compositionResult.rows[0].id;

      // Update temp table
      await client.query(`
        UPDATE temp_inclusions 
        SET composition_id = $1, processed = TRUE 
        WHERE id = $2
      `, [compositionId, tempInclusion.id]);
    }

    // 3. Clear existing inclusions for this source
    await client.query('DELETE FROM inclusions WHERE source_id = $1', [sourceId]);

    // 4. Insert final inclusions
    const finalInclusions = await client.query(`
      SELECT * FROM temp_inclusions ORDER BY position
    `);

    for (const tempInclusion of finalInclusions.rows) {
      if (tempInclusion.composition_id) {
        await client.query(`
          INSERT INTO inclusions (source_id, composition_id, position, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [sourceId, tempInclusion.composition_id, tempInclusion.position, now, now]);
      }
    }

    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: 'Source and inclusions saved successfully',
      processedInclusions: finalInclusions.rows.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving source with inclusions:', error);
    res.status(500).json({ error: 'Failed to save source and inclusions' });
  } finally {
    client.release();
  }
});

export default router; 