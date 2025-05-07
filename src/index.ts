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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const search = (req.query.search as string) || '';
    const skip = (page - 1) * limit;

    const where = search ? {
      name: {
        startsWith: search,
        mode: Prisma.QueryMode.insensitive
      }
    } : {};

    const [composers, total] = await Promise.all([
      prisma.composer.findMany({
        where,
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
        skip,
        take: limit,
        orderBy: {
          name: 'asc'
        }
      }),
      prisma.composer.count({ where })
    ]);

    res.json({
      composers,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch composers' });
  }
});

// Get a single composer by ID
app.get('/composers/:id', async (req: Request, res: Response) => {
  try {
    const composer = await prisma.composer.findUnique({
      where: { id: parseInt(req.params.id) }
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
    const composer = await prisma.composer.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name: req.body.name,
        fromYear: req.body.fromYear,
        toYear: req.body.toYear,
        fromYearAnnotation: req.body.fromYearAnnotation,
        toYearAnnotation: req.body.toYearAnnotation,
        birthplace1: req.body.birthplace1,
        birthplace2: req.body.birthplace2,
        deathplace1: req.body.deathplace1,
        deathplace2: req.body.deathplace2
      }
    });
    res.json(composer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update composer' });
  }
});

// Create a new composer
app.post('/composers', async (req: Request, res: Response) => {
  try {
    const composer = await prisma.composer.create({
      data: {
        name: req.body.name,
        fromYear: req.body.fromYear,
        toYear: req.body.toYear,
        fromYearAnnotation: req.body.fromYearAnnotation,
        toYearAnnotation: req.body.toYearAnnotation,
        birthplace1: req.body.birthplace1,
        birthplace2: req.body.birthplace2,
        deathplace1: req.body.deathplace1,
        deathplace2: req.body.deathplace2
      }
    });
    res.status(201).json(composer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create composer' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 