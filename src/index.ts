import express, { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Helper function to parse year string into components
function parseYearString(yearString: string): { year: number | null; annotation: string | null } {
  // Remove any non-numeric characters from the start
  const numericMatch = yearString.match(/\d+/);
  if (!numericMatch) return { year: null, annotation: yearString || null };
  
  const year = parseInt(numericMatch[0]);
  const annotation = yearString.replace(numericMatch[0], '').trim() || null;
  return { year, annotation };
}

// Helper function to format years for display
function formatDisplayYears(fromYear: number | null, toYear: number | null, fromAnnotation: string | null, toAnnotation: string | null): string {
  if (!fromYear && !toYear) return '';
  
  const from = fromYear ? `${fromAnnotation || ''}${fromYear}` : '';
  const to = toYear ? `${toAnnotation || ''}${toYear}` : '';
  
  if (from && to) return `${from}–${to}`;
  if (from) return from;
  if (to) return to;
  return '';
}

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
          displayYears: true
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
    const { displayYears, ...rest } = req.body;
    
    // Parse the display years string if provided
    let fromYear = rest.fromYear;
    let toYear = rest.toYear;
    let fromYearAnnotation = rest.fromYearAnnotation;
    let toYearAnnotation = rest.toYearAnnotation;

    if (displayYears) {
      const [fromPart, toPart] = displayYears.split('–').map((part: string) => part.trim());
      
      if (fromPart) {
        const from = parseYearString(fromPart);
        fromYear = from.year;
        fromYearAnnotation = from.annotation;
      }
      
      if (toPart) {
        const to = parseYearString(toPart);
        toYear = to.year;
        toYearAnnotation = to.annotation;
      }
    }

    const composer = await prisma.composer.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name: rest.name,
        fromYear: fromYear ? parseInt(fromYear.toString()) : null,
        toYear: toYear ? parseInt(toYear.toString()) : null,
        fromYearAnnotation,
        toYearAnnotation,
        displayYears: formatDisplayYears(
          fromYear ? parseInt(fromYear.toString()) : null,
          toYear ? parseInt(toYear.toString()) : null,
          fromYearAnnotation,
          toYearAnnotation
        ),
        birthplace1: rest.birthplace1,
        birthplace2: rest.birthplace2,
        deathplace1: rest.deathplace1,
        deathplace2: rest.deathplace2
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
    const { displayYears, ...rest } = req.body;
    
    // Parse the display years string if provided
    let fromYear = rest.fromYear;
    let toYear = rest.toYear;
    let fromYearAnnotation = rest.fromYearAnnotation;
    let toYearAnnotation = rest.toYearAnnotation;

    if (displayYears) {
      const [fromPart, toPart] = displayYears.split('–').map((part: string) => part.trim());
      
      if (fromPart) {
        const from = parseYearString(fromPart);
        fromYear = from.year;
        fromYearAnnotation = from.annotation;
      }
      
      if (toPart) {
        const to = parseYearString(toPart);
        toYear = to.year;
        toYearAnnotation = to.annotation;
      }
    }

    const composer = await prisma.composer.create({
      data: {
        name: rest.name,
        fromYear: fromYear ? parseInt(fromYear.toString()) : null,
        toYear: toYear ? parseInt(toYear.toString()) : null,
        fromYearAnnotation,
        toYearAnnotation,
        displayYears: formatDisplayYears(
          fromYear ? parseInt(fromYear.toString()) : null,
          toYear ? parseInt(toYear.toString()) : null,
          fromYearAnnotation,
          toYearAnnotation
        ),
        birthplace1: rest.birthplace1,
        birthplace2: rest.birthplace2,
        deathplace1: rest.deathplace1,
        deathplace2: rest.deathplace2
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