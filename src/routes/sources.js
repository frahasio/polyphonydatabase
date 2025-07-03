import express from 'express';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes in this router
router.use(requireAuth);

// Convert tone values to standardized string format for database storage
function convertToneToString(toneValue) {
  if (!toneValue) return null;
  
  const toneStr = String(toneValue).toLowerCase().trim();
  
  // Valid tone values
  const validTones = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12'];
  
  // Handle special tone strings
  const specialTones = {
    'mix': 'mix',
    'mixti': 'mix',
    'per': 'per', 
    'peregrini': 'per',
    'pro': 'pro',
    'proprii': 'pro'
  };
  
  // Check if it's a special tone
  if (specialTones[toneStr]) {
    return specialTones[toneStr];
  }
  
  // Check if it's a valid numeric tone
  if (validTones.includes(toneStr)) {
    return toneStr;
  }
  
  return null;
}

// Get list of sources
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    const cataloguedFilter = req.query.catalogued;
    
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
    const whereConditions = [];
    
    if (searchTerm) {
      whereConditions.push(`(s.code ILIKE $${queryParams.length + 1} OR s.title ILIKE $${queryParams.length + 1})`);
      queryParams.push(`%${searchTerm}%`);
    }
    
    if (cataloguedFilter !== undefined) {
      const cataloguedValue = cataloguedFilter === 'true';
      whereConditions.push(`s.catalogued = $${queryParams.length + 1}`);
      queryParams.push(cataloguedValue);
    }
    
    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(' AND ')}`;
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
        s.notes,
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

    const newData = result.rows[0];

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'CREATE',
          'sources',
          newData.id,
          null,
          JSON.stringify(newData)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

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
      notes,
      from_year,
      to_year,
      from_year_annotation,
      to_year_annotation 
    } = req.body;
    const now = new Date();

    // Get old data for audit trail before updating
    const oldDataResult = await pool.query('SELECT * FROM sources WHERE id = $1', [id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    const oldData = oldDataResult.rows[0];

    const query = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, notes = $8, from_year = $9, to_year = $10,
          from_year_annotation = $11, to_year_annotation = $12, updated_at = $13
      WHERE id = $14
      RETURNING *
    `;

    const result = await pool.query(query, [
      code, title, type, format, town, rism_link, catalogued, notes,
      from_year, to_year, from_year_annotation, to_year_annotation, now, id
    ]);

    const newData = result.rows[0];

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'UPDATE',
          'sources',
          parseInt(id),
          JSON.stringify(oldData),
          JSON.stringify(newData)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
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
    
    // Get data before deletion for audit trail
    const oldDataResult = await pool.query('SELECT * FROM sources WHERE id = $1', [id]);
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }
    const oldData = oldDataResult.rows[0];

    await pool.query('DELETE FROM sources WHERE id = $1', [id]);

    // Log audit entry if audit system exists
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'DELETE',
          'sources',
          parseInt(id),
          JSON.stringify(oldData),
          null
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting source:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk save source with inclusions (with automatic temp_inclusions processing)
router.post('/:id/save-with-inclusions', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const sourceId = parseInt(req.params.id);
    const { source, inclusions } = req.body;
    const now = new Date();
    
    console.log('\n=== SAVE WITH INCLUSIONS START ===');
    console.log('Source ID:', sourceId);
    console.log('Source data:', source);
    console.log('Form inclusions received:', inclusions.length);
    
    // Step 1: Update source data first
    const updateSourceQuery = `
      UPDATE sources 
      SET code = $1, title = $2, type = $3, format = $4, town = $5, 
          rism_link = $6, catalogued = $7, notes = $8, from_year = $9, to_year = $10,
          from_year_annotation = $11, to_year_annotation = $12, updated_at = $13
      WHERE id = $14
      RETURNING *
    `;
    
    await client.query(updateSourceQuery, [
      source.code, 
      source.title, 
      source.type, 
      source.format, 
      source.town,
      source.rism_link, 
      source.catalogued,
      source.notes || null,
      source.from_year || null,
      source.to_year || null,
      source.from_year_annotation || null,
      source.to_year_annotation || null,
      now, 
      sourceId
    ]);
    
    // Update relationships (publishers, scribes, source images)
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

    // Step 2: Check for and process persistent temp_inclusions
    console.log('\n=== CHECKING FOR PERSISTENT TEMP_INCLUSIONS ===');
    
    // Check if persistent temp_inclusions table exists
    const tableExistsResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'temp_inclusions'
      ) as table_exists
    `);
    
    let stagedInclusionsCount = 0;
    
    if (tableExistsResult.rows[0].table_exists) {
      // Get any unprocessed temp inclusions for this source
      const stagedInclusions = await client.query(`
        SELECT * FROM temp_inclusions 
        WHERE source_id = $1
        ORDER BY position
      `, [sourceId]);
      
      stagedInclusionsCount = stagedInclusions.rows.length;
      
      if (stagedInclusionsCount > 0) {
        console.log(`Found ${stagedInclusionsCount} staged temp_inclusions to process`);
        
        // Collect processed temp_inclusion IDs for deletion
        const processedTempIds = [];
        
        // Process each staged inclusion
        for (const tempInclusion of stagedInclusions.rows) {
          console.log(`Processing staged inclusion: ${tempInclusion.composition_name}`);
          
          // Parse JSON data
          let clefs = [];
          let composerIds = [];
          try {
            if (tempInclusion.clefs) clefs = JSON.parse(tempInclusion.clefs);
            if (tempInclusion.composer_ids_json && tempInclusion.composer_ids_json !== '[]') {
              composerIds = JSON.parse(tempInclusion.composer_ids_json);
            }
          } catch (e) {
            console.error('Error parsing JSON:', e);
          }
          
          // Validate and default composer_ids to prevent null arrays
          if (!composerIds || composerIds.length === 0 || composerIds.every(id => !id || id === null)) {
            composerIds = [23]; // Default to Anon composer
            console.log(`Defaulting to Anon composer for temp inclusion: "${tempInclusion.composition_name}"`);
          } else {
            // Filter out any null values and ensure all are valid integers
            composerIds = composerIds.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id)))
                                    .map(id => parseInt(id));
            
            // If after filtering we have no valid IDs, default to Anon
            if (composerIds.length === 0) {
              composerIds = [23];
              console.log(`No valid composer IDs found, defaulting to Anon for temp inclusion: "${tempInclusion.composition_name}"`);
            }
          }
          
          // Create or find title
          let titleResult = await client.query(`SELECT id FROM titles WHERE text = $1`, [tempInclusion.composition_name]);
          let titleId;
          if (titleResult.rows.length > 0) {
            titleId = titleResult.rows[0].id;
          } else {
            const newTitleResult = await client.query(`
              INSERT INTO titles (text, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
            `, [tempInclusion.composition_name, now, now]);
            titleId = newTitleResult.rows[0].id;
          }
          
          // Handle composition type
          let compositionTypeId = tempInclusion.composition_type_id;
          if (!compositionTypeId && tempInclusion.composition_type) {
            const typeResult = await client.query(`SELECT id FROM composition_types WHERE name = $1`, [tempInclusion.composition_type]);
            if (typeResult.rows.length > 0) {
              compositionTypeId = parseInt(typeResult.rows[0].id);
            }
          }
          
          // Process tone and even_odd
          let tone = tempInclusion.tone;
          if (tone !== null) tone = convertToneToString(tone);
          
          let evenOdd = tempInclusion.even_odd;
          if (evenOdd === 'even') evenOdd = 0;
          else if (evenOdd === 'odd') evenOdd = 1;
          else if (evenOdd === 'both') evenOdd = 2;
          else if (typeof evenOdd === 'number') evenOdd = evenOdd;
          else evenOdd = null;
          
          const numberOfVoices = tempInclusion.number_of_voices ? parseInt(tempInclusion.number_of_voices) : null;
          const isAnonymous = composerIds.length === 0;
          
          // Check for existing composition
          let existingComposition;
          if (isAnonymous) {
            existingComposition = await client.query(`
              SELECT id, group_id FROM compositions 
              WHERE title_id = $1 
              AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
              AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
              AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
              AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
              AND (composer_id_list IS NULL OR composer_id_list = '{}')
            `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoices]);
          } else {
            existingComposition = await client.query(`
              SELECT id, group_id FROM compositions 
              WHERE title_id = $1 
              AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
              AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
              AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
              AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
              AND composer_id_list = $6
            `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoices, composerIds]);
          }
          
          let compositionId, groupId;
          if (existingComposition.rows.length > 0) {
            // Use existing composition
            compositionId = existingComposition.rows[0].id;
            groupId = existingComposition.rows[0].group_id;
            
            if (!groupId) {
              // Create group for existing composition
              const newGroupResult = await client.query(`
                INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
              `, [tempInclusion.composition_name, now, now]);
              groupId = newGroupResult.rows[0].id;
              await client.query(`UPDATE compositions SET group_id = $1 WHERE id = $2`, [groupId, compositionId]);
            }
          } else {
            // Create new group and composition
            const newGroupResult = await client.query(`
              INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
            `, [tempInclusion.composition_name, now, now]);
            groupId = newGroupResult.rows[0].id;
            
            const compositionResult = await client.query(`
              INSERT INTO compositions (title_id, composition_type_id, tone, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
            `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoices, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
            compositionId = compositionResult.rows[0].id;
          }
          
          // Create the inclusion
          await client.query(`
            INSERT INTO inclusions (
              source_id, composition_id, "order", position, notes, 
              attribution_texts, composer_ids, clefs, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            sourceId, 
            compositionId, 
            tempInclusion.position,
            tempInclusion.position?.toString() || '',
            '',
            JSON.stringify([tempInclusion.composers || '']),
            JSON.stringify(composerIds),
            JSON.stringify(clefs),
            now, 
            now
          ]);
          
          // Add to list of successfully processed temp inclusions
          processedTempIds.push(tempInclusion.id);
        }
        
        // Delete all successfully processed temp_inclusions
        if (processedTempIds.length > 0) {
          const deleteResult = await client.query(`
            DELETE FROM temp_inclusions WHERE id = ANY($1)
          `, [processedTempIds]);
          console.log(`Deleted ${deleteResult.rowCount} processed temp_inclusions`);
        }
        
        console.log(`Processed ${stagedInclusionsCount} staged inclusions`);
      } else {
        console.log('No staged temp_inclusions found for this source');
      }
    } else {
      console.log('temp_inclusions table does not exist');
    }

    // Step 3: Handle form inclusions 
    console.log('\n=== PROCESSING FORM INCLUSIONS ===');
    
    // Only process inclusions that have titles (non-empty rows)
    const processedInclusions = inclusions.filter(inclusion => 
      inclusion.composition?.title_text?.trim()
    );

    console.log(`Processing ${processedInclusions.length} inclusions with titles from form`);

    // Process each inclusion individually
    for (let i = 0; i < processedInclusions.length; i++) {
      const inclusion = processedInclusions[i];
      let compositionId = null;

      console.log(`Processing inclusion ${i + 1}: "${inclusion.composition.title_text}" (${inclusion.id ? 'existing ID: ' + inclusion.id : 'new'})`);

      // Calculate number of voices from clefs
      let numberOfVoices = null;
      if (inclusion.clefs && inclusion.clefs.length > 0) {
        numberOfVoices = inclusion.clefs.filter(clef => 
          clef.clef && clef.clef.trim() && !clef.optional
        ).length;
        numberOfVoices = numberOfVoices > 0 ? numberOfVoices : null;
      }

      // Create or find title
      let titleResult = await client.query(`SELECT id FROM titles WHERE text = $1`, [inclusion.composition.title_text]);
      let titleId;
      if (titleResult.rows.length > 0) {
        titleId = titleResult.rows[0].id;
      } else {
        const newTitleResult = await client.query(`
          INSERT INTO titles (text, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
        `, [inclusion.composition.title_text, now, now]);
        titleId = newTitleResult.rows[0].id;
      }

      // Handle composition type
      let compositionTypeId = null;
      if (inclusion.composition.composition_type_id) {
        compositionTypeId = parseInt(inclusion.composition.composition_type_id);
      } else if (inclusion.composition.composition_type_name) {
        const typeResult = await client.query(`SELECT id FROM composition_types WHERE name = $1`, [inclusion.composition.composition_type_name]);
        if (typeResult.rows.length > 0) {
          compositionTypeId = parseInt(typeResult.rows[0].id);
        }
      }

      // Process tone and even_odd
      let tone = inclusion.composition.tone;
      if (tone !== null && tone !== undefined) tone = convertToneToString(tone);
      
      let evenOdd = inclusion.composition.even_odd;
      if (evenOdd === 'even') evenOdd = 0;
      else if (evenOdd === 'odd') evenOdd = 1;
      else if (evenOdd === 'both') evenOdd = 2;
      else if (typeof evenOdd === 'number') evenOdd = evenOdd;
      else evenOdd = null;

      const numberOfVoicesInt = inclusion.composition.number_of_voices ? parseInt(inclusion.composition.number_of_voices) : numberOfVoices;
      
      // Validate and default composer_ids to prevent null arrays
      let composerIds = inclusion.composer_ids || [];
      
      // If composer_ids is empty or contains nulls, default to Anon (id=23)
      if (!composerIds || composerIds.length === 0 || composerIds.every(id => !id || id === null)) {
        composerIds = [23]; // Default to Anon composer
        console.log(`Defaulting to Anon composer for inclusion: "${inclusion.composition.title_text}"`);
      } else {
        // Filter out any null values and ensure all are valid integers
        composerIds = composerIds.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id)))
                                .map(id => parseInt(id));
        
        // If after filtering we have no valid IDs, default to Anon
        if (composerIds.length === 0) {
          composerIds = [23];
          console.log(`No valid composer IDs found, defaulting to Anon for inclusion: "${inclusion.composition.title_text}"`);
        }
      }
      
      const isAnonymous = composerIds.length === 1 && composerIds[0] === 23;

      // Check for existing composition
      let existingComposition = { rows: [] };
      
      if (isAnonymous) {
        existingComposition = await client.query(`
          SELECT id, group_id FROM compositions 
          WHERE title_id = $1 
          AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
          AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
          AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
          AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
          AND (composer_id_list IS NULL OR composer_id_list = '{}')
        `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt]);
      } else {
        existingComposition = await client.query(`
          SELECT id, group_id FROM compositions 
          WHERE title_id = $1 
          AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
          AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
          AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
          AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
          AND composer_id_list = $6
        `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt, composerIds]);
      }

      let groupId;
      if (existingComposition.rows.length > 0) {
        // Use existing composition
        compositionId = existingComposition.rows[0].id;
        groupId = existingComposition.rows[0].group_id;
        
        if (!groupId) {
          // Create group for existing composition
          const newGroupResult = await client.query(`
            INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
          `, [inclusion.composition.title_text, now, now]);
          groupId = newGroupResult.rows[0].id;
          await client.query(`UPDATE compositions SET group_id = $1 WHERE id = $2`, [groupId, compositionId]);
        }
      } else {
        // Create new group and composition
        const newGroupResult = await client.query(`
          INSERT INTO groups (display_title, created_at, updated_at) VALUES ($1, $2, $3) RETURNING id
        `, [inclusion.composition.title_text, now, now]);
        groupId = newGroupResult.rows[0].id;
        
        const compositionResult = await client.query(`
          INSERT INTO compositions (title_id, composition_type_id, tone, even_odd, number_of_voices, composer_id_list, group_id, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
        `, [titleId, compositionTypeId, tone, evenOdd, numberOfVoicesInt, composerIds.length > 0 ? composerIds : null, groupId, now, now]);
        compositionId = compositionResult.rows[0].id;
      }

      // Update existing inclusion or create new one
      if (inclusion.id) {
        // Update existing inclusion
        await client.query(`
          UPDATE inclusions SET 
            composition_id = $1, 
            "order" = $2, 
            position = $3, 
            notes = $4, 
            attribution_texts = $5, 
            composer_ids = $6, 
            clefs = $7, 
            updated_at = $8
          WHERE id = $9 AND source_id = $10
        `, [
          compositionId, 
          inclusion.order || (i + 1),
          inclusion.position || '',
          inclusion.notes || '',
          JSON.stringify(inclusion.attribution_texts || []),
          JSON.stringify(composerIds), // Use validated composerIds instead of raw inclusion.composer_ids
          JSON.stringify(inclusion.clefs || []),
          now,
          inclusion.id,
          sourceId
        ]);
        console.log(`Updated existing inclusion ID: ${inclusion.id}`);
      } else {
        // Create new inclusion
        const newInclusionResult = await client.query(`
          INSERT INTO inclusions (
            source_id, composition_id, "order", position, notes, 
            attribution_texts, composer_ids, clefs, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [
          sourceId, 
          compositionId, 
          inclusion.order || (i + 1),
          inclusion.position || '',
          inclusion.notes || '',
          JSON.stringify(inclusion.attribution_texts || []),
          JSON.stringify(composerIds), // Use validated composerIds instead of raw inclusion.composer_ids
          JSON.stringify(inclusion.clefs || []),
          now, 
          now
        ]);
        console.log(`Created new inclusion ID: ${newInclusionResult.rows[0].id}`);
      }
    }

    // Log audit entry for source/inclusion changes
    try {
      await client.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'UPDATE',
          'sources',
          sourceId,
          JSON.stringify({ 
            action: 'source_inclusions_update',
            sourceCode: source.code,
            sourceTitle: source.title,
            stagedInclusionsCount: stagedInclusionsCount,
            formInclusionsCount: processedInclusions.length
          }),
          JSON.stringify({ 
            action: 'source_inclusions_update',
            sourceCode: source.code,
            sourceTitle: source.title,
            totalInclusionsProcessed: stagedInclusionsCount + processedInclusions.length,
            stagedInclusionsCount: stagedInclusionsCount,
            formInclusionsCount: processedInclusions.length,
            inclusions: processedInclusions.map(inc => ({
              compositionTitle: inc.composition?.title_text,
              composerIds: inc.composer_ids,
              clefs: inc.clefs?.length || 0
            }))
          })
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    await client.query('COMMIT');
    
    console.log(`\n=== SAVE COMPLETE ===`);
    console.log(`Processed ${stagedInclusionsCount} staged inclusions`);
    console.log(`Processed ${processedInclusions.length} form inclusions`);
    console.log(`====================\n`);
    
    res.json({ 
      success: true, 
      message: `Source saved successfully. Processed ${stagedInclusionsCount} staged inclusions and ${processedInclusions.length} form inclusions.`,
      processedStagedInclusions: stagedInclusionsCount,
      processedFormInclusions: processedInclusions.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving source with inclusions:', error);
    res.status(500).json({ error: 'Failed to save source and inclusions' });
  } finally {
    client.release();
  }
});

// DELETE individual inclusion endpoint
router.delete('/inclusions/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  const client = await pool.connect();
  
  try {
    console.log(`Deleting inclusion with ID: ${id}`);
    
    // Get inclusion details before deletion for audit trail
    const inclusionResult = await client.query(`
      SELECT i.*, s.code as source_code, s.title as source_title, c.title_id, t.text as composition_title
      FROM inclusions i
      JOIN sources s ON i.source_id = s.id
      JOIN compositions c ON i.composition_id = c.id
      JOIN titles t ON c.title_id = t.id
      WHERE i.id = $1
    `, [id]);
    
    if (inclusionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Inclusion not found' });
    }
    
    const inclusion = inclusionResult.rows[0];
    
    const deleteResult = await client.query(
      'DELETE FROM inclusions WHERE id = $1 RETURNING *',
      [id]
    );
    
    // Log audit entry for inclusion deletion
    try {
      await client.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'DELETE',
          'inclusions',
          parseInt(id),
          JSON.stringify({
            id: inclusion.id,
            source_id: inclusion.source_id,
            source_code: inclusion.source_code,
            source_title: inclusion.source_title,
            composition_id: inclusion.composition_id,
            composition_title: inclusion.composition_title,
            order: inclusion.order,
            position: inclusion.position,
            notes: inclusion.notes,
            composer_ids: inclusion.composer_ids,
            clefs: inclusion.clefs
          }),
          null
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }
    
    console.log(`Successfully deleted inclusion ${id}`);
    res.json({ 
      success: true, 
      message: 'Inclusion deleted successfully',
      deletedInclusion: deleteResult.rows[0]
    });
    
  } catch (error) {
    console.error('Error deleting inclusion:', error);
    res.status(500).json({ error: 'Failed to delete inclusion' });
  } finally {
    client.release();
  }
});

export default router; 