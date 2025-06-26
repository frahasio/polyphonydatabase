import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// GET /api/search/groups - Search for groups with filtering and pagination
router.get('/groups', async (req, res) => {
    try {
        const {
            page = 1,
            page_size = 25,
            title = '',
            composer = '',
            voices = '',
            function: functionId = '',
            has_editions = 'false',
            has_recordings = 'false'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(page_size);
        const limit = parseInt(page_size);

        // Build WHERE conditions
        const conditions = [];
        const params = [];
        let paramCount = 0;

        if (title.trim()) {
            paramCount++;
            conditions.push(`g.display_title ILIKE $${paramCount}`);
            params.push(`%${title.trim()}%`);
        }

        if (composer) {
            paramCount++;
            conditions.push(`c.composer_id = $${paramCount}`);
            params.push(parseInt(composer));
        }

        if (voices) {
            paramCount++;
            conditions.push(`c.voices = $${paramCount}`);
            params.push(parseInt(voices));
        }

        if (functionId) {
            paramCount++;
            conditions.push(`cf.function_id = $${paramCount}`);
            params.push(parseInt(functionId));
        }

        if (has_editions === 'true') {
            conditions.push('EXISTS (SELECT 1 FROM editions e WHERE e.group_id = g.id)');
        }

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
                    c.voices,
                    ct.name as composition_type,
                    -- Composer logic
                    CASE 
                        WHEN COUNT(DISTINCT CASE WHEN comp.id != 23 THEN comp.id END) = 0 THEN 'Anon'
                        WHEN COUNT(DISTINCT CASE WHEN comp.id != 23 THEN comp.id END) = 1 THEN MAX(CASE WHEN comp.id != 23 THEN comp.name END)
                        ELSE 'Conflicting attributions'
                    END as composer
                FROM groups g
                JOIN compositions c ON c.group_id = g.id
                LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
                LEFT JOIN composers comp ON c.composer_id = comp.id
                LEFT JOIN composition_functions cf ON cf.composition_id = c.id
                ${whereClause}
                GROUP BY g.id, g.display_title, c.voices, ct.name
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
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            LEFT JOIN composers comp ON c.composer_id = comp.id
            LEFT JOIN composition_functions cf ON cf.composition_id = c.id
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

        // Enhance groups with functions, editions, recordings, and sources
        for (const group of groups) {
            // Get functions
            const functionsResult = await pool.query(`
                SELECT DISTINCT f.name
                FROM functions f
                JOIN composition_functions cf ON cf.function_id = f.id
                JOIN compositions c ON c.id = cf.composition_id
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
                        COALESCE(s.place_of_publication, ''), 
                        CASE WHEN s.place_of_publication IS NOT NULL AND s.publisher IS NOT NULL THEN ': ' ELSE '' END,
                        COALESCE(pub.name, ''),
                        CASE WHEN s.date_of_publication IS NOT NULL THEN ', ' || s.date_of_publication ELSE '' END,
                        ' (', 
                        CASE WHEN s.type = 'manuscript' THEN 'manuscript' ELSE 'print' END,
                        ')'
                    ) as publication_details,
                    s.rism_link,
                    i.position,
                    i.attribution,
                    i.notes
                FROM sources s
                JOIN inclusions i ON i.source_id = s.id
                JOIN compositions c ON c.id = i.composition_id
                LEFT JOIN publishers pub ON s.publisher_id = pub.id
                WHERE c.group_id = $1
                ORDER BY COALESCE(s.date_of_publication::int, 9999), s.title
            `, [group.id]);

            // Enhance sources with images and clefs
            for (const source of sourcesResult.rows) {
                // Get images
                const imagesResult = await pool.query(`
                    SELECT image_url as url, comment
                    FROM source_images
                    WHERE source_id = $1
                    ORDER BY id
                `, [source.id]);
                source.images = imagesResult.rows;

                // Get clefs - this is a placeholder as clef data structure needs to be defined
                // For now, we'll create placeholder clef data
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
            SELECT id, name
            FROM composers
            WHERE id IN (
                SELECT DISTINCT composer_id
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
                SELECT DISTINCT cf.function_id
                FROM composition_functions cf
                JOIN compositions c ON c.id = cf.composition_id
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

export default router; 