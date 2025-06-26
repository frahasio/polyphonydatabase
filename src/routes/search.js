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
      voice_quantities = '',
      has_editions = 'false',
      has_recordings = 'false',
      page = 1,
      page_size = 25
    } = req.query;

    const limit = parseInt(page_size);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Parse multi-select parameters (comma-separated)
    const composerIds = composers ? composers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const voiceOptions = voices ? voices.split(',').map(v => parseInt(v)).filter(v => !isNaN(v)) : [];
    const functionIds = functions ? functions.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const languageIds = languages ? languages.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const countryNames = countries ? countries.split(',').map(country => country.trim()).filter(country => country) : [];
    const sourceIds = sources ? sources.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const publisherIds = publishers ? publishers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const cityNames = cities ? cities.split(',').map(city => city.trim()).filter(city => city) : [];
    const compositionTypeIds = composition_types ? composition_types.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const toneValues = tones ? tones.split(',').map(tone => tone.trim()).filter(tone => tone) : [];
    const evenOddValues = even_odd ? even_odd.split(',').map(eo => eo.trim()).filter(eo => eo) : [];
    const voiceQuantitiesData = voice_quantities ? JSON.parse(voice_quantities) : {};
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

    // Countries filter (composer birth countries)
    if (countryNames.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id 
        AND EXISTS (
          SELECT 1 FROM unnest(c2.composer_id_list) AS composer_id
          JOIN composers comp ON comp.id = composer_id
          WHERE comp.birthplace_2 = ANY($${paramIndex}::text[])
        )
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
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id AND c2.tone = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(toneValues);
      paramIndex++;
    }

    // Even/Odd filter
    if (evenOddValues.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id AND c2.even_odd = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(evenOddValues);
      paramIndex++;
    }

    // Voicing filter (voice quantity-based clef combinations)
    if (Object.keys(voiceQuantitiesData).length > 0) {
      // Define which clefs can represent each voice type (same as in find-voicing-matches)
      const voiceToClefs = {
        'S': ['g1', 'g2', 'c1'],
        'Mz': ['g2', 'c1', 'c2'],
        'A': ['c2', 'c3'],
        'T': ['c3', 'c4'],
        'Bar': ['c4', 'f3'],
        'B': ['f3', 'f4']
      };

      // Generate possible clef combinations (simplified version)
      const clefCombinations = [];
      const requiredVoices = [];
      
      for (const [voiceType, quantity] of Object.entries(voiceQuantitiesData)) {
        if (quantity > 0) {
          for (let i = 0; i < quantity; i++) {
            requiredVoices.push(voiceType);
          }
        }
      }

      if (requiredVoices.length > 0) {
        // Generate a few common clef combinations for this voice setup
        const firstCombination = requiredVoices.map(voice => voiceToClefs[voice]?.[0]).filter(c => c);
        if (firstCombination.length === requiredVoices.length) {
          clefCombinations.push(firstCombination);
        }

        const voicingConditions = clefCombinations.map((clefCombo) => {
          const condition = `EXISTS (
            SELECT 1 FROM compositions c2
            JOIN inclusions i ON c2.id = i.composition_id
            WHERE c2.group_id = g.id 
            AND i.clefs @> $${paramIndex}::jsonb
          )`;
          
          // Convert clef array to the format expected in database
          const clefObjects = clefCombo.map(clef => ({ clef: clef }));
          queryParams.push(JSON.stringify(clefObjects));
          paramIndex++;
          return condition;
        });
        
        if (voicingConditions.length > 0) {
          whereConditions.push(`(${voicingConditions.join(' OR ')})`);
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
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
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
            SELECT DISTINCT comp.id, comp.name, comp.from_year, comp.to_year
            FROM compositions c
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
          )
          SELECT 
            CASE 
              WHEN COUNT(*) > 1 THEN NULL
              ELSE MAX(CASE 
                WHEN from_year IS NOT NULL AND to_year IS NOT NULL 
                THEN '(' || from_year || '–' || to_year || ')'
                WHEN from_year IS NOT NULL 
                THEN '(' || from_year || '–)'
                WHEN to_year IS NOT NULL 
                THEN '(–' || to_year || ')'
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

    queryParams.push(parseInt(limit), offset);

    const [countResult, searchResult] = await Promise.all([
      pool.query(countQuery, queryParams.slice(0, -2)),
      pool.query(searchQuery, queryParams)
    ]);

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
      WITH composer_ids_in_groups AS (
        SELECT DISTINCT unnest(c.composer_id_list) as composer_id
        FROM compositions c
        INNER JOIN groups g ON c.group_id = g.id
        WHERE c.composer_id_list IS NOT NULL
      )
      SELECT DISTINCT comp.birthplace_2 as name
      FROM composers comp
      INNER JOIN composer_ids_in_groups cig ON comp.id = cig.composer_id
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
      SELECT id, code
      FROM sources
      WHERE code IS NOT NULL AND catalogued = true
      ORDER BY code
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
      WHERE tone IS NOT NULL AND tone != '' AND tone ~ '^[0-9]+$|^[a-zA-Z]+$'
      ORDER BY tone
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({ value: row.tone, name: row.tone })));
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

// Dynamic voicing system - quantity-based voice selection
router.get('/voicing-options', async (req, res) => {
  try {
    // Return voice types with quantity options (0-10 for each type)
    const voiceTypes = [
      { value: 'S', name: 'Soprano' },
      { value: 'Mz', name: 'Mezzo-soprano' },
      { value: 'A', name: 'Alto' },
      { value: 'T', name: 'Tenor' },
      { value: 'Bar', name: 'Baritone' },
      { value: 'B', name: 'Bass' }
    ];
    res.json(voiceTypes);
  } catch (error) {
    console.error('Error fetching voicing options:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/find-voicing-matches', async (req, res) => {
  try {
    const { voiceQuantities } = req.body; // e.g., { S: 2, A: 2, T: 1, B: 1 }
    
    if (!voiceQuantities || Object.keys(voiceQuantities).length === 0) {
      return res.json({ clef_combinations: [] });
    }

    // Define which clefs can represent each voice type
    const voiceToClefs = {
      'S': ['g1', 'g2', 'c1'],
      'Mz': ['g2', 'c1', 'c2'],
      'A': ['c2', 'c3'],
      'T': ['c3', 'c4'],
      'Bar': ['c4', 'f3'],
      'B': ['f3', 'f4']
    };

    // Generate all possible clef combinations for the requested voice quantities
    function generateClefCombinations(voiceQuantities) {
      const combinations = [];
      
      // Convert voice quantities to a list of required voices
      const requiredVoices = [];
      for (const [voiceType, quantity] of Object.entries(voiceQuantities)) {
        if (quantity > 0) {
          for (let i = 0; i < quantity; i++) {
            requiredVoices.push(voiceType);
          }
        }
      }

      if (requiredVoices.length === 0) return [];

      // Generate all possible clef assignments for these voices
      function generateAssignments(voiceIndex, currentAssignment) {
        if (voiceIndex >= requiredVoices.length) {
          combinations.push([...currentAssignment]);
          return;
        }

        const voiceType = requiredVoices[voiceIndex];
        const possibleClefs = voiceToClefs[voiceType] || [];
        
        for (const clef of possibleClefs) {
          currentAssignment[voiceIndex] = clef;
          generateAssignments(voiceIndex + 1, currentAssignment);
        }
      }

      generateAssignments(0, []);
      return combinations;
    }

    const possibleCombinations = generateClefCombinations(voiceQuantities);
    
    if (possibleCombinations.length === 0) {
      return res.json({ clef_combinations: [] });
    }

    // Find inclusions that match these exact clef combinations
    const matchingCombinations = [];
    
    for (const clefCombo of possibleCombinations.slice(0, 50)) { // Limit to prevent too many queries
      const clefQuery = `
        SELECT DISTINCT clefs, id
        FROM inclusions
        WHERE clefs IS NOT NULL 
        AND jsonb_array_length(clefs) >= $1
      `;
      
      const result = await pool.query(clefQuery, [clefCombo.length]);
      
      for (const row of result.rows) {
        const clefs = row.clefs;
        if (!Array.isArray(clefs)) continue;

        // Extract just the vocal clefs (exclude instrumental)
        const vocalClefs = clefs
          .filter(c => c.clef && !['org', 'bc', 'lut'].includes(c.clef.trim()) && !c.optional)
          .map(c => c.clef.trim())
          .sort();

        if (vocalClefs.length === clefCombo.length && 
            clefCombo.slice().sort().join(',') === vocalClefs.join(',')) {
          
          const instrumentalClefs = clefs
            .filter(c => c.clef && ['org', 'bc', 'lut'].includes(c.clef.trim()))
            .map(c => c.clef.trim());

          matchingCombinations.push({
            clefs: clefCombo.concat(instrumentalClefs),
            voice_combination: Object.entries(voiceQuantities)
              .filter(([voice, qty]) => qty > 0)
              .map(([voice, qty]) => qty > 1 ? `${qty}${voice}` : voice)
              .join(''),
            has_instrumental: instrumentalClefs.length > 0,
            example_inclusion_id: row.id
          });
          break; // Found a match for this combination
        }
      }
    }

    // Remove duplicates and sort by commonality
    const uniqueCombinations = matchingCombinations
      .filter((combo, index, self) => 
        index === self.findIndex(c => 
          JSON.stringify(c.clefs.sort()) === JSON.stringify(combo.clefs.sort())
        )
      )
      .slice(0, 20); // Limit results

    res.json({ 
      clef_combinations: uniqueCombinations,
      total_found: uniqueCombinations.length 
    });

  } catch (error) {
    console.error('Error finding voicing matches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 