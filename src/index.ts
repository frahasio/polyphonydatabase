import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Get all composers
app.get('/composers', async (req: Request, res: Response) => {
  try {
    const composers = await prisma.composer.findMany({
      include: {
        compositions: {
          include: {
            composition: true
          }
        }
      }
    });
    res.json(composers);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ 
      error: 'Failed to fetch composers',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

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