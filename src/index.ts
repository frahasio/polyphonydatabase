import express from 'express';
import { Pool } from 'pg';
import path from 'path';
import { Request, Response } from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Heroku
  }
});

app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Get all composers (minimal data for list view)
app.get('/composers', async (req: Request, res: Response) => {
  try {
    // Get only IDs and names for initial load
    const composers = await pool.query(
      `SELECT id, name
       FROM composers
       ORDER BY name ASC`
    );

    res.json({ composers: composers.rows });
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Failed to fetch composers' });
  }
});

// Get composer details by ID
app.get('/composers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid composer ID' });
    }

    const composer = await pool.query(
      `SELECT id, name, from_year, to_year, from_year_annotation, to_year_annotation,
              birthplace_1, birthplace_2, deathplace_1, deathplace_2
       FROM composers
       WHERE id = $1`,
      [id]
    );

    if (composer.rows.length === 0) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    // Transform to camelCase
    const transformedComposer = {
      id: composer.rows[0].id,
      name: composer.rows[0].name,
      fromYear: composer.rows[0].from_year,
      toYear: composer.rows[0].to_year,
      fromYearAnnotation: composer.rows[0].from_year_annotation,
      toYearAnnotation: composer.rows[0].to_year_annotation,
      birthplace1: composer.rows[0].birthplace_1,
      birthplace2: composer.rows[0].birthplace_2,
      deathplace1: composer.rows[0].deathplace_1,
      deathplace2: composer.rows[0].deathplace_2
    };

    res.json(transformedComposer);
  } catch (error) {
    console.error('Error fetching composer:', error);
    res.status(500).json({ error: 'Failed to fetch composer' });
  }
});

// Search composers for Select2
app.get('/composers/search', async (req: Request, res: Response) => {
  try {
    const search = (req.query.term as string) || '';
    if (!search) {
      return res.json({ results: [] });
    }

    const composers = await pool.query(
      `SELECT id, name as text
       FROM composers
       WHERE name ILIKE $1
       ORDER BY name ASC
       LIMIT 10`,
      [`%${search}%`]
    );

    // Transform the results to ensure id is a string for select2
    const results = composers.rows.map(composer => ({
      id: composer.id.toString(),
      text: composer.text
    }));

    res.json({ results });
  } catch (error) {
    console.error('Error searching composers:', error);
    res.status(500).json({ error: 'Failed to search composers' });
  }
});

// Update a composer
app.put('/composers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid composer ID' });
    }

    const { fromYear, toYear, ...rest } = req.body;
    
    const composer = await pool.query(
      `UPDATE composers SET
        name = $1,
        from_year = $2,
        to_year = $3,
        from_year_annotation = $4,
        to_year_annotation = $5,
        birthplace1 = $6,
        birthplace2 = $7,
        deathplace1 = $8,
        deathplace2 = $9
      WHERE id = $10
      RETURNING id, name, from_year, to_year, from_year_annotation, to_year_annotation, birthplace1, birthplace2, deathplace1, deathplace2`,
      [rest.name, fromYear ? parseInt(fromYear.toString()) : null, toYear ? parseInt(toYear.toString()) : null, rest.fromYearAnnotation || null, rest.toYearAnnotation || null, rest.birthplace1 || null, rest.birthplace2 || null, rest.deathplace1 || null, rest.deathplace2 || null, id]
    );

    if (composer.rows.length === 0) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    res.json(composer.rows[0]);
  } catch (error) {
    console.error('Error updating composer:', error);
    res.status(500).json({ error: 'Failed to update composer' });
  }
});

// Create a new composer
app.post('/composers', async (req: Request, res: Response) => {
  try {
    const { fromYear, toYear, ...rest } = req.body;
    
    const composer = await pool.query(
      `INSERT INTO composers (
        name, from_year, to_year, from_year_annotation, to_year_annotation,
        birthplace_1, birthplace_2, deathplace_1, deathplace_2
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, from_year, to_year, from_year_annotation, to_year_annotation,
                birthplace_1, birthplace_2, deathplace_1, deathplace_2`,
      [rest.name, fromYear ? parseInt(fromYear.toString()) : null, toYear ? parseInt(toYear.toString()) : null, rest.fromYearAnnotation || null, rest.toYearAnnotation || null, rest.birthplace1 || null, rest.birthplace2 || null, rest.deathplace1 || null, rest.deathplace2 || null]
    );
    res.status(201).json(composer.rows[0]);
  } catch (error) {
    console.error('Error creating composer:', error);
    res.status(500).json({ error: 'Failed to create composer' });
  }
});

