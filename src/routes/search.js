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
      // Convert tone values to integers for database query
      const toneIntegers = toneValues.map(val => {
        if (!val) return null;
        // If it's already a number, use it
        if (!isNaN(val)) return parseInt(val);
        // Handle special string values
        const specialTones = { 'mix': 10, 'per': 11, 'pro': 13 };
        return specialTones[val] || parseInt(val) || null;
      }).filter(val => val !== null);
      
      if (toneIntegers.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.tone = ANY($${paramIndex}::integer[])
        )`);
        queryParams.push(toneIntegers);
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
        // Get clef combinations associated with selected voicings
        const voicingClefsQuery = `
          SELECT DISTINCT cc.clefcombo
          FROM clef_combos_voicings ccv
          JOIN clef_combinations cc ON ccv.clef_combo_id = cc.id
          WHERE ccv.voicing_id = ANY($${paramIndex}::integer[])
        `;
        
        const voicingClefsResult = await pool.query(voicingClefsQuery, [voicingIds]);
        
        if (voicingClefsResult.rows.length > 0) {
          const voicingConditions = voicingClefsResult.rows.map((row) => {
            paramIndex++;
            // Convert clef combo string to clef array for JSON matching
            const clefArray = row.clefcombo.match(/(g[0-9]|c[0-9]|f[0-9]|x[0-9]|y[0-9]|d[0-9]|lut|org|bc)/g);
            const clefObjects = clefArray.map(clef => ({ clef }));
            
            const condition = `EXISTS (
              SELECT 1 FROM compositions c2
              JOIN inclusions i ON c2.id = i.composition_id
              WHERE c2.group_id = g.id 
              AND i.clefs @> $${paramIndex}::jsonb
            )`;
            
            queryParams.push(JSON.stringify(clefObjects));
            return condition;
          });
          
          if (voicingConditions.length > 0) {
            whereConditions.push(`(${voicingConditions.join(' OR ')})`);
          }
        }
      } catch (voicingError) {
        console.error('Voicing filter skipped (tables may not exist):', voicingError.message);
        // Skip voicing filter if tables don't exist yet
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT g.id) as total
      FROM groups g
      ${whereClause}
    `;

    // Simplified search query to identify core issues
    const searchQuery = `
      SELECT 
        g.id,
        g.display_title,
        g.created_at,
        g.updated_at,
        'Simplified query' as composer_display,
        NULL as composer_dates,
        NULL as voice_counts,
        NULL as tone,
        NULL as even_odd,
        NULL as function_names,
        NULL as editions,
        NULL as recordings,
        NULL as sources
      FROM groups g
      ${whereClause}
      ORDER BY g.display_title
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    // Ensure limit and offset are valid integers
    const finalLimit = parseInt(limit) || 25;
    const finalOffset = parseInt(offset) || 0;
    
        queryParams.push(finalLimit, finalOffset);

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
    console.error('Error position:', error.position || 'N/A');
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
      0: "primi toni",
      1: "secundi toni", 
      2: "tertii toni",
      3: "quarti toni",
      4: "quinti toni",
      5: "sexti toni",
      6: "septimi toni",
      7: "octavi toni",
      8: "noni toni",
      9: "duodecimi toni",
      10: "mixti toni",
      11: "peregrini toni",
      12: "proprii toni"
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