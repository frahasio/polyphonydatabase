import express, { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Get all composers (minimal data for list view)
app.get('/composers', async (req: Request, res: Response) => {
  try {
    const letter = (req.query.letter as string) || '';

    // Get composers filtered by letter
    const composers = await prisma.composer.findMany({
      where: letter ? {
        name: {
          startsWith: letter,
          mode: Prisma.QueryMode.insensitive
        }
      } : undefined,
      select: {
        id: true,
        name: true,
        fromYear: true,
        toYear: true,
        fromYearAnnotation: true,
        toYearAnnotation: true,
        birthplace1: true,
        birthplace2: true,
        deathplace1: true,
        deathplace2: true
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.json({ composers });
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Failed to fetch composers' });
  }
});

// Get a single composer by ID
app.get('/composers/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid composer ID' });
    }

    const composer = await prisma.composer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fromYear: true,
        toYear: true,
        fromYearAnnotation: true,
        toYearAnnotation: true,
        birthplace1: true,
        birthplace2: true,
        deathplace1: true,
        deathplace2: true
      }
    });

    if (!composer) {
      return res.status(404).json({ error: 'Composer not found' });
    }

    res.json(composer);
  } catch (error) {
    console.error('Error fetching composer:', error);
    res.status(500).json({ error: 'Failed to fetch composer' });
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
    
    const composer = await prisma.composer.update({
      where: { id },
      data: {
        name: rest.name,
        fromYear: fromYear ? parseInt(fromYear.toString()) : null,
        toYear: toYear ? parseInt(toYear.toString()) : null,
        fromYearAnnotation: rest.fromYearAnnotation || null,
        toYearAnnotation: rest.toYearAnnotation || null,
        birthplace1: rest.birthplace1 || null,
        birthplace2: rest.birthplace2 || null,
        deathplace1: rest.deathplace1 || null,
        deathplace2: rest.deathplace2 || null
      }
    });
    res.json(composer);
  } catch (error) {
    console.error('Error updating composer:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Composer not found' });
      }
    }
    res.status(500).json({ error: 'Failed to update composer' });
  }
});

// Create a new composer
app.post('/composers', async (req: Request, res: Response) => {
  try {
    const { fromYear, toYear, ...rest } = req.body;
    
    const composer = await prisma.composer.create({
      data: {
        name: rest.name,
        fromYear: fromYear ? parseInt(fromYear.toString()) : null,
        toYear: toYear ? parseInt(toYear.toString()) : null,
        fromYearAnnotation: rest.fromYearAnnotation || null,
        toYearAnnotation: rest.toYearAnnotation || null,
        birthplace1: rest.birthplace1 || null,
        birthplace2: rest.birthplace2 || null,
        deathplace1: rest.deathplace1 || null,
        deathplace2: rest.deathplace2 || null
      }
    });
    res.status(201).json(composer);
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

    await prisma.composer.delete({
      where: { id }
    });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting composer:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Composer not found' });
      }
    }
    res.status(500).json({ error: 'Failed to delete composer' });
  }
});

// GET /editors - List all editors
app.get('/editors', async (req, res) => {
    try {
        const editors = await prisma.editor.findMany({
            orderBy: {
                name: 'asc'
            }
        });

        res.json({ editors });
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

        const editor = await prisma.editor.findUnique({
            where: { id }
        });

        if (!editor) {
            return res.status(404).json({ error: 'Editor not found' });
        }

        res.json(editor);
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

        const editor = await prisma.editor.update({
            where: { id },
            data: {
                name: req.body.name,
                dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null
            }
        });
        res.json(editor);
    } catch (error) {
        console.error('Error updating editor:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Editor not found' });
            }
        }
        res.status(500).json({ error: 'Failed to update editor' });
    }
});

