import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// GET /api/search/groups - Search for groups with enhanced filtering and pagination
router.get('/groups', async (req, res) => {
    try {
        const {
            page = 1,
            page_size = 25,
            title = '',
            composers = '',        // Multi-select: composer IDs separated by commas
            voices = '',          // Multi-select: voice counts separated by commas
            functions = '',       // Multi-select: function IDs separated by commas
            languages = '',       // Multi-select: language IDs separated by commas
            countries = '',       // Multi-select: composer birth countries
            sources = '',         // Multi-select: source IDs separated by commas
            publishers = '',      // Multi-select: publisher IDs separated by commas
            cities = '',          // Multi-select: publication cities
            has_editions = 'false',
            has_recordings = 'false'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(page_size);
        const limit = parseInt(page_size);

        // Build WHERE conditions with multi-select support
        const conditions = [];
        const params = [];
        let paramCount = 0;

        // Title search - searches both group display_title AND composition titles
        if (title.trim()) {
            paramCount++;
            conditions.push(`(
                g.display_title ILIKE $${paramCount} OR 
                EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN titles t ON comp.title_id = t.id 
                    WHERE comp.group_id = g.id AND t.text ILIKE $${paramCount}
                )
            )`);
            params.push(`%${title.trim()}%`);
        }

        // Composers filter (multi-select OR)
        if (composers.trim()) {
            const composerIds = composers.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (composerIds.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    WHERE comp.group_id = g.id 
                    AND comp.composer_id_list && $${paramCount}
                )`);
                params.push(composerIds);
            }
        }

        // Voices filter (multi-select OR)
        if (voices.trim()) {
            const voiceCounts = voices.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
            if (voiceCounts.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    WHERE comp.group_id = g.id 
                    AND comp.number_of_voices = ANY($${paramCount})
                )`);
                params.push(voiceCounts);
            }
        }

        // Functions filter (multi-select OR)
        if (functions.trim()) {
            const functionIds = functions.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (functionIds.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN titles t ON comp.title_id = t.id
                    JOIN functions_titles ft ON t.id = ft.title_id
                    WHERE comp.group_id = g.id 
                    AND ft.function_id = ANY($${paramCount})
                )`);
                params.push(functionIds);
            }
        }

        // Languages filter (multi-select OR)
        if (languages.trim()) {
            const languageIds = languages.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (languageIds.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN titles t ON comp.title_id = t.id
                    WHERE comp.group_id = g.id 
                    AND t.language = ANY($${paramCount})
                )`);
                params.push(languageIds);
            }
        }

        // Countries filter (multi-select OR) - based on composer birthplace
        if (countries.trim()) {
            const countryList = countries.split(',').map(c => c.trim()).filter(c => c.length > 0);
            if (countryList.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp, unnest(comp.composer_id_list) AS comp_id
                    JOIN composers composer ON composer.id = comp_id
                    WHERE comp.group_id = g.id 
                    AND (composer.birthplace_1 = ANY($${paramCount}) OR composer.birthplace_2 = ANY($${paramCount}))
                )`);
                params.push(countryList);
            }
        }

        // Sources filter (multi-select OR)
        if (sources.trim()) {
            const sourceIds = sources.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (sourceIds.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN inclusions inc ON comp.id = inc.composition_id
                    WHERE comp.group_id = g.id 
                    AND inc.source_id = ANY($${paramCount})
                )`);
                params.push(sourceIds);
            }
        }

        // Publishers filter (multi-select OR)
        if (publishers.trim()) {
            const publisherIds = publishers.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (publisherIds.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN inclusions inc ON comp.id = inc.composition_id
                    JOIN sources s ON inc.source_id = s.id
                    JOIN publishers_sources ps ON s.id = ps.source_id
                    WHERE comp.group_id = g.id 
                    AND ps.publisher_id = ANY($${paramCount})
                )`);
                params.push(publisherIds);
            }
        }

        // Cities filter (multi-select OR)
        if (cities.trim()) {
            const cityList = cities.split(',').map(c => c.trim()).filter(c => c.length > 0);
            if (cityList.length > 0) {
                paramCount++;
                conditions.push(`EXISTS (
                    SELECT 1 FROM compositions comp 
                    JOIN inclusions inc ON comp.id = inc.composition_id
                    JOIN sources s ON inc.source_id = s.id
                    WHERE comp.group_id = g.id 
                    AND s.town = ANY($${paramCount})
                )`);
                params.push(cityList);
            }
        }

        // Editions filter
        if (has_editions === 'true') {
            conditions.push('EXISTS (SELECT 1 FROM editions e WHERE e.group_id = g.id)');
        }

        // Recordings filter
        if (has_recordings === 'true') {
            conditions.push('EXISTS (SELECT 1 FROM recordings r WHERE r.group_id = g.id)');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Main query for groups with aggregated data
        const groupsQuery = `
            WITH group_data AS (
                SELECT DISTINCT
                    g.id,
                    g.display_title,
                    -- Get one representative composition for group-level data
                    (SELECT c.number_of_voices FROM compositions c WHERE c.group_id = g.id LIMIT 1) as voices,
                    (SELECT ct.name FROM compositions c 
                     LEFT JOIN composition_types ct ON c.composition_type_id = ct.id 
                     WHERE c.group_id = g.id LIMIT 1) as composition_type,
                    -- Get tone and even_odd from first composition
                    (SELECT c.tone FROM compositions c WHERE c.group_id = g.id LIMIT 1) as tone,
                    (SELECT c.even_odd FROM compositions c WHERE c.group_id = g.id LIMIT 1) as even_odd
                FROM groups g
                JOIN compositions c ON c.group_id = g.id
                ${whereClause}
            )
            SELECT *
            FROM group_data
            ORDER BY display_title
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;

        params.push(limit, offset);

        // Count query
        const countQuery = `
            SELECT COUNT(DISTINCT g.id) as total
            FROM groups g
            JOIN compositions c ON c.group_id = g.id
            ${whereClause}
        `;

        const countParams = params.slice(0, paramCount);

        // Execute queries
        const [groupsResult, countResult] = await Promise.all([
            pool.query(groupsQuery, params),
            pool.query(countQuery, countParams)
        ]);

        const groups = groupsResult.rows;
        const total = parseInt(countResult.rows[0].total);

        // Enhance groups with functions, composer info, editions, recordings, and sources
        for (const group of groups) {
            // Get smart composer information with dates
            const composerResult = await pool.query(`
                SELECT DISTINCT comp.id, comp.name, comp.from_year, comp.to_year
                FROM compositions c, unnest(c.composer_id_list) AS comp_id
                JOIN composers comp ON comp.id = comp_id
                WHERE c.group_id = $1 AND comp.id != 23
                ORDER BY comp.name
            `, [group.id]);

            const anonResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM compositions c
                WHERE c.group_id = $1 AND 23 = ANY(c.composer_id_list)
            `, [group.id]);

            const hasAnon = parseInt(anonResult.rows[0].count) > 0;
            const attributedComposers = composerResult.rows;

            if (attributedComposers.length === 0) {
                group.composer = 'Anon';
            } else if (attributedComposers.length === 1 && !hasAnon) {
                const comp = attributedComposers[0];
                const dates = comp.from_year || comp.to_year ? 
                    ` (${comp.from_year || '?'}–${comp.to_year || '?'})` : '';
                group.composer = comp.name + dates;
            } else if (attributedComposers.length === 1 && hasAnon) {
                const comp = attributedComposers[0];
                const dates = comp.from_year || comp.to_year ? 
                    ` (${comp.from_year || '?'}–${comp.to_year || '?'})` : '';
                group.composer = comp.name + dates;
            } else {
                group.composer = 'Conflicting attributions';
            }

            // Update display title with tone and even_odd info
            let displayTitle = group.display_title;
            if (group.tone || group.even_odd) {
                const toneMap = {
                    "1": "primi toni", "2": "secundi toni", "3": "tertii toni", 
                    "4": "quarti toni", "5": "quinti toni", "6": "sexti toni",
                    "7": "septimi toni", "8": "octavi toni", "9": "noni toni",
                    "12": "duodecimi toni", "mix": "mixti toni", 
                    "per": "peregrini toni", "pro": "proprii toni"
                };
                
                const evenOddMap = {
                    "even": "pares", "odd": "impares", "both": "pares et impares"
                };

                const toneText = group.tone ? toneMap[group.tone] || group.tone : '';
                const evenOddText = group.even_odd ? `(${evenOddMap[group.even_odd] || group.even_odd})` : '';
                
                if (toneText || evenOddText) {
                    displayTitle += ` ${toneText} ${evenOddText}`.trim();
                }
            }
            group.display_title = displayTitle;

            // Get functions
            const functionsResult = await pool.query(`
                SELECT DISTINCT f.name
                FROM compositions c
                JOIN titles t ON c.title_id = t.id
                JOIN functions_titles ft ON t.id = ft.title_id
                JOIN functions f ON ft.function_id = f.id
                WHERE c.group_id = $1
                ORDER BY f.name
            `, [group.id]);
            group.functions = functionsResult.rows.map(row => row.name);

            // Get editions
            const editionsResult = await pool.query(`
                SELECT e.file_url, e.voicing, ed.name as editor_name
                FROM editions e
                LEFT JOIN editors ed ON e.editor_id = ed.id
                WHERE e.group_id = $1
            `, [group.id]);
            group.editions = editionsResult.rows;

            // Get recordings
            const recordingsResult = await pool.query(`
                SELECT r.file_url, p.name as performer_name
                FROM recordings r
                LEFT JOIN performers p ON r.performer_id = p.id
                WHERE r.group_id = $1
            `, [group.id]);
            group.recordings = recordingsResult.rows;

            // Get sources with detailed information
            const sourcesResult = await pool.query(`
                SELECT DISTINCT
                    s.id,
                    s.title as full_title,
                    CASE 
                        WHEN LENGTH(s.title) > 50 THEN LEFT(s.title, 47) || '...'
                        ELSE s.title
                    END as short_title,
                    s.code,
                    CONCAT(
                        COALESCE(s.town, ''), 
                        CASE WHEN s.town IS NOT NULL AND pub_names.names IS NOT NULL THEN ': ' ELSE '' END,
                        COALESCE(pub_names.names, ''),
                        CASE WHEN s.from_year IS NOT NULL THEN ', ' || s.from_year ELSE '' END,
                        CASE WHEN s.to_year IS NOT NULL AND s.to_year != s.from_year THEN '–' || s.to_year ELSE '' END,
                        ' (', 
                        CASE WHEN s.type = 'MS' THEN 'manuscript' ELSE 'print' END,
                        ', ',
                        COALESCE(s.format, 'unknown format'),
                        ')'
                    ) as publication_details,
                    s.rism_link,
                    i.position,
                    i.attribution_texts,
                    i.notes
                FROM sources s
                JOIN inclusions i ON i.source_id = s.id
                JOIN compositions c ON c.id = i.composition_id
                LEFT JOIN (
                    SELECT ps.source_id, STRING_AGG(p.name, ', ') as names
                    FROM publishers_sources ps
                    JOIN publishers p ON ps.publisher_id = p.id
                    GROUP BY ps.source_id
                ) pub_names ON s.id = pub_names.source_id
                WHERE c.group_id = $1
                ORDER BY COALESCE(s.from_year, 9999), s.title
            `, [group.id]);

            // Enhance sources with images and clefs
            for (const source of sourcesResult.rows) {
                // Get images
                const imagesResult = await pool.query(`
                    SELECT url, label as comment
                    FROM source_images
                    WHERE source_id = $1
                    ORDER BY id
                `, [source.id]);
                source.images = imagesResult.rows;

                // Get clefs from inclusions - this is simplified for now
                source.clefs = ['g2.png', 'c2.png', 'c3.png', 'c4.png']; // placeholder
            }

            group.sources = sourcesResult.rows;
        }

        res.json({
            groups,
            total,
            page: parseInt(page),
            page_size: parseInt(page_size),
            total_pages: Math.ceil(total / parseInt(page_size))
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search groups' });
    }
});

// GET /api/search/composers - Get list of composers for filter dropdown
router.get('/composers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, from_year, to_year
            FROM composers
            WHERE id IN (
                SELECT DISTINCT unnest(composer_id_list) as composer_id
                FROM compositions
                WHERE group_id IS NOT NULL
            )
            ORDER BY name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching composers:', error);
        res.status(500).json({ error: 'Failed to fetch composers' });
    }
});

// GET /api/search/functions - Get list of functions for filter dropdown
router.get('/functions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name
            FROM functions
            WHERE id IN (
                SELECT DISTINCT ft.function_id
                FROM functions_titles ft
                JOIN titles t ON ft.title_id = t.id
                JOIN compositions c ON c.title_id = t.id
                WHERE c.group_id IS NOT NULL
            )
            ORDER BY name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching functions:', error);
        res.status(500).json({ error: 'Failed to fetch functions' });
    }
});

// GET /api/search/languages - Get list of languages for filter dropdown
router.get('/languages', async (req, res) => {
    try {
        let result;
        try {
            result = await pool.query(`
                SELECT id, language as name
                FROM languages
                WHERE id IN (
                    SELECT DISTINCT t.language
                    FROM titles t
                    JOIN compositions c ON c.title_id = t.id
                    WHERE c.group_id IS NOT NULL AND t.language IS NOT NULL
                )
                ORDER BY language
            `);
        } catch (dbError) {
            // Languages table doesn't exist, return fallback
            result = { rows: [
                { id: 1, name: 'Latin' },
                { id: 2, name: 'English' },
                { id: 3, name: 'French' },
                { id: 4, name: 'Italian' },
                { id: 5, name: 'German' },
                { id: 6, name: 'Spanish' }
            ]};
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching languages:', error);
        res.status(500).json({ error: 'Failed to fetch languages' });
    }
});

// GET /api/search/countries - Get list of countries for filter dropdown
router.get('/countries', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT birthplace_1 as name
            FROM composers
            WHERE birthplace_1 IS NOT NULL 
            AND id IN (
                SELECT DISTINCT unnest(composer_id_list) as composer_id
                FROM compositions
                WHERE group_id IS NOT NULL
            )
            UNION
            SELECT DISTINCT birthplace_2 as name
            FROM composers
            WHERE birthplace_2 IS NOT NULL 
            AND id IN (
                SELECT DISTINCT unnest(composer_id_list) as composer_id
                FROM compositions
                WHERE group_id IS NOT NULL
            )
            ORDER BY name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching countries:', error);
        res.status(500).json({ error: 'Failed to fetch countries' });
    }
});

// GET /api/search/sources - Get list of sources for filter dropdown
router.get('/sources', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT s.id, s.code, s.title
            FROM sources s
            JOIN inclusions i ON s.id = i.source_id
            JOIN compositions c ON i.composition_id = c.id
            WHERE c.group_id IS NOT NULL
            ORDER BY s.code
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sources:', error);
        res.status(500).json({ error: 'Failed to fetch sources' });
    }
});

// GET /api/search/publishers - Get list of publishers for filter dropdown
router.get('/publishers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT p.id, p.name
            FROM publishers p
            JOIN publishers_sources ps ON p.id = ps.publisher_id
            JOIN sources s ON ps.source_id = s.id
            JOIN inclusions i ON s.id = i.source_id
            JOIN compositions c ON i.composition_id = c.id
            WHERE c.group_id IS NOT NULL
            ORDER BY p.name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching publishers:', error);
        res.status(500).json({ error: 'Failed to fetch publishers' });
    }
});

// GET /api/search/cities - Get list of cities for filter dropdown
router.get('/cities', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT s.town as name
            FROM sources s
            JOIN inclusions i ON s.id = i.source_id
            JOIN compositions c ON i.composition_id = c.id
            WHERE c.group_id IS NOT NULL AND s.town IS NOT NULL
            ORDER BY s.town
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching cities:', error);
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

export default router; 