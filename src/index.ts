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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 