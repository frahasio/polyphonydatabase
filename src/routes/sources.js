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

// Get composition types for dropdown (MUST be before /:id route)
router.get('/composition-types', async (req, res) => {
  try {
    // Check if table exists first
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'composition_types'
      );
    `);
    
    if (!tableExists.rows[0].exists) {
      // Return hardcoded list if table doesn't exist yet
      const hardcodedTypes = [
        {id: 1, name: "Mass"},
        {id: 2, name: "Hymn"},
        {id: 3, name: "Responsory"},
        {id: 4, name: "Alleluia"},
        {id: 5, name: "Instrumental"},
        {id: 6, name: "Introit"},
        {id: 7, name: "Lamentation"},
        {id: 8, name: "Litany"},
        {id: 9, name: "Passion"},
        {id: 10, name: "Service"},
        {id: 11, name: "Reading"},
        {id: 12, name: "Response(s)"},
        {id: 13, name: "Verse anthem"},
        {id: 14, name: "Round/canon"},
        {id: 15, name: "Reproaches"},
        {id: 16, name: "Alternatim psalm/canticle"},
        {id: 17, name: "Requiem/Burial service"},
        {id: 18, name: "Sequence"}
      ];
      return res.json(hardcodedTypes);
    }
    
    const result = await pool.query('SELECT id, name FROM composition_types ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composition types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all publishers for multi-select (MUST be before /:id route)
router.get('/publishers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM publishers ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all scribes for multi-select (MUST be before /:id route)
router.get('/scribes', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM scribes ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scribes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all composers for select dropdowns (MUST be before /:id route)
router.get('/composers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM composers ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Title autocomplete (MUST be before /:id route)
router.get('/titles/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 3) {
      return res.json([]);
    }
    
    const result = await pool.query(
      'SELECT id, text FROM titles WHERE text ILIKE $1 ORDER BY text LIMIT 20',
      [`${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching titles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Composer autocomplete (MUST be before /:id route)
router.get('/composers/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    
    const result = await pool.query(
      'SELECT id, name FROM composers WHERE name ILIKE $1 ORDER BY name LIMIT 20',
      [`${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get source by ID
router.get('/:id', async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const inclusionsPage = parseInt(req.query.inclusions_page) || 1;
    const inclusionsLimit = parseInt(req.query.inclusions_limit) || 40;
    const inclusionsOffset = (inclusionsPage - 1) * inclusionsLimit;

    // Fetch source details with publishers, scribes, and images
    const sourceQuery = `
      SELECT 
        s.id,
        s.code,
        s.title,
        s.type,
        s.format,
        s.town,
        s.rism_link,
        s.catalogued,
        s.created_at,
        s.updated_at,
        s.from_year,
        s.to_year,
        s.from_year_annotation,
        s.to_year_annotation,
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
        ) as scribes,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', si.id,
              'url', si.url,
              'label', si.label
            )
          ) FILTER (WHERE si.id IS NOT NULL),
          '[]'
        ) as source_images
      FROM sources s
      LEFT JOIN publishers_sources ps ON s.id = ps.source_id
      LEFT JOIN publishers p ON ps.publisher_id = p.id
      LEFT JOIN scribes_sources ss ON s.id = ss.source_id
      LEFT JOIN scribes sc ON ss.scribe_id = sc.id
      LEFT JOIN source_images si ON s.id = si.source_id
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
        i.id,
        i.source_id,
        i.composition_id,
        i.notes,
        i.order,
        i.position,
        i.attribution_texts,
        i.composer_ids,
        i.clefs,
        i.created_at,
        i.updated_at,
        -- Resolved composition data for display
        t.text as title_text,
        ct.name as composition_type_name,
        c.composition_type_id,
        c.tone,
        c.even_odd,
        c.number_of_voices,
        -- Get composer names from the composer_ids array
        COALESCE(
          (
            SELECT json_agg(comp.name ORDER BY comp.id)
            FROM composers comp
            WHERE comp.id = ANY(
              CASE 
                WHEN jsonb_typeof(i.composer_ids) = 'array' 
                THEN ARRAY(SELECT jsonb_array_elements_text(i.composer_ids)::integer)
                ELSE '{}'::integer[]
              END
            )
          ),
          '[]'::json
        ) as composer_names
      FROM inclusions i
      LEFT JOIN compositions c ON i.composition_id = c.id
      LEFT JOIN titles t ON c.title_id = t.id
      LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
      WHERE i.source_id = $1
      ORDER BY i.order, i.id
      LIMIT $2 OFFSET $3
    `;

    const inclusionsResult = await pool.query(inclusionsQuery, [sourceId, inclusionsLimit, inclusionsOffset]);
    
    // Format inclusions to match schema
    const inclusions = inclusionsResult.rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      composition_id: row.composition_id,
      notes: row.notes,
      order: row.order,
      position: row.position,
      attribution_texts: row.attribution_texts || [],
      composer_ids: row.composer_ids || [],
      clefs: row.clefs || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Resolved composition data for display
      composition: {
        title_text: row.title_text,
        composition_type_name: row.composition_type_name,
        composition_type_id: row.composition_type_id,
        tone: row.tone,
        even_odd: row.even_odd,
        number_of_voices: row.number_of_voices,
        composer_names: row.composer_names || []
      }
    }));

    // Calculate pagination metadata for inclusions
    const totalInclusionsPages = Math.ceil(totalInclusions / inclusionsLimit);
    const hasNextPage = inclusionsPage < totalInclusionsPages;
    const hasPrevPage = inclusionsPage > 1;

    res.json({
      source: {
        ...source,
        publishers: source.publishers || [],
        scribes: source.scribes || []
      },
      inclusions,
      inclusions_pagination: {
        total: totalInclusions,
        page: inclusionsPage,
        limit: inclusionsLimit,
        totalPages: totalInclusionsPages,
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
    const { 
      code, 
      title, 
      type, 
      format, 
      town, 
      rism_link, 
      catalogued,
      from_year,
      to_year,
      from_year_annotation,
      to_year_annotation 
    } = req.body;
    const now = new Date();

    const query = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, from_year = $8, to_year = $9,
          from_year_annotation = $10, to_year_annotation = $11, updated_at = $12
      WHERE id = $13
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rism_link, catalogued,
      from_year, to_year, from_year_annotation, to_year_annotation, now, id
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
    
    // === COMPREHENSIVE LOGGING START ===
    console.log('\n=== SAVE WITH INCLUSIONS START ===');
    console.log('Source ID:', sourceId);
    console.log('Source data:', source);
    console.log('Total inclusions received:', inclusions.length);
    console.log('Inclusions sample (first 3):');
    inclusions.slice(0, 3).forEach((inclusion, index) => {
      console.log(`Inclusion ${index}:`, {
        id: inclusion.id,
        order: inclusion.order,
        composition: inclusion.composition,
        even_odd: inclusion.composition?.even_odd,
        even_odd_type: typeof inclusion.composition?.even_odd,
        number_of_voices: inclusion.composition?.number_of_voices,
        number_of_voices_type: typeof inclusion.composition?.number_of_voices,
        title_text: inclusion.composition?.title_text,
        composition_type_id: inclusion.composition?.composition_type_id,
        clefs: inclusion.clefs
      });
    });
    console.log('=====================================\n');
    
    // Update source first
    const updateSourceQuery = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, from_year = $8, to_year = $9,
          from_year_annotation = $10, to_year_annotation = $11, updated_at = $12
      WHERE id = $13
      RETURNING *
    `;
    
    const now = new Date();
    await client.query(updateSourceQuery, [
      source.code, 
      source.title, 
      source.type, 
      source.format, 
      source.town,
      source.rism_link, 
      source.catalogued,
      source.from_year || null,
      source.to_year || null,
      source.from_year_annotation || null,
      source.to_year_annotation || null,
      now, 
      sourceId
    ]);
    
    // Update publishers relationships
    if (source.publishers) {
      await client.query('DELETE FROM publishers_sources WHERE source_id = $1', [sourceId]);
      for (const publisherId of source.publishers) {
        if (publisherId) {
          await client.query(
            'INSERT INTO publishers_sources (publisher_id, source_id) VALUES ($1, $2)',
            [publisherId, sourceId]
          );
        }
      }
    }
    
    // Update scribes relationships  
    if (source.scribes) {
      await client.query('DELETE FROM scribes_sources WHERE source_id = $1', [sourceId]);
      for (const scribeId of source.scribes) {
        if (scribeId) {
          await client.query(
            'INSERT INTO scribes_sources (scribe_id, source_id) VALUES ($1, $2)',
            [scribeId, sourceId]
          );
        }
      }
    }
    
    // Update source images
    if (source.source_images) {
      await client.query('DELETE FROM source_images WHERE source_id = $1', [sourceId]);
      for (const image of source.source_images) {
        if (image.url) {
          await client.query(
            'INSERT INTO source_images (source_id, url, label, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
            [sourceId, image.url, image.label || '', now, now]
          );
        }
      }
    }

    console.log('\n=== CREATING TEMP TABLE ===');
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
        processed BOOLEAN DEFAULT FALSE,
        -- ADD FIELDS FOR PROPER MATCHING
        original_composition_id INTEGER,
        tone TEXT,
        even_odd INTEGER,
        composition_type_id INTEGER,
        number_of_voices INTEGER,
        composer_ids_json TEXT
      )
    `);

    console.log('Temp table created with enhanced fields for matching');

    // Insert inclusions into temporary table
    console.log('\n=== INSERTING INTO TEMP TABLE ===');
    let tempInsertCount = 0;
    
    for (const inclusion of inclusions) {
      // Skip completely empty inclusions
      if (!inclusion.id && 
          !inclusion.composition?.title_text && 
          (!inclusion.attribution_texts || !inclusion.attribution_texts.some(text => text.trim())) &&
          !inclusion.position &&
          !inclusion.notes) {
        console.log('Skipping completely empty inclusion');
        continue;
      }

      // Calculate number of voices from clefs
      let numberOfVoices = null;
      if (inclusion.clefs && inclusion.clefs.length > 0) {
        numberOfVoices = inclusion.clefs.filter(clef => 
          clef.clef && clef.clef.trim() && !clef.optional
        ).length;
        numberOfVoices = numberOfVoices > 0 ? numberOfVoices : null;
      }

      console.log(`Inserting temp inclusion ${tempInsertCount}:`, {
        order: inclusion.order,
        title: inclusion.composition?.title_text,
        composition_type_id: inclusion.composition?.composition_type_id,
        tone: inclusion.composition?.tone,
        even_odd: inclusion.composition?.even_odd,
        number_of_voices: numberOfVoices,
        original_composition_id: inclusion.composition_id
      });

      await client.query(`
        INSERT INTO temp_inclusions (
          source_id, position, composition_name, composition_type, composers, clefs, composition_id,
          original_composition_id, tone, even_odd, composition_type_id, number_of_voices, composer_ids_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        sourceId,
        inclusion.order || 0,
        inclusion.composition?.title_text || '',
        inclusion.composition?.composition_type_name || '',
        (inclusion.attribution_texts || []).join(', '),
        JSON.stringify(inclusion.clefs || []),
        inclusion.composition_id || null,
        inclusion.composition_id || null, // Store original composition ID
        inclusion.composition?.tone || null,
        inclusion.composition?.even_odd ?? null,
        inclusion.composition?.composition_type_id || null,
        numberOfVoices,
        JSON.stringify(inclusion.composer_ids || [])
      ]);
      
      tempInsertCount++;
    }

    console.log(`Inserted ${tempInsertCount} inclusions into temp table`);

    // Show what's in the temp table
    const tempTableContents = await client.query(`SELECT * FROM temp_inclusions ORDER BY position`);
    console.log('\n=== TEMP TABLE CONTENTS ===');
    tempTableContents.rows.forEach((row, index) => {
      console.log(`Temp row ${index}:`, {
        id: row.id,
        position: row.position,
        composition_name: row.composition_name,
        original_composition_id: row.original_composition_id,
        tone: row.tone,
        even_odd: row.even_odd,
        composition_type_id: row.composition_type_id,
        number_of_voices: row.number_of_voices,
        processed: row.processed
      });
    });
    console.log('=============================\n');

    // Process compositions
    console.log('\n=== COMPOSITION MATCHING PHASE 1: BY TITLE ONLY ===');
    // 1. First pass: try to match existing compositions by title and update them
    const matchExistingQuery = `
      UPDATE temp_inclusions 
      SET composition_id = c.id, processed = TRUE
      FROM compositions c
      INNER JOIN titles t ON c.title_id = t.id
      WHERE temp_inclusions.composition_name = t.text
      AND temp_inclusions.composition_id IS NULL
      AND temp_inclusions.composition_name != ''
    `;
    const matchResult = await client.query(matchExistingQuery);
    console.log(`Phase 1 matching by title: ${matchResult.rowCount} rows matched`);

    // Show what got matched
    const matchedByTitle = await client.query(`
      SELECT ti.*, c.*, t.text as title_text
      FROM temp_inclusions ti 
      LEFT JOIN compositions c ON ti.composition_id = c.id
      LEFT JOIN titles t ON c.title_id = t.id
      WHERE ti.processed = TRUE
    `);
    console.log('Matched by title:');
    matchedByTitle.rows.forEach((row, index) => {
      console.log(`Matched ${index}:`, {
        temp_id: row.id,
        composition_id: row.composition_id,
        title: row.title_text,
        existing_tone: row.tone,
        existing_even_odd: row.even_odd,
        existing_composition_type_id: row.composition_type_id,
        existing_number_of_voices: row.number_of_voices,
        new_tone: row.tone, // from temp table
        new_even_odd: row.even_odd, // from temp table
        new_composition_type_id: row.composition_type_id // from temp table
      });
    });

    // Get the original inclusions data to preserve all fields (move this up before use)
    const processedInclusions = inclusions.filter(inclusion => 
      inclusion.id || 
      inclusion.composition?.title_text || 
      (inclusion.attribution_texts && inclusion.attribution_texts.some(text => text.trim())) ||
      inclusion.position ||
      inclusion.notes
    );

    console.log(`\nProcessed inclusions count: ${processedInclusions.length}`);

    console.log('\n=== UPDATING EXISTING COMPOSITIONS ===');
    // Update existing compositions with new tone/even_odd values
    for (let i = 0; i < processedInclusions.length; i++) {
      const originalInclusion = processedInclusions[i];
      const tempInclusion = await client.query(`
        SELECT composition_id, tone, even_odd, composition_type_id FROM temp_inclusions 
        WHERE position = $1 AND processed = TRUE
        LIMIT 1
      `, [originalInclusion.order || (i + 1)]);

      if (tempInclusion.rows.length > 0 && originalInclusion.composition) {
        const compositionId = tempInclusion.rows[0].composition_id;
        const tone = originalInclusion.composition.tone || null;
        
        // Convert even_odd string to integer if needed
        let evenOdd = originalInclusion.composition.even_odd ?? null;
        if (evenOdd === 'even') evenOdd = 0;
        else if (evenOdd === 'odd') evenOdd = 1;
        else if (evenOdd === 'both') evenOdd = 2;
        else if (typeof evenOdd === 'number') evenOdd = evenOdd; // Already an integer
        else evenOdd = null;
        
        const compositionTypeId = originalInclusion.composition.composition_type_id ? 
          parseInt(originalInclusion.composition.composition_type_id) : null;

        console.log(`Updating composition ${compositionId}:`, {
          original_tone: tempInclusion.rows[0].tone,
          new_tone: tone,
          original_even_odd: tempInclusion.rows[0].even_odd,
          new_even_odd: evenOdd,
          original_composition_type_id: tempInclusion.rows[0].composition_type_id,
          new_composition_type_id: compositionTypeId
        });

        await client.query(`
          UPDATE compositions 
          SET tone = $1, even_odd = $2, composition_type_id = $3, updated_at = $4
          WHERE id = $5
        `, [tone, evenOdd, compositionTypeId, now, compositionId]);
      }
    }

    console.log('\n=== CREATING NEW COMPOSITIONS FOR UNMATCHED ===');
    // 2. Second pass: create new compositions for unmatched items
    const unmatchedInclusions = await client.query(`
      SELECT * FROM temp_inclusions 
      WHERE processed = FALSE AND composition_name != ''
    `);

    console.log(`Found ${unmatchedInclusions.rows.length} unmatched inclusions that need new compositions`);

    for (let i = 0; i < unmatchedInclusions.rows.length; i++) {
      const tempInclusion = unmatchedInclusions.rows[i];
      
      // Find the corresponding original inclusion by position
      const originalInclusion = processedInclusions.find(inc => 
        (inc.order || (processedInclusions.indexOf(inc) + 1)) === tempInclusion.position
      );
      
      console.log(`Creating new composition for temp inclusion ${tempInclusion.id}:`, {
        position: tempInclusion.position,
        composition_name: tempInclusion.composition_name,
        found_original: !!originalInclusion,
        original_data: originalInclusion ? {
          composition_type_id: originalInclusion.composition?.composition_type_id,
          tone: originalInclusion.composition?.tone,
          even_odd: originalInclusion.composition?.even_odd,
          number_of_voices: originalInclusion.composition?.number_of_voices
        } : null
      });
      
      // Check if title already exists, if not create new one
      let titleResult = await client.query(`
        SELECT id FROM titles WHERE text = $1
      `, [tempInclusion.composition_name]);

      let titleId;
      if (titleResult.rows.length > 0) {
        titleId = titleResult.rows[0].id;
        console.log(`Using existing title ID: ${titleId}`);
      } else {
        const newTitleResult = await client.query(`
          INSERT INTO titles (text, created_at, updated_at)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [tempInclusion.composition_name, now, now]);
        titleId = newTitleResult.rows[0].id;
        console.log(`Created new title ID: ${titleId}`);
      }

      // Get composition type ID if specified
      let compositionTypeId = null;
      if (originalInclusion?.composition?.composition_type_id) {
        compositionTypeId = parseInt(originalInclusion.composition.composition_type_id);
      } else if (tempInclusion.composition_type) {
        const typeResult = await client.query(`
          SELECT id FROM composition_types WHERE name = $1
        `, [tempInclusion.composition_type]);
        
        if (typeResult.rows.length > 0) {
          compositionTypeId = parseInt(typeResult.rows[0].id); // Ensure integer conversion
        }
      }

      // Get tone and even_odd from original inclusion data
      const tone = originalInclusion?.composition?.tone || tempInclusion.tone || null;
      
      // Convert even_odd string to integer if needed
      let evenOdd = originalInclusion?.composition?.even_odd ?? tempInclusion.even_odd ?? null;
      if (evenOdd === 'even') evenOdd = 0;
      else if (evenOdd === 'odd') evenOdd = 1;
      else if (evenOdd === 'both') evenOdd = 2;
      else if (typeof evenOdd === 'number') evenOdd = evenOdd; // Already an integer
      else evenOdd = null;

      // Get number of voices - ensure integer conversion
      const numberOfVoices = originalInclusion?.composition?.number_of_voices || tempInclusion.number_of_voices || null;
      const numberOfVoicesInt = numberOfVoices ? parseInt(numberOfVoices) : null;

      console.log(`Final composition data for creation:`, {
        titleId,
        compositionTypeId,
        compositionTypeIdType: typeof compositionTypeId,
        tone,
        evenOdd,
        evenOddType: typeof evenOdd,
        numberOfVoices: numberOfVoicesInt,
        numberOfVoicesType: typeof numberOfVoicesInt
      });

      // IMPORTANT: Check if this exact composition already exists before creating
      const existingComposition = await client.query(`
        SELECT id FROM compositions 
        WHERE title_id = $1 
        AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
        AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
        AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
        AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
      `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt]);

      let compositionId;
      if (existingComposition.rows.length > 0) {
        compositionId = existingComposition.rows[0].id;
        console.log(`Found existing matching composition ID: ${compositionId} - NOT creating new one!`);
      } else {
        // Create new composition with all fields
        const compositionResult = await client.query(`
          INSERT INTO compositions (title_id, composition_type_id, tone, even_odd, number_of_voices, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt, now, now]);

        compositionId = compositionResult.rows[0].id;
        console.log(`Created NEW composition ID: ${compositionId}`);
      }

      // Update temp table
      await client.query(`
        UPDATE temp_inclusions 
        SET composition_id = $1, processed = TRUE 
        WHERE id = $2
      `, [compositionId, tempInclusion.id]);
    }

    // Show final temp table state
    const finalTempContents = await client.query(`SELECT * FROM temp_inclusions ORDER BY position`);
    console.log('\n=== FINAL TEMP TABLE STATE ===');
    finalTempContents.rows.forEach((row, index) => {
      console.log(`Final temp row ${index}:`, {
        id: row.id,
        position: row.position,
        composition_name: row.composition_name,
        final_composition_id: row.composition_id,
        processed: row.processed
      });
    });
    console.log('===============================\n');

    // 3. Only update/delete inclusions that are being changed on this page
    // First, collect the IDs of inclusions we're updating
    const inclusionIdsToUpdate = processedInclusions
      .filter(inc => inc.id)
      .map(inc => inc.id);

    console.log('Inclusion IDs to delete:', inclusionIdsToUpdate);

    // Delete only the inclusions that were on this page (if any have IDs)
    if (inclusionIdsToUpdate.length > 0) {
      const deleteResult = await client.query(
        'DELETE FROM inclusions WHERE source_id = $1 AND id = ANY($2)',
        [sourceId, inclusionIdsToUpdate]
      );
      console.log(`Deleted ${deleteResult.rowCount} existing inclusions`);
    }

    console.log('\n=== INSERTING FINAL INCLUSIONS ===');
    // 4. Insert/update final inclusions
    const finalInclusions = await client.query(`
      SELECT * FROM temp_inclusions ORDER BY position
    `);

    for (let i = 0; i < finalInclusions.rows.length; i++) {
      const tempInclusion = finalInclusions.rows[i];
      const originalInclusion = processedInclusions.find(inc => 
        (inc.order || (processedInclusions.indexOf(inc) + 1)) === tempInclusion.position
      ) || processedInclusions[i]; // Fallback to index matching
      
      if (tempInclusion.composition_id && originalInclusion) {
        console.log(`Inserting final inclusion ${i}:`, {
          source_id: sourceId,
          composition_id: tempInclusion.composition_id,
          order: originalInclusion.order || (i + 1),
          position: originalInclusion.position || '',
          clefs_count: originalInclusion.clefs?.length || 0
        });

        await client.query(`
          INSERT INTO inclusions (
            source_id, composition_id, "order", position, notes, 
            attribution_texts, composer_ids, clefs, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          sourceId, 
          tempInclusion.composition_id, 
          originalInclusion.order || (i + 1),
          originalInclusion.position || '',
          originalInclusion.notes || '',
          JSON.stringify(originalInclusion.attribution_texts || []),
          JSON.stringify(originalInclusion.composer_ids || []),
          JSON.stringify(originalInclusion.clefs || []),
          now, 
          now
        ]);
      }
    }

    await client.query('COMMIT');
    
    console.log(`\n=== SAVE COMPLETE ===`);
    console.log(`Processed ${finalInclusions.rows.length} inclusions successfully`);
    console.log(`====================\n`);
    
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