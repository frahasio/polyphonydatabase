import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import path from 'path';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Heroku
  }
});

const app = express();
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
    const composers = await pool.query(
      `SELECT id, name as text
       FROM composers
       WHERE name ILIKE $1
       ORDER BY name ASC
       LIMIT 10`,
      [`%${search}%`]
    );

    res.json({ results: composers.rows });
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
        birthplace1, birthplace2, deathplace1, deathplace2
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, from_year, to_year, from_year_annotation, to_year_annotation,
                birthplace1, birthplace2, deathplace1, deathplace2`,
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
app.get('/sources/:id', async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    
    // Get source details
    const sourceResult = await pool.query(
      `SELECT * FROM sources WHERE id = $1`,
      [sourceId]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const source = sourceResult.rows[0];

    // Get images
    const imagesResult = await pool.query(
      `SELECT * FROM source_images WHERE source_id = $1`,
      [sourceId]
    );
    source.images = imagesResult.rows;

    // Get inclusions with composer names
    const inclusionsResult = await pool.query(
      `SELECT i.id, i.source_id, i.notes, i."order", i.created_at, i.updated_at, i.position, i.composition_id,
              i.clefs, i.attribution_texts, i.composer_ids,
              CASE 
                WHEN i.composer_ids IS NULL THEN ARRAY[]::text[]
                ELSE ARRAY(
                  SELECT c.name 
                  FROM composers c 
                  WHERE c.id = ANY(COALESCE(i.composer_ids::integer[], ARRAY[]::integer[]))
                  ORDER BY array_position(COALESCE(i.composer_ids::integer[], ARRAY[]::integer[]), c.id)
                )
              END as composer_names
       FROM inclusions i WHERE i.source_id = $1`,
      [sourceId]
    );
    source.inclusions = inclusionsResult.rows;

    // Get publishers
    const publishersResult = await pool.query(
      `SELECT p.* 
       FROM publishers p
       JOIN publishers_sources ps ON p.id = ps.publisher_id
       WHERE ps.source_id = $1`,
      [sourceId]
    );
    source.publishers = publishersResult.rows;

    // Get scribes
    const scribesResult = await pool.query(
      `SELECT s.* 
       FROM scribes s
       JOIN scribes_sources ss ON s.id = ss.scribe_id
       WHERE ss.source_id = $1`,
      [sourceId]
    );
    source.scribes = scribesResult.rows;

    res.json(source);
  } catch (error) {
    console.error('Error fetching source:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// PUT /sources/:id
app.put('/sources/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceId = parseInt(req.params.id);
    const {
      code, title, type, format, town, rismLink, catalogued,
      fromYear, toYear, fromYearAnnotation, toYearAnnotation,
      dates, publisherIds, scribeIds, images, inclusions
    } = req.body;

    // Update source
    const sourceResult = await client.query(
      `UPDATE sources SET
        code = $1, title = $2, type = $3, format = $4,
        town = $5, rism_link = $6, catalogued = $7,
        from_year = $8, to_year = $9,
        from_year_annotation = $10, to_year_annotation = $11,
        dates = $12
      WHERE id = $13
      RETURNING *`,
      [code, title, type, format, town, rismLink, catalogued,
       fromYear, toYear, fromYearAnnotation, toYearAnnotation,
       dates, sourceId]
    );

    if (sourceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source not found' });
    }

    // Update images
    await client.query(
      'DELETE FROM source_images WHERE source_id = $1',
      [sourceId]
    );

    if (images && images.length > 0) {
      const imageValues = images.map((image: any) => 
        `(${sourceId}, '${image.url}', '${image.label || ''}')`
      ).join(',');
      
      await client.query(
        `INSERT INTO source_images (source_id, url, label)
         VALUES ${imageValues}`
      );
    }

    // Update inclusions
    await client.query(
      'DELETE FROM inclusions WHERE source_id = $1',
      [sourceId]
    );

    if (inclusions && inclusions.length > 0) {
      const inclusionValues = inclusions.map((inclusion: any) => 
        `(${sourceId}, '${inclusion.notes || ''}', ${inclusion.order || 0}, ${inclusion.position || 'NULL'}, 
         ${inclusion.composition_id || 'NULL'}, 
         '${JSON.stringify(inclusion.clefs || [])}'::jsonb,
         '${JSON.stringify(inclusion.attribution_texts || [])}'::jsonb,
         '${JSON.stringify(inclusion.composer_ids || [])}'::jsonb)`
      ).join(',');
      
      await client.query(
        `INSERT INTO inclusions (source_id, notes, "order", position, composition_id, 
                                clefs, attribution_texts, composer_ids)
         VALUES ${inclusionValues}`
      );
    }

    // Update publisher relationships
    await client.query(
      'DELETE FROM publishers_sources WHERE source_id = $1',
      [sourceId]
    );

    if (publisherIds && publisherIds.length > 0) {
      const publisherValues = publisherIds.map((id: number) => 
        `(${sourceId}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO publishers_sources (source_id, publisher_id)
         VALUES ${publisherValues}`
      );
    }

    // Update scribe relationships
    await client.query(
      'DELETE FROM scribes_sources WHERE source_id = $1',
      [sourceId]
    );

    if (scribeIds && scribeIds.length > 0) {
      const scribeValues = scribeIds.map((id: number) => 
        `(${sourceId}, ${id})`
      ).join(',');
      
      await client.query(
        `INSERT INTO scribes_sources (source_id, scribe_id)
         VALUES ${scribeValues}`
      );
    }

    await client.query('COMMIT');

    // Fetch the complete updated source
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
      [sourceId]
    );

    res.json(completeSource.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating source:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// POST /compositions/match - Check for matching composition
app.post('/compositions/match', async (req: Request, res: Response) => {
  try {
    const {
      composer_ids,
      title_id,
      type_id,
      tone_index,
      even_odd_index,
      clefs
    } = req.body;

    // Look for an exact match
    const query = `
      WITH composer_matches AS (
        SELECT c.id, COUNT(DISTINCT a.refers_to_id) as match_count
        FROM compositions c
        JOIN attributions a ON c.id = a.inclusion_id
        WHERE a.refers_to_id = ANY($1)
        GROUP BY c.id
      )
      SELECT c.*, cm.match_count
      FROM compositions c
      JOIN composer_matches cm ON c.id = cm.id
      WHERE c.title_id = $2
        AND c.composition_type_id = $3
        AND ($4::integer IS NULL OR c.tone = $4)
        AND ($5::integer IS NULL OR c.even_odd = $5)
      ORDER BY cm.match_count DESC, c.id ASC
      LIMIT 1
    `;

    const result = await pool.query(query, [
      composer_ids,
      title_id,
      type_id,
      tone_index || null,
      even_odd_index || null
    ]);

    if (result.rows.length > 0) {
      // Found an exact match
      return res.json({
        status: 'match',
        composition_id: result.rows[0].id
      });
    }

    // No match found - this is a new composition
    res.json({
      status: 'new'
    });
  } catch (error) {
    console.error('Error matching composition:', error);
    res.status(500).json({ error: 'Failed to match composition' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 