// POST /editors - Create a new editor
app.post('/editors', async (req, res) => {
    try {
        const editor = await prisma.editor.create({
            data: {
                name: req.body.name,
                dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null
            }
        });
        res.status(201).json(editor);
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

        await prisma.editor.delete({
            where: { id }
        });
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting editor:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Editor not found' });
            }
        }
        res.status(500).json({ error: 'Failed to delete editor' });
    }
});

// GET /scribes - List all scribes
app.get('/scribes', async (req, res) => {
    try {
        const scribes = await prisma.scribe.findMany({
            orderBy: {
                name: 'asc'
            }
        });

        res.json({ scribes });
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

        const scribe = await prisma.scribe.findUnique({
            where: { id }
        });

        if (!scribe) {
            return res.status(404).json({ error: 'Scribe not found' });
        }

        res.json(scribe);
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

        const scribe = await prisma.scribe.update({
            where: { id },
            data: {
                name: req.body.name
            }
        });
        res.json(scribe);
    } catch (error) {
        console.error('Error updating scribe:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Scribe not found' });
            }
        }
        res.status(500).json({ error: 'Failed to update scribe' });
    }
});

// POST /scribes - Create a new scribe
app.post('/scribes', async (req, res) => {
    try {
        const scribe = await prisma.scribe.create({
            data: {
                name: req.body.name
            }
        });
        res.status(201).json(scribe);
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

        await prisma.scribe.delete({
            where: { id }
        });
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting scribe:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Scribe not found' });
            }
        }
        res.status(500).json({ error: 'Failed to delete scribe' });
    }
});

// GET /publishers - List all publishers
app.get('/publishers', async (req, res) => {
    try {
        const publishers = await prisma.publisher.findMany({
            orderBy: {
                name: 'asc'
            }
        });

        res.json({ publishers });
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

        const publisher = await prisma.publisher.findUnique({
            where: { id }
        });

        if (!publisher) {
            return res.status(404).json({ error: 'Publisher not found' });
        }

        res.json(publisher);
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

        const publisher = await prisma.publisher.update({
            where: { id },
            data: {
                name: req.body.name
            }
        });
        res.json(publisher);
    } catch (error) {
        console.error('Error updating publisher:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Publisher not found' });
            }
        }
        res.status(500).json({ error: 'Failed to update publisher' });
    }
});

// POST /publishers - Create a new publisher
app.post('/publishers', async (req, res) => {
    try {
        const publisher = await prisma.publisher.create({
            data: {
                name: req.body.name
            }
        });
        res.status(201).json(publisher);
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

        await prisma.publisher.delete({
            where: { id }
        });
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting publisher:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Publisher not found' });
            }
        }
        res.status(500).json({ error: 'Failed to delete publisher' });
    }
});

// GET /performers - List all performers
app.get('/performers', async (req, res) => {
    try {
        const performers = await prisma.performer.findMany({
            orderBy: {
                name: 'asc'
            }
        });

        res.json({ performers });
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

        const performer = await prisma.performer.findUnique({
            where: { id }
        });

        if (!performer) {
            return res.status(404).json({ error: 'Performer not found' });
        }

        res.json(performer);
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

        const performer = await prisma.performer.update({
            where: { id },
            data: {
                name: req.body.name
            }
        });
        res.json(performer);
    } catch (error) {
        console.error('Error updating performer:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Performer not found' });
            }
        }
        res.status(500).json({ error: 'Failed to update performer' });
    }
});

// POST /performers - Create a new performer
app.post('/performers', async (req, res) => {
    try {
        const performer = await prisma.performer.create({
            data: {
                name: req.body.name
            }
        });
        res.status(201).json(performer);
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

        await prisma.performer.delete({
            where: { id }
        });
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting performer:', error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Performer not found' });
            }
        }
        res.status(500).json({ error: 'Failed to delete performer' });
    }
});