// Delete a composer
app.delete('/composers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid composer ID' });
    }

    await pool.query('DELETE FROM composers WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting composer:', error);
    res.status(500).json({ error: 'Failed to delete composer' });
  }
});

// GET /editors - List all editors
app.get('/editors', async (req, res) => {
    try {
        const editors = await pool.query(
            `SELECT id, name
             FROM editors
             ORDER BY name ASC`
        );

        res.json({ editors: editors.rows });
    } catch (error) {
        console.error('Error fetching editors:', error);
        res.status(500).json({ error: 'Failed to fetch editors' });
    }
});

// GET /editors/:id - Get a single editor
app.get('/editors/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid editor ID' });
        }

        const editor = await pool.query(
            `SELECT id, name
             FROM editors
             WHERE id = $1`,
            [id]
        );

        if (editor.rows.length === 0) {
            return res.status(404).json({ error: 'Editor not found' });
        }

        res.json(editor.rows[0]);
    } catch (error) {
        console.error('Error fetching editor:', error);
        res.status(500).json({ error: 'Failed to fetch editor' });
    }
});

// PUT /editors/:id - Update an editor
app.put('/editors/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid editor ID' });
        }

        const editor = await pool.query(
            `UPDATE editors SET
              name = $1,
              date_of_birth = $2
            WHERE id = $3
            RETURNING id, name, date_of_birth`,
            [req.body.name, req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null, id]
        );
        res.json(editor.rows[0]);
    } catch (error) {
        console.error('Error updating editor:', error);
        res.status(500).json({ error: 'Failed to update editor' });
    }
});

// POST /editors - Create a new editor
app.post('/editors', async (req, res) => {
    try {
        const editor = await pool.query(
            `INSERT INTO editors (
              name, date_of_birth
            ) VALUES ($1, $2)
            RETURNING id, name, date_of_birth`,
            [req.body.name, req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null]
        );
        res.status(201).json(editor.rows[0]);
    } catch (error) {
        console.error('Error creating editor:', error);
        res.status(500).json({ error: 'Failed to create editor' });
    }
});

// DELETE /editors/:id - Delete an editor
app.delete('/editors/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid editor ID' });
        }

        await pool.query('DELETE FROM editors WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting editor:', error);
        res.status(500).json({ error: 'Failed to delete editor' });
    }
});

// GET /scribes - List all scribes
app.get('/scribes', async (req, res) => {
    try {
        const scribes = await pool.query(
            `SELECT id, name
             FROM scribes
             ORDER BY name ASC`
        );

        res.json({ scribes: scribes.rows });
    } catch (error) {
        console.error('Error fetching scribes:', error);
        res.status(500).json({ error: 'Failed to fetch scribes' });
    }
});

// GET /scribes/:id - Get a single scribe
app.get('/scribes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid scribe ID' });
        }

        const scribe = await pool.query(
            `SELECT id, name
             FROM scribes
             WHERE id = $1`,
            [id]
        );

        if (scribe.rows.length === 0) {
            return res.status(404).json({ error: 'Scribe not found' });
        }

        res.json(scribe.rows[0]);
    } catch (error) {
        console.error('Error fetching scribe:', error);
        res.status(500).json({ error: 'Failed to fetch scribe' });
    }
});

// PUT /scribes/:id - Update a scribe
app.put('/scribes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid scribe ID' });
        }

        const scribe = await pool.query(
            `UPDATE scribes SET
              name = $1
            WHERE id = $2
            RETURNING id, name`,
            [req.body.name, id]
        );
        res.json(scribe.rows[0]);
    } catch (error) {
        console.error('Error updating scribe:', error);
        res.status(500).json({ error: 'Failed to update scribe' });
    }
});

