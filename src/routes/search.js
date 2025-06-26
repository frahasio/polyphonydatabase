import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Main public search endpoint for groups
router.get('/groups', async (req, res) => {
  try {
    const {
      title = '',
      composers = '',
      voices = '',
      functions = '',
      languages = '',
      countries = '',
      sources = '',
      publishers = '',
      cities = '',
      composition_types = '',
      tones = '',
      even_odd = '',
      voicing = '',
      has_editions = 'false',
      has_recordings = 'false',
      page = 1,
      page_size = 25
    } = req.query;

    const limit = parseInt(page_size);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Parse multi-select parameters (comma-separated)
    const composerIds = composers && composers.trim() ? composers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const voiceOptions = voices && voices.trim() ? voices.split(',').map(v => parseInt(v)).filter(v => !isNaN(v)) : [];
    const functionIds = functions && functions.trim() ? functions.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const languageIds = languages && languages.trim() ? languages.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const countryNames = countries && countries.trim() ? countries.split(',').map(country => country.trim()).filter(country => country) : [];
    const sourceIds = sources && sources.trim() ? sources.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const publisherIds = publishers && publishers.trim() ? publishers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const cityNames = cities && cities.trim() ? cities.split(',').map(city => city.trim()).filter(city => city) : [];
    const compositionTypeIds = composition_types && composition_types.trim() ? composition_types.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const toneValues = tones && tones.trim() ? tones.split(',').map(tone => tone.trim()).filter(tone => tone) : [];
    const evenOddValues = even_odd && even_odd.trim() ? even_odd.split(',').map(eo => eo.trim()).filter(eo => eo && !isNaN(parseInt(eo))) : [];
    const voicingIds = voicing && voicing.trim() ? voicing.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const hasEditions = has_editions === 'true';
    const hasRecordings = has_recordings === 'true';

    let whereConditions = [];
    let queryParams = [];
        let paramIndex = 1;

    // Title search - search both group display_title AND composition titles
    if (title.trim()) {
      whereConditions.push(`(
        g.display_title ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM compositions c2
          JOIN titles t2 ON c2.title_id = t2.id
          WHERE c2.group_id = g.id AND t2.text ILIKE $${paramIndex}
        )
      )`);
      queryParams.push(`%${title.trim()}%`);
      paramIndex++;
    }

    // Composers filter
    if (composerIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id 
        AND c2.composer_id_list && $${paramIndex}::integer[]
      )`);
      queryParams.push(composerIds);
      paramIndex++;
    }

    // Voices filter
    if (voiceOptions.length > 0) {
      const voiceConditions = voiceOptions.map((voiceCount, index) => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.number_of_voices = $${paramIndex}
        )`;
        queryParams.push(voiceCount);
        paramIndex++;
        return condition;
      });
      whereConditions.push(`(${voiceConditions.join(' OR ')})`);
    }

    // Functions filter
    if (functionIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN titles t2 ON c2.title_id = t2.id
        JOIN functions_titles ft ON t2.id = ft.title_id
        WHERE c2.group_id = g.id AND ft.function_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(functionIds);
      paramIndex++;
    }

    // Languages filter
    if (languageIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN titles t2 ON c2.title_id = t2.id
        WHERE c2.group_id = g.id AND t2.language = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(languageIds);
      paramIndex++;
    }

    // Countries filter (composer birth countries) - optimized
    if (countryNames.length > 0) {
      whereConditions.push(`g.id IN (
        SELECT DISTINCT c2.group_id
        FROM compositions c2
        JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
        WHERE comp.birthplace_2 = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(countryNames);
      paramIndex++;
    }

    // Sources filter (from inclusions)
    if (sourceIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        WHERE c2.group_id = g.id AND i.source_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(sourceIds);
      paramIndex++;
    }

    // Publishers filter
    if (publisherIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        JOIN sources s ON i.source_id = s.id
        JOIN publishers_sources ps ON s.id = ps.source_id
        WHERE c2.group_id = g.id AND ps.publisher_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(publisherIds);
      paramIndex++;
    }

    // Cities filter (publication places)
    if (cityNames.length > 0) {
      const cityConditions = cityNames.map((cityName, index) => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          JOIN inclusions i ON c2.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          WHERE c2.group_id = g.id AND s.town ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${cityName}%`);
        paramIndex++;
        return condition;
      });
      whereConditions.push(`(${cityConditions.join(' OR ')})`);
    }

    // Has editions filter
    if (hasEditions) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM editions e
        WHERE e.group_id = g.id
      )`);
    }

    // Has recordings filter
    if (hasRecordings) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM recordings r
        WHERE r.group_id = g.id
      )`);
    }

    // Composition types filter
    if (compositionTypeIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id AND c2.composition_type_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(compositionTypeIds);
      paramIndex++;
    }

    // Tones filter  
    if (toneValues.length > 0) {
      // Use tone values directly as strings for database query
      const validToneValues = toneValues.filter(val => val && val.trim());
      
      if (validToneValues.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.tone = ANY($${paramIndex}::text[])
        )`);
        queryParams.push(validToneValues);
        paramIndex++;
      }
    }

    // Even/Odd filter
    if (evenOddValues.length > 0) {
      const validEvenOddIntegers = evenOddValues.map(val => parseInt(val)).filter(val => !isNaN(val));
      if (validEvenOddIntegers.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.even_odd = ANY($${paramIndex}::integer[])
        )`);
        queryParams.push(validEvenOddIntegers);
        paramIndex++;
      }
    }

    // Voicing filter (database-driven clef combinations) - skip if tables don't exist
    if (voicingIds.length > 0) {
      try {
        console.log('Voicing filter: trying fast path with new columns...');
        
        // Get clef combinations associated with selected voicings
        const voicingClefsQuery = `
          SELECT DISTINCT cc.clef_combination
          FROM clef_combinations_voicings ccv
          JOIN clef_combinations cc ON ccv.clef_combination_id = cc.id
          WHERE ccv.voicing_id = ANY($${paramIndex}::integer[])
        `;
        
        const voicingClefsResult = await pool.query(voicingClefsQuery, [voicingIds]);
        console.log('Found clef combinations for voicings:', voicingClefsResult.rows.length);
        
        if (voicingClefsResult.rows.length > 0) {
          // Use the new indexed sorted_clef_combination column for fast matching
          const targetClefCombinations = voicingClefsResult.rows
            .map(row => row.clef_combination)
            .filter(combo => combo && combo.trim());
          
          console.log('Target clef combinations:', targetClefCombinations);
          
          if (targetClefCombinations.length > 0) {
            // Test if the new columns exist with a simple query first
            try {
              await pool.query('SELECT sorted_clef_combination_required FROM inclusions LIMIT 1');
              console.log('New columns exist, using fast path');
              
              // Use the fast indexed approach
              const clefCombosParam = `$${paramIndex + 1}`;
              const condition = `EXISTS (
                SELECT 1 FROM compositions c2
                JOIN inclusions i ON c2.id = i.composition_id
                WHERE c2.group_id = g.id 
                AND (
                  i.sorted_clef_combination_required = ANY(${clefCombosParam}::text[])
                  OR i.sorted_clef_combination_all = ANY(${clefCombosParam}::text[])
                )
              )`;
              
              whereConditions.push(condition);
              queryParams.push(targetClefCombinations);
              paramIndex++; // We only used one parameter (same array for both conditions)
            } catch (columnError) {
              console.log('New columns do not exist, falling back to old logic');
              throw columnError; // This will trigger the fallback
            }
          }
        }
              } catch (voicingError) {
        console.error('Voicing filter skipped (tables may not exist):', voicingError.message);
        // Fallback to old logic if new column doesn't exist yet
        try {
          const voicingClefsQuery = `
            SELECT DISTINCT cc.clef_combination
            FROM clef_combinations_voicings ccv
            JOIN clef_combinations cc ON ccv.clef_combination_id = cc.id
            WHERE ccv.voicing_id = ANY($${paramIndex}::integer[])
          `;
          
          const voicingClefsResult = await pool.query(voicingClefsQuery, [voicingIds]);
          paramIndex++; // Increment parameter index for fallback query
          
          if (voicingClefsResult.rows.length > 0) {
            // Define clef display order for sorting (fallback logic)
            const clefDisplayOrder = [
              'g1', 'g2', 'g3', 'c1', 'g4', 'c2', 'g5', 'c3', 'f1', 'g28', 'c4', 'f2', 'c5', 'd1', 'f3', 'd2', 'f4', 'd3', 'y1', 'f5', 'd4', 'y2', 'd5', 'y3', 'y4', 'y5', 'x1', 'x2', 'x3', 'x4', 'x5', 'org', 'bc', 'lut'
            ];
            
            const voicingConditions = voicingClefsResult.rows.map((row) => {
              const targetClefCombination = row.clef_combination;
              if (!targetClefCombination) return null;
              
              const condition = `EXISTS (
                SELECT 1 FROM compositions c2
                JOIN inclusions i ON c2.id = i.composition_id
                WHERE c2.group_id = g.id 
                AND i.clefs IS NOT NULL
                AND (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${clefDisplayOrder.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
                  AND clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) = '${targetClefCombination}'
              )`;
              
              return condition;
            }).filter(condition => condition !== null);
            
            if (voicingConditions.length > 0) {
              whereConditions.push(`(${voicingConditions.join(' OR ')})`);
            }
          }
        } catch (fallbackError) {
          console.error('Voicing filter completely failed:', fallbackError.message);
        }
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT g.id) as total
      FROM groups g
      ${whereClause}
    `;

    // Main search query with all related data
    const searchQuery = `
      SELECT 
        g.id,
        g.display_title,
        g.created_at,
        g.updated_at,
        -- Get composer information with conflict detection
        (
          WITH group_composers AS (
            SELECT DISTINCT comp.id, comp.name, comp.from_year, comp.to_year
            FROM compositions c
            CROSS JOIN unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS composer_id
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id AND c.composer_id_list IS NOT NULL
          )
          SELECT 
            CASE 
              WHEN COUNT(*) > 1 THEN 'conflicting attributions'
              ELSE MAX(name)
            END
          FROM group_composers
        ) as composer_display,
        (
          WITH group_composers AS (
            SELECT DISTINCT comp.id, comp.name, comp.from_year, comp.to_year, 
                   comp.from_year_annotation, comp.to_year_annotation
            FROM compositions c
            CROSS JOIN unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) AS composer_id
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id AND c.composer_id_list IS NOT NULL
          )
          SELECT 
            CASE 
              WHEN COUNT(*) > 1 THEN NULL
              ELSE MAX(CASE 
                WHEN from_year IS NOT NULL AND to_year IS NOT NULL 
                THEN '(' || 
                     COALESCE(from_year_annotation || ' ', '') || from_year || '–' || 
                     COALESCE(to_year_annotation || ' ', '') || to_year || ')'
                WHEN from_year IS NOT NULL 
                THEN '(' || COALESCE(from_year_annotation || ' ', '') || from_year || '–)'
                WHEN to_year IS NOT NULL 
                THEN '(–' || COALESCE(to_year_annotation || ' ', '') || to_year || ')'
                ELSE NULL
              END)
            END
          FROM group_composers
        ) as composer_dates,
        (
          SELECT array_agg(voice_count ORDER BY voice_count)
          FROM (
            SELECT DISTINCT c.number_of_voices as voice_count
            FROM compositions c
            WHERE c.group_id = g.id AND c.number_of_voices IS NOT NULL
          ) voices
        ) as voice_counts,
        -- Get tone and even/odd information
        (
          SELECT DISTINCT c.tone
          FROM compositions c
          WHERE c.group_id = g.id AND c.tone IS NOT NULL 
          LIMIT 1
        ) as tone,
        (
          SELECT DISTINCT c.even_odd
          FROM compositions c
          WHERE c.group_id = g.id AND c.even_odd IS NOT NULL
          LIMIT 1
        ) as even_odd,
        (
          SELECT array_agg(func_name ORDER BY func_name)
          FROM (
            SELECT DISTINCT 
              CASE 
                WHEN ct.name IS NOT NULL AND func.name IS NOT NULL THEN '(' || ct.name || ') ' || func.name
                WHEN ct.name IS NOT NULL THEN '(' || ct.name || ')'
                WHEN func.name IS NOT NULL THEN func.name
                ELSE NULL
              END as func_name
            FROM compositions c
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            JOIN titles t ON c.title_id = t.id
            LEFT JOIN functions_titles ft ON t.id = ft.title_id
            LEFT JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id AND (func.name IS NOT NULL OR ct.name IS NOT NULL)
          ) funcs
          WHERE func_name IS NOT NULL
        ) as function_names,
        -- Get editions for this group
        (
          SELECT json_agg(json_build_object(
            'id', e.id,
            'editor_name', ed.name,
            'voicing', e.voicing,
            'file_url', e.file_url
          ) ORDER BY ed.name)
          FROM editions e
          LEFT JOIN editors ed ON e.editor_id = ed.id
          WHERE e.group_id = g.id
        ) as editions,
        -- Get recordings for this group
        (
          SELECT json_agg(json_build_object(
            'id', r.id,
            'performer_name', p.name,
            'file_url', r.file_url
          ) ORDER BY p.name)
          FROM recordings r
          LEFT JOIN performers p ON r.performer_id = p.id
          WHERE r.group_id = g.id
        ) as recordings,
        -- Get sources for this group
        (
          SELECT json_agg(json_build_object(
            'id', s.id,
            'code', s.code,
            'title', s.title,
            'type', s.type,
            'format', s.format,
            'town', s.town,
            'from_year', s.from_year,
            'to_year', s.to_year,
            'rism_link', s.rism_link,
            'source_notes', s.notes,
            'position', i.position,
            'attribution_texts', i.attribution_texts,
            'inclusion_notes', i.notes,
            'clefs', i.clefs,
            'publishers', COALESCE(pubs.publishers, '[]'::json),
            'scribes', COALESCE(scr.scribes, '[]'::json),
            'source_images', COALESCE(imgs.images, '[]'::json)
          ) ORDER BY s.code, s.title)
          FROM compositions comp
          JOIN inclusions i ON comp.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          LEFT JOIN (
            SELECT ps.source_id, json_agg(p.name ORDER BY p.name) as publishers
            FROM publishers_sources ps
            JOIN publishers p ON ps.publisher_id = p.id
            GROUP BY ps.source_id
          ) pubs ON s.id = pubs.source_id
          LEFT JOIN (
            SELECT ss.source_id, json_agg(sc.name ORDER BY sc.name) as scribes
            FROM scribes_sources ss
            JOIN scribes sc ON ss.scribe_id = sc.id
            GROUP BY ss.source_id
          ) scr ON s.id = scr.source_id
          LEFT JOIN (
            SELECT si.source_id, json_agg(json_build_object(
              'id', si.id,
              'url', si.url,
              'label', si.label
            ) ORDER BY si.id) as images
            FROM source_images si
            GROUP BY si.source_id
          ) imgs ON s.id = imgs.source_id
          WHERE comp.group_id = g.id
        ) as sources
      FROM groups g
      ${whereClause}
      GROUP BY g.id, g.display_title, g.created_at, g.updated_at
      ORDER BY g.display_title
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    // Ensure limit and offset are valid integers
    const finalLimit = parseInt(limit) || 25;
    const finalOffset = parseInt(offset) || 0;
    
        queryParams.push(finalLimit, finalOffset);

    // Add debugging to help track down the issue
    console.log('=== SEARCH DEBUG ===');
    console.log('Query parameters:', queryParams);
    console.log('Parameter count:', queryParams.length);
    console.log('Where conditions:', whereConditions.length);
    
    const [countResult, searchResult] = await Promise.all([
      pool.query(countQuery, queryParams.slice(0, -2)),
      pool.query(searchQuery, queryParams)
    ]);
    
    console.log('Search completed successfully, found:', countResult.rows[0]?.total, 'total results');

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      groups: searchResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error in public groups search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Public endpoints for filter data (no authentication required)
router.get('/composers', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT c.id, c.name
      FROM composers c
      INNER JOIN (
        SELECT DISTINCT unnest(composer_id_list) as composer_id
        FROM compositions comp
        INNER JOIN groups g ON comp.group_id = g.id
      ) comp_composers ON c.id = comp_composers.composer_id
      WHERE c.name IS NOT NULL
      ORDER BY c.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/functions', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT f.id, f.name
      FROM functions f
      INNER JOIN functions_titles ft ON f.id = ft.function_id
      INNER JOIN titles t ON ft.title_id = t.id
      INNER JOIN compositions c ON t.id = c.title_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY f.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching functions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/languages', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT l.id, l.language as name
      FROM languages l
      INNER JOIN titles t ON l.id = t.language
      INNER JOIN compositions c ON t.id = c.title_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY l.language
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching languages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/countries', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT comp.birthplace_2 as name
      FROM composers comp
      INNER JOIN (
        SELECT DISTINCT unnest(composer_id_list) as composer_id
        FROM compositions
        WHERE composer_id_list IS NOT NULL
      ) used_composers ON comp.id = used_composers.composer_id
      WHERE comp.birthplace_2 IS NOT NULL AND comp.birthplace_2 != ''
      ORDER BY comp.birthplace_2
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sources', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.id, s.code
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.code IS NOT NULL AND s.catalogued = true
      ORDER BY s.code
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/publishers', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT p.id, p.name
      FROM publishers p
      INNER JOIN publishers_sources ps ON p.id = ps.publisher_id
      INNER JOIN sources s ON ps.source_id = s.id
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.catalogued = true
      ORDER BY p.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cities', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.town as name
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.town IS NOT NULL AND s.town != '' AND s.catalogued = true
      ORDER BY s.town
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/voicings', async (req, res) => {
  try {
    const query = `
      SELECT id, voicing as name
      FROM voicings
      ORDER BY voicing
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching voicings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/voices', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT number_of_voices as voice_count
      FROM compositions
      WHERE number_of_voices IS NOT NULL
      ORDER BY number_of_voices
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({ value: row.voice_count, name: row.voice_count.toString() })));
  } catch (error) {
    console.error('Error fetching voice counts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/composition-types', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ct.id, ct.name
      FROM composition_types ct
      INNER JOIN compositions c ON ct.id = c.composition_type_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY ct.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composition types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/tones', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT tone
      FROM compositions
      WHERE tone IS NOT NULL 
      ORDER BY tone
    `;
    const result = await pool.query(query);
    
    const toneMapping = {
      "1": "primi toni",
      "2": "secundi toni", 
      "3": "tertii toni",
      "4": "quarti toni",
      "5": "quinti toni",
      "6": "sexti toni",
      "7": "septimi toni",
      "8": "octavi toni",
      "9": "noni toni",
      "12": "duodecimi toni",
      "mix": "mixti toni",
      "per": "peregrini toni",
      "pro": "proprii toni"
    };
    
    res.json(result.rows.map(row => ({ 
      value: row.tone, 
      name: toneMapping[row.tone] || `Tone ${row.tone}` 
    })));
  } catch (error) {
    console.error('Error fetching tones:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/even-odd', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT even_odd
      FROM compositions
      WHERE even_odd IS NOT NULL
      ORDER BY even_odd
    `;
    const result = await pool.query(query);
    const evenOddMapping = {
      0: 'even',
      1: 'odd', 
      2: 'both'
    };
    res.json(result.rows.map(row => ({ 
      value: row.even_odd, 
      name: evenOddMapping[row.even_odd] || row.even_odd 
    })));
  } catch (error) {
    console.error('Error fetching even/odd values:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/voicings', async (req, res) => {
  try {
    const query = `
      SELECT id, voicing as name
      FROM voicings
      ORDER BY voicing
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.log('Voicings table not found, returning empty array:', error.message);
    // Return empty array if voicings table doesn't exist yet
    res.json([]);
  }
});



export default router; 