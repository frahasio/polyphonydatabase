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
      page = 1,
      page_size = 25
    } = req.query;

    const limit = parseInt(page_size);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Parse multi-select parameters (comma-separated)
    const composerIds = composers ? composers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const voiceOptions = voices ? voices.split(',') : [];
    const functionIds = functions ? functions.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const languageIds = languages ? languages.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const countryIds = countries ? countries.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const sourceIds = sources ? sources.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const publisherIds = publishers ? publishers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const cityNames = cities ? cities.split(',').map(city => city.trim()).filter(city => city) : [];

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
      const voiceConditions = voiceOptions.map(() => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.number_of_voices = $${paramIndex}
        )`;
        queryParams.push(parseInt(voiceOptions[voiceConditions.length]));
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
    if (countryIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id 
        AND EXISTS (
          SELECT 1 FROM unnest(c2.composer_id_list) AS composer_id
          JOIN composers comp ON comp.id = composer_id
          WHERE comp.birthplace_2 = ANY($${paramIndex}::integer[])
        )
      )`);
      queryParams.push(countryIds);
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
      const cityConditions = cityNames.map(() => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          JOIN inclusions i ON c2.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          WHERE c2.group_id = g.id AND s.town ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${cityNames[cityConditions.length]}%`);
        paramIndex++;
        return condition;
      });
      whereConditions.push(`(${cityConditions.join(' OR ')})`);
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
        -- Get aggregated data from compositions in this group
        (
          SELECT array_agg(comp.name ORDER BY comp.name) 
          FROM (
            SELECT DISTINCT comp.name
            FROM compositions c
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
          ) comp
        ) as composer_names,
        (
          SELECT array_agg(comp_with_dates ORDER BY comp_with_dates)
          FROM (
            SELECT DISTINCT comp.name || CASE 
              WHEN comp.from_year IS NOT NULL AND comp.to_year IS NOT NULL 
              THEN ' (' || comp.from_year || '–' || comp.to_year || ')'
              WHEN comp.from_year IS NOT NULL 
              THEN ' (' || comp.from_year || '–)'
              WHEN comp.to_year IS NOT NULL 
              THEN ' (–' || comp.to_year || ')'
              ELSE ''
            END as comp_with_dates
            FROM compositions c
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
          ) comp
        ) as composers_with_dates,
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
            SELECT DISTINCT func.name as func_name
            FROM compositions c
            JOIN titles t ON c.title_id = t.id
            JOIN functions_titles ft ON t.id = ft.title_id
            JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id
          ) funcs
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
            'position', i.position,
            'attribution_texts', i.attribution_texts,
            'notes', i.notes,
            'publishers', COALESCE(pubs.publishers, '[]'::json),
            'scribes', COALESCE(scr.scribes, '[]'::json)
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
      SELECT id, name, from_year, to_year
      FROM composers
      WHERE name IS NOT NULL
      ORDER BY name
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
      SELECT id, name
      FROM functions
      ORDER BY name
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
      SELECT id, language as name
      FROM languages
      ORDER BY language
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
      SELECT DISTINCT birthplace_2 as name
      FROM composers
      WHERE birthplace_2 IS NOT NULL
      ORDER BY birthplace_2
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
      SELECT id, code, title
      FROM sources
      WHERE code IS NOT NULL
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
      SELECT id, name
      FROM publishers
      ORDER BY name
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
      SELECT DISTINCT town as name
      FROM sources
      WHERE town IS NOT NULL AND town != ''
      ORDER BY town
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 