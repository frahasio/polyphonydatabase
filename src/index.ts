import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Get a single composer by ID
app.get('/composers/:id', async (req: Request, res: Response) => {
  try {
    const composer = await prisma.composer.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        compositions: {
          include: {
            composition: true
          }
        }
      }
    });
    if (!composer) {
      return res.status(404).json({ error: 'Composer not found' });
    }
    res.json(composer);
  } catch (error) {
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
        fromYear: req.body.fromYear ? parseInt(req.body.fromYear) : null,
        toYear: req.body.toYear ? parseInt(req.body.toYear) : null,
        fromYearAnnotation: req.body.fromYearAnnotation,
        toYearAnnotation: req.body.toYearAnnotation,
        birthplace1: req.body.birthplace1,
        birthplace2: req.body.birthplace2,
        deathplace1: req.body.deathplace1,
        deathplace2: req.body.deathplace2,
        imageUrl: req.body.imageUrl
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
        fromYear: req.body.fromYear ? parseInt(req.body.fromYear) : null,
        toYear: req.body.toYear ? parseInt(req.body.toYear) : null,
        fromYearAnnotation: req.body.fromYearAnnotation,
        toYearAnnotation: req.body.toYearAnnotation,
        birthplace1: req.body.birthplace1,
        birthplace2: req.body.birthplace2,
        deathplace1: req.body.deathplace1,
        deathplace2: req.body.deathplace2,
        imageUrl: req.body.imageUrl
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