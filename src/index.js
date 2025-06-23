import express from 'express';
import { pool } from './db.js';
import sourcesRouter from './routes/sources.js';
import composersRouter from './routes/composers.js';
import editorsRouter from './routes/editors.js';
import performersRouter from './routes/performers.js';
import publishersRouter from './routes/publishers.js';
import scribesRouter from './routes/scribes.js';
import functionsRouter from './routes/functions.js';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Simple favicon handler to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).send());

// Routes
app.use('/api/sources', sourcesRouter);
app.use('/api/composers', composersRouter);
app.use('/api/editors', editorsRouter);
app.use('/api/performers', performersRouter);
app.use('/api/publishers', publishersRouter);
app.use('/api/scribes', scribesRouter);
app.use('/api/functions', functionsRouter);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 