// GET /sources - List all sources
app.get('/sources', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';

    // Build where clause for search
    const where = search ? {
      OR: [
        { code: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { title: { contains: search, mode: Prisma.QueryMode.insensitive } }
      ]
    } : undefined;

    // Get sources
    const sources = await prisma.source.findMany({
      where,
      select: {
        id: true,
        code: true,
        title: true,
        fromYear: true,
        toYear: true,
        catalogued: true
      },
      orderBy: {
        code: 'asc'
      }
    });

    res.json({ sources });
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// POST /sources - Create a new source
app.post('/sources', async (req, res) => {
  try {
    const {
      code,
      title,
      type,
      format,
      town,
      rismLink,
      images,
      catalogued,
      fromYear,
      toYear,
      fromYearAnnotation,
      toYearAnnotation,
      dates,
      locationAndPubscribe,
      publisherIds,
      scribeIds
    } = req.body;

    const source = await prisma.source.create({
      data: {
        code,
        title,
        type,
        format,
        town,
        rismLink,
        catalogued: catalogued || false,
        fromYear: fromYear ? parseInt(fromYear.toString()) : null,
        toYear: toYear ? parseInt(toYear.toString()) : null,
        fromYearAnnotation,
        toYearAnnotation,
        dates,
        locationAndPubscribe,
        publishers: publisherIds ? {
          connect: publisherIds.map((id: number) => ({ id }))
        } : undefined,
        scribes: scribeIds ? {
          connect: scribeIds.map((id: number) => ({ id }))
        } : undefined,
        images: images ? {
          create: images.map((img: { url: string, label?: string }) => ({
            url: img.url,
            label: img.label
          }))
        } : undefined
      },
      include: {
        publishers: true,
        scribes: true,
        images: true
      }
    });

    res.status(201).json(source);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(400).json({ error: 'Source code must be unique' });
    } else {
      console.error('Error creating source:', error);
      res.status(500).json({ error: 'Failed to create source' });
    }
  }
});

// PUT /sources/:id
app.put('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            code, 
            title, 
            type, 
            format, 
            town, 
            rismLink, 
            images,
            catalogued, 
            fromYear, 
            toYear, 
            fromYearAnnotation, 
            toYearAnnotation, 
            dates, 
            locationAndPubscribe, 
            publisherIds, 
            scribeIds 
        } = req.body;
        
        // First update the source
        const source = await prisma.source.update({
            where: { id: parseInt(id) },
            data: {
                code,
                title,
                type,
                format,
                town,
                rismLink,
                catalogued,
                fromYear,
                toYear,
                fromYearAnnotation,
                toYearAnnotation,
                dates,
                locationAndPubscribe,
                publishers: publisherIds ? {
                    set: publisherIds.map((id: number) => ({ id }))
                } : undefined,
                scribes: scribeIds ? {
                    set: scribeIds.map((id: number) => ({ id }))
                } : undefined,
                images: images ? {
                    deleteMany: {},
                    create: images.map((img: { url: string, label?: string }) => ({
                        url: img.url,
                        label: img.label
                    }))
                } : undefined
            },
            include: {
                publishers: true,
                scribes: true,
                images: true
            }
        });

        res.json(source);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            res.status(400).json({ error: 'Source code must be unique' });
        } else {
            console.error('Error updating source:', error);
            res.status(500).json({ error: 'Failed to update source' });
        }
    }
});

// DELETE /sources/:id
app.delete('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.source.delete({
            where: { id: parseInt(id) }
        });

        res.status(204).send();
    } catch (error) {
        console.error('Error deleting source:', error);
        res.status(500).json({ error: 'Failed to delete source' });
    }
});

// GET /sources/:id
app.get('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const source = await prisma.source.findUnique({
            where: { id: parseInt(id) },
            include: {
                publishers: true,
                scribes: true,
                images: true
            }
        });

        if (!source) {
            res.status(404).json({ error: 'Source not found' });
            return;
        }

        res.json(source);
    } catch (error) {
        console.error('Error fetching source:', error);
        res.status(500).json({ error: 'Failed to fetch source' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 