// POST /scribes - Create a new scribe
app.post('/scribes', async (req, res) => {
    try {
        const scribe = await pool.query(
            `INSERT INTO scribes (
              name
            ) VALUES ($1)
            RETURNING id, name`,
            [req.body.name]
        );
        res.status(201).json(scribe.rows[0]);
    } catch (error) {
        console.error('Error creating scribe:', error);
        res.status(500).json({ error: 'Failed to create scribe' });
    }
});

// DELETE /scribes/:id - Delete a scribe
app.delete('/scribes/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid scribe ID' });
        }

        await pool.query('DELETE FROM scribes WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting scribe:', error);
        res.status(500).json({ error: 'Failed to delete scribe' });
    }
});

// GET /publishers - List all publishers
app.get('/publishers', async (req, res) => {
    try {
        const publishers = await pool.query(
            `SELECT id, name
             FROM publishers
             ORDER BY name ASC`
        );

        res.json({ publishers: publishers.rows });
    } catch (error) {
        console.error('Error fetching publishers:', error);
        res.status(500).json({ error: 'Failed to fetch publishers' });
    }
});

// GET /publishers/:id - Get a single publisher
app.get('/publishers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid publisher ID' });
        }

        const publisher = await pool.query(
            `SELECT id, name
             FROM publishers
             WHERE id = $1`,
            [id]
        );

        if (publisher.rows.length === 0) {
            return res.status(404).json({ error: 'Publisher not found' });
        }

        res.json(publisher.rows[0]);
    } catch (error) {
        console.error('Error fetching publisher:', error);
        res.status(500).json({ error: 'Failed to fetch publisher' });
    }
});

// PUT /publishers/:id - Update a publisher
app.put('/publishers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid publisher ID' });
        }

        const publisher = await pool.query(
            `UPDATE publishers SET
              name = $1
            WHERE id = $2
            RETURNING id, name`,
            [req.body.name, id]
        );
        res.json(publisher.rows[0]);
    } catch (error) {
        console.error('Error updating publisher:', error);
        res.status(500).json({ error: 'Failed to update publisher' });
    }
});

// POST /publishers - Create a new publisher
app.post('/publishers', async (req, res) => {
    try {
        const publisher = await pool.query(
            `INSERT INTO publishers (
              name
            ) VALUES ($1)
            RETURNING id, name`,
            [req.body.name]
        );
        res.status(201).json(publisher.rows[0]);
    } catch (error) {
        console.error('Error creating publisher:', error);
        res.status(500).json({ error: 'Failed to create publisher' });
    }
});

// DELETE /publishers/:id - Delete a publisher
app.delete('/publishers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid publisher ID' });
        }

        await pool.query('DELETE FROM publishers WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting publisher:', error);
        res.status(500).json({ error: 'Failed to delete publisher' });
    }
});

// GET /performers - List all performers
app.get('/performers', async (req, res) => {
    try {
        const performers = await pool.query(
            `SELECT id, name
             FROM performers
             ORDER BY name ASC`
        );

        res.json({ performers: performers.rows });
    } catch (error) {
        console.error('Error fetching performers:', error);
        res.status(500).json({ error: 'Failed to fetch performers' });
    }
});

// GET /performers/:id - Get a single performer
app.get('/performers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid performer ID' });
        }

        const performer = await pool.query(
            `SELECT id, name
             FROM performers
             WHERE id = $1`,
            [id]
        );

        if (performer.rows.length === 0) {
            return res.status(404).json({ error: 'Performer not found' });
        }

        res.json(performer.rows[0]);
    } catch (error) {
        console.error('Error fetching performer:', error);
        res.status(500).json({ error: 'Failed to fetch performer' });
    }
});

// PUT /performers/:id - Update a performer
app.put('/performers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid performer ID' });
        }

        const performer = await pool.query(
            `UPDATE performers SET
              name = $1
            WHERE id = $2
            RETURNING id, name`,
            [req.body.name, id]
        );
        res.json(performer.rows[0]);
    } catch (error) {
        console.error('Error updating performer:', error);
        res.status(500).json({ error: 'Failed to update performer' });
    }
});

