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
      limit = 20
    } = req.query;

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

    // Main search query
    const searchQuery = `
      SELECT 
        g.id,
        g.display_title,
        g.created_at,
        g.updated_at,
        -- Get aggregated data from compositions in this group
        (
          SELECT json_agg(comp_names.name ORDER BY comp_names.name) 
          FROM (
            SELECT DISTINCT comp.name
            FROM compositions c
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
          ) comp_names
        ) as composer_names,
        (
          SELECT json_agg(comp_info.composer_info ORDER BY comp_info.composer_info->>'name')
          FROM (
            SELECT DISTINCT jsonb_build_object(
              'id', comp.id,
              'name', comp.name,
              'dates', CASE 
                WHEN comp.from_year IS NOT NULL AND comp.to_year IS NOT NULL 
                THEN concat('(', comp.from_year, '–', comp.to_year, ')')
                WHEN comp.from_year IS NOT NULL 
                THEN concat('(', comp.from_year, '–)')
                WHEN comp.to_year IS NOT NULL 
                THEN concat('(–', comp.to_year, ')')
                ELSE ''
              END
            ) as composer_info
            FROM compositions c
            JOIN unnest(c.composer_id_list) AS composer_id ON true
            JOIN composers comp ON comp.id = composer_id
            WHERE c.group_id = g.id
          ) comp_info
        ) as composers_with_dates,
        (
          SELECT json_agg(voice_count ORDER BY voice_count)
          FROM (
            SELECT DISTINCT c.number_of_voices as voice_count
            FROM compositions c
            WHERE c.group_id = g.id AND c.number_of_voices IS NOT NULL
          ) voices
        ) as voice_counts,
        (
          SELECT json_agg(func.name ORDER BY func.name)
          FROM (
            SELECT DISTINCT func.name
            FROM compositions c
            JOIN titles t ON c.title_id = t.id
            JOIN functions_titles ft ON t.id = ft.title_id
            JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id
          ) func
        ) as function_names
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

// Get detailed sources for a specific group (for the expandable sources table)
router.get('/groups/:id/sources', async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    const query = `
      SELECT DISTINCT
        s.id,
        s.code,
        s.title,
        s.type,
        s.format,
        s.town as place_of_publication,
        s.from_year,
        s.to_year,
        s.rism_link,
        -- Get publishers for this source
        (
          SELECT json_agg(p.name ORDER BY p.name)
          FROM publishers_sources ps
          JOIN publishers p ON ps.publisher_id = p.id
          WHERE ps.source_id = s.id
        ) as publishers,
        -- Get scribes for this source  
        (
          SELECT json_agg(sc.name ORDER BY sc.name)
          FROM scribes_sources ss
          JOIN scribes sc ON ss.scribe_id = sc.id
          WHERE ss.source_id = s.id
        ) as scribes
      FROM sources s
      JOIN inclusions i ON s.id = i.source_id
      JOIN compositions c ON i.composition_id = c.id
      WHERE c.group_id = $1
      ORDER BY s.code, s.title
    `;

    const result = await pool.query(query, [groupId]);
    res.json({ sources: result.rows });

  } catch (error) {
    console.error('Error fetching group sources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 