// POST /performers - Create a new performer
app.post('/performers', async (req, res) => {
    try {
        const performer = await pool.query(
            `INSERT INTO performers (
              name
            ) VALUES ($1)
            RETURNING id, name`,
            [req.body.name]
        );
        res.status(201).json(performer.rows[0]);
    } catch (error) {
        console.error('Error creating performer:', error);
        res.status(500).json({ error: 'Failed to create performer' });
    }
});

// DELETE /performers/:id - Delete a performer
app.delete('/performers/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid performer ID' });
        }

        await pool.query('DELETE FROM performers WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting performer:', error);
        res.status(500).json({ error: 'Failed to delete performer' });
    }
});

// GET /sources - List all sources
app.get('/sources', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    let query = `
      SELECT id, code, title, from_year, to_year, catalogued
      FROM sources
    `;
    const params: any[] = [];

    if (search) {
      query += `
        WHERE code ILIKE $1 OR title ILIKE $1
      `;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY code ASC`;

    const result = await pool.query(query, params);
    res.json({ sources: result.rows });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// GET /sources/:id
app.get('/sources/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    // Get source details
    const sourceResult = await client.query(
      `SELECT s.*, 
        COALESCE(json_agg(DISTINCT p.*) FILTER (WHERE p.id IS NOT NULL), '[]') as publishers,
        COALESCE(json_agg(DISTINCT sc.*) FILTER (WHERE sc.id IS NOT NULL), '[]') as scribes
       FROM sources s
       LEFT JOIN publishers_sources ps ON s.id = ps.source_id
       LEFT JOIN publishers p ON ps.publisher_id = p.id
       LEFT JOIN scribes_sources ss ON s.id = ss.source_id
       LEFT JOIN scribes sc ON ss.scribe_id = sc.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [sourceId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const source = sourceResult.rows[0];

    // Get total count of inclusions
    const countResult = await client.query(
      'SELECT COUNT(*) FROM inclusions WHERE source_id = $1',
      [sourceId]
    );
    const totalInclusions = parseInt(countResult.rows[0].count);

    // Get paginated inclusions with their related data
    const inclusionsResult = await client.query(
      `SELECT i.*, 
        c.composer_ids, c.title_id, c.type_id, c.tone, c.even_odd, c.number_of_voices,
        t.text as title_text,
        ct.name as type_name
       FROM inclusions i
       LEFT JOIN compositions c ON i.composition_id = c.id
       LEFT JOIN titles t ON c.title_id = t.id
       LEFT JOIN composition_types ct ON c.type_id = ct.id
       WHERE i.source_id = $1
       ORDER BY i."order"
       LIMIT $2 OFFSET $3`,
      [sourceId, limit, offset]
    );

    // Format inclusions data
    const inclusions = inclusionsResult.rows.map(row => ({
      id: row.id,
      order: row.order,
      attribution_texts: row.attribution_texts || [],
      composer_ids: row.composer_ids || [],
      clefs: row.clefs || [],
      position: row.position,
      notes: row.notes,
      composition_id: row.composition_id,
      composition_data: row.composition_id ? {
        composer_ids: row.composer_ids,
        title_id: row.title_id,
        title_text: row.title_text,
        type_id: row.type_id,
        type_name: row.type_name,
        tone: row.tone,
        even_odd: row.even_odd,
        number_of_voices: row.number_of_voices
      } : null
    }));

    // Get images
    const imagesResult = await client.query(
      'SELECT * FROM source_images WHERE source_id = $1 ORDER BY "order"',
      [sourceId]
    );

    res.json({
      ...source,
      inclusions,
      images: imagesResult.rows,
      pagination: {
        total: totalInclusions,
        page,
        limit,
        totalPages: Math.ceil(totalInclusions / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching source:', error);
    res.status(500).json({ error: 'Failed to fetch source' });
  } finally {
    client.release();
  }
});

// POST /sources
app.post('/sources', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      code, title, type, format, town, rismLink, catalogued,
      fromYear, toYear, fromYearAnnotation, toYearAnnotation,
      dates, publisherIds, scribeIds
    } = req.body;

    // Insert source
    const sourceResult = await client.query(
      `INSERT INTO sources (
        code, title, type, format, town, rism_link, catalogued,
        from_year, to_year, from_year_annotation, to_year_annotation,
        dates
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [code, title, type, format, town, rismLink, catalogued,
       fromYear, toYear, fromYearAnnotation, toYearAnnotation, dates]
    );

    const source = sourceResult.rows[0];

    // Insert publisher relationships
    if (publisherIds && publisherIds.length > 0) {
      const publisherValues = publisherIds.map((id: number) => 
        `(${source.id}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO publishers_sources (source_id, publisher_id)
         VALUES ${publisherValues}`
      );
    }

    // Insert scribe relationships
    if (scribeIds && scribeIds.length > 0) {
      const scribeValues = scribeIds.map((id: number) => 
        `(${source.id}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO scribes_sources (source_id, scribe_id)
         VALUES ${scribeValues}`
      );
    }

    await client.query('COMMIT');

    // Fetch the complete source with relationships
    const completeSource = await client.query(
      `SELECT s.*, 
              json_agg(DISTINCT p.*) as publishers,
              json_agg(DISTINCT sc.*) as scribes
       FROM sources s
       LEFT JOIN publishers_sources ps ON s.id = ps.source_id
       LEFT JOIN publishers p ON ps.publisher_id = p.id
       LEFT JOIN scribes_sources ss ON s.id = ss.source_id
       LEFT JOIN scribes sc ON ss.scribe_id = sc.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [source.id]
    );

    res.status(201).json(completeSource.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating source:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /sources/:id - Update source
app.post('/sources/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceId = parseInt(req.params.id);
    const {
      code,
      title,
      fromYear,
      toYear,
      fromYearAnnotation,
      toYearAnnotation,
      town,
      type,
      format,
      publisherId,
      scribeId,
      images,
      inclusions,
      currentPage
    } = req.body;

    // Update source
    const updateSourceQuery = `
      UPDATE sources
      SET code = $1,
          title = $2,
          from_year = $3,
          to_year = $4,
          from_year_annotation = $5,
          to_year_annotation = $6,
          town = $7,
          type = $8,
          format = $9,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING id
    `;

    const sourceResult = await client.query(updateSourceQuery, [
      code,
      title,
      fromYear || null,
      toYear || null,
      fromYearAnnotation,
      toYearAnnotation,
      town,
      type,
      format,
      sourceId
    ]);

    // Update publisher relationships
    await client.query('DELETE FROM publishers_sources WHERE source_id = $1', [sourceId]);
    if (publisherId && publisherId.length > 0) {
      const publisherValues = publisherId.map((id: number) => 
        `(${sourceId}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO publishers_sources (source_id, publisher_id)
         VALUES ${publisherValues}`
      );
    }

    // Update scribe relationships
    await client.query('DELETE FROM scribes_sources WHERE source_id = $1', [sourceId]);
    if (scribeId && scribeId.length > 0) {
      const scribeValues = scribeId.map((id: number) => 
        `(${sourceId}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO scribes_sources (source_id, scribe_id)
         VALUES ${scribeValues}`
      );
    }

    // Process inclusions and handle pending compositions
    if (inclusions && inclusions.length > 0) {
      // Get existing inclusions for the current page
      const pageSize = 50; // Match frontend ROWS_PER_PAGE
      const offset = (currentPage - 1) * pageSize;
      
      const existingInclusions = await client.query(
        `SELECT id, source_id, "order", attribution_texts, composer_ids, clefs, position, notes, composition_id 
         FROM inclusions 
         WHERE source_id = $1 
         AND "order" >= $2 
         AND "order" < $3
         ORDER BY "order"`,
        [sourceId, offset + 1, offset + pageSize + 1]
      );

      // Create maps for quick lookup
      const existingMap = new Map(existingInclusions.rows.map((i: { order: number; id: number }) => [i.order, i]));
      const newMap = new Map(inclusions.map((i: { order: number }) => [i.order, i]));

      // Find inclusions to delete (exist in DB but not in new data)
      const toDelete = existingInclusions.rows.filter((i: { order: number; id: number }) => !newMap.has(i.order));
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map(i => i.id);
        await client.query('DELETE FROM clef_inclusions WHERE inclusion_id = ANY($1)', [deleteIds]);
        await client.query('DELETE FROM inclusions WHERE id = ANY($1)', [deleteIds]);
      }

      // Process each inclusion
      for (const inclusion of inclusions) {
        const existing = existingMap.get(inclusion.order);
        let compositionId = null;

        // Handle composition matching/creation
        if (inclusion.composition_data) {
          const { composer_ids, title_id, type_id, tone, even_odd, number_of_voices } = inclusion.composition_data;

          // Try to find existing composition
          const existingComposition = await client.query(
            `SELECT id FROM compositions 
             WHERE composer_ids = $1 
             AND title_id = $2 
             AND type_id = $3 
             AND tone = $4 
             AND even_odd = $5 
             AND number_of_voices = $6`,
            [composer_ids, title_id, type_id, tone, even_odd, number_of_voices]
          );

          if (existingComposition.rows.length > 0) {
            compositionId = existingComposition.rows[0].id;
          } else {
            // Create new composition
            const newComposition = await client.query(
              `INSERT INTO compositions 
               (composer_ids, title_id, type_id, tone, even_odd, number_of_voices)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id`,
              [composer_ids, title_id, type_id, tone, even_odd, number_of_voices]
            );
            compositionId = newComposition.rows[0].id;
          }
        }

        if (existing) {
          // Update existing inclusion if changed
          const updateInclusionQuery = `
            UPDATE inclusions 
            SET attribution_texts = $1,
                composer_ids = $2,
                clefs = $3,
                position = $4,
                notes = $5,
                composition_id = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
          `;

          await client.query(updateInclusionQuery, [
            inclusion.attribution_texts,
            inclusion.composer_ids,
            inclusion.clefs,
            inclusion.position,
            inclusion.notes,
            compositionId,
            existing.id
          ]);
        } else {
          // Insert new inclusion
          const insertInclusionQuery = `
            INSERT INTO inclusions 
            (source_id, "order", attribution_texts, composer_ids, clefs, position, notes, composition_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;

          await client.query(insertInclusionQuery, [
            sourceId,
            inclusion.order,
            inclusion.attribution_texts,
            inclusion.composer_ids,
            inclusion.clefs,
            inclusion.position,
            inclusion.notes,
            compositionId
          ]);
        }
      }
    }

    // Clean up pending compositions for this source
    await client.query('DELETE FROM pending_compositions WHERE source_id = $1', [sourceId]);

    await client.query('COMMIT');
    res.json({ success: true, id: sourceResult.rows[0].id });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating source:', error);
    res.status(500).json({ error: 'Failed to update source' });
  } finally {
    client.release();
  }
});

// DELETE /sources/:id
app.delete('/sources/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceId = parseInt(req.params.id);

    // Delete related records first
    await client.query('DELETE FROM publishers_sources WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM scribes_sources WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM source_images WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM inclusions WHERE source_id = $1', [sourceId]);

    // Delete the source
    const result = await client.query(
      'DELETE FROM sources WHERE id = $1 RETURNING id',
      [sourceId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source not found' });
    }

    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting source:', error);
    res.status(500).json({ error: 'Failed to delete source' });
  } finally {
    client.release();
  }
});

// GET /titles - Get titles for Select2
app.get('/titles', async (req: Request, res: Response) => {
  try {
    const search = (req.query.term as string) || '';
    const query = `
      SELECT DISTINCT t.id, t.text
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      WHERE t.text ILIKE $1
      ORDER BY t.text ASC
      LIMIT 10
    `;
    const params = [`%${search}%`];

    const result = await pool.query(query, params);
    res.json({ 
      results: result.rows.map(row => ({
        id: row.id,
        text: row.text
      }))
    });
  } catch (error) {
    console.error('Error fetching titles:', error);
    res.status(500).json({ error: 'Failed to fetch titles' });
  }
});

// GET /titles/match - Get title ID from text
app.get('/titles/match', async (req: Request, res: Response) => {
  try {
    const search = (req.query.text as string) || '';
    if (!search) {
      return res.json({ id: null });
    }

    const result = await pool.query(
      `SELECT id, text
       FROM titles
       WHERE text = $1
       LIMIT 1`,
      [search]
    );

    if (result.rows.length === 0) {
      return res.json({ id: null });
    }

    res.json({ id: result.rows[0].id });
  } catch (error) {
    console.error('Error matching title:', error);
    res.status(500).json({ error: 'Failed to match title' });
  }
});

// GET /composition-types - Get all composition types
app.get('/composition-types', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM composition_types
      ORDER BY name ASC
    `);
    res.json({ types: result.rows });
  } catch (error) {
    console.error('Error fetching composition types:', error);
    res.status(500).json({ error: 'Failed to fetch composition types' });
  }
});

// GET /compositions - Get all compositions
app.get('/compositions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT c.*, ct.name as type_name
      FROM compositions c
      LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
      ORDER BY c.title ASC
    `);
    res.json({ compositions: result.rows });
  } catch (error) {
    console.error('Error fetching compositions:', error);
    res.status(500).json({ error: 'Failed to fetch compositions' });
  }
});

// Create temporary table for pending compositions
const createPendingCompositionsTable = `
  CREATE TEMPORARY TABLE IF NOT EXISTS pending_compositions (
    id SERIAL PRIMARY KEY,
    title_id INTEGER,
    composition_type_id INTEGER,
    tone TEXT,
    even_odd TEXT,
    number_of_voices INTEGER,
    composer_id_list INTEGER[],
    source_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// Initialize temporary table when server starts
pool.query(createPendingCompositionsTable).catch(err => {
  console.error('Error creating pending_compositions table:', err);
});

// POST /compositions/match - Check for matching composition
app.post('/compositions/match', async (req: Request, res: Response) => {
  try {
    const {
      composer_ids,
      title_id,
      type_id,
      tone,
      even_odd,
      number_of_voices,
      source_id
    } = req.body;

    // Look for an exact match in the main compositions table
    const mainQuery = `
      SELECT id
      FROM compositions
      WHERE title_id = $1
        AND composition_type_id = $2
        AND ($3::text IS NULL OR tone = $3)
        AND ($4::text IS NULL OR even_odd = $4)
        AND ($5::integer IS NULL OR number_of_voices = $5)
        AND composer_id_list = $6::integer[]
      LIMIT 1
    `;

    const mainResult = await pool.query(mainQuery, [
      title_id,
      type_id,
      tone,
      even_odd,
      number_of_voices,
      composer_ids
    ]);

    if (mainResult.rows.length > 0) {
      // Found an exact match in main table
      return res.json({
        status: 'match',
        composition_id: mainResult.rows[0].id
      });
    }

    // Check for match in pending_compositions table
    const pendingQuery = `
      SELECT id
      FROM pending_compositions
      WHERE title_id = $1
        AND composition_type_id = $2
        AND ($3::text IS NULL OR tone = $3)
        AND ($4::text IS NULL OR even_odd = $4)
        AND ($5::integer IS NULL OR number_of_voices = $5)
        AND composer_id_list = $6::integer[]
      LIMIT 1
    `;

    const pendingResult = await pool.query(pendingQuery, [
      title_id,
      type_id,
      tone,
      even_odd,
      number_of_voices,
      composer_ids
    ]);

    if (pendingResult.rows.length > 0) {
      // Found a match in pending table
      return res.json({
        status: 'pending',
        composition_id: pendingResult.rows[0].id
      });
    }

    // No match found - create a new pending composition
    const insertQuery = `
      INSERT INTO pending_compositions 
      (title_id, composition_type_id, tone, even_odd, number_of_voices, composer_id_list, source_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

    const insertResult = await pool.query(insertQuery, [
      title_id,
      type_id,
      tone,
      even_odd,
      number_of_voices,
      composer_ids,
      source_id
    ]);

    res.json({
      status: 'new',
      composition_id: insertResult.rows[0].id
    });
  } catch (error) {
    console.error('Error matching composition:', error);
    res.status(500).json({ error: 'Failed to match composition' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 