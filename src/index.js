import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db.js';
import { requireAuthWeb } from './middleware/auth.js';
import sourcesRouter from './routes/sources.js';
import composersRouter from './routes/composers.js';
import editorsRouter from './routes/editors.js';
import performersRouter from './routes/performers.js';
import publishersRouter from './routes/publishers.js';
import scribesRouter from './routes/scribes.js';
import functionsRouter from './routes/functions.js';
import authRouter from './routes/auth.js';
import searchRouter from './routes/search.js';
import groupsRouter from './routes/groups.js';
import adminRouter from './routes/admin.js';
import path from 'path';

const PgStore = connectPgSimple(session);

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy for Heroku deployment
app.set('trust proxy', 1);

// Session configuration with PostgreSQL-backed store
app.use(session({
  store: new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
  }
}));

// Middleware
app.use(express.json({ limit: '10mb' }));

// Simple favicon handler to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).send());

// Auth routes (no authentication required)
app.use('/api/auth', authRouter);

// Liturgy booklet (authenticated users only; must be before static catch-all)
app.get('/booklet', requireAuthWeb, (req, res) => {
  res.sendFile('modules/liturgy-booklet/index.html', { root: 'public' });
});

// Serve static files
app.use(express.static('public'));

// PUBLIC ROUTES (no authentication required)
// Root URL serves the public search interface
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Public API routes for search
app.use('/api/search', searchRouter);

// ADMIN ROUTES (authentication required)
// Admin login pages (no auth required)
app.get('/admin/login', (req, res) => {
  res.sendFile('login.html', { root: 'public' });
});

app.get('/admin/register', (req, res) => {
  res.sendFile('register.html', { root: 'public' });
});

app.get('/admin/forgot-password', (req, res) => {
  res.sendFile('forgot-password.html', { root: 'public' });
});

app.get('/admin/reset-password', (req, res) => {
  res.sendFile('reset-password.html', { root: 'public' });
});

// Admin dashboard and pages (authentication required)
app.get('/admin', requireAuthWeb, (req, res) => {
  res.sendFile('admin-dashboard.html', { root: 'public' });
});

app.get('/admin/users', requireAuthWeb, (req, res) => {
  res.sendFile('user-management.html', { root: 'public' });
});

app.get('/admin/groups', requireAuthWeb, (req, res) => {
  res.sendFile('group-management.html', { root: 'public' });
});

app.get('/admin/clef-voicings', requireAuthWeb, (req, res) => {
  res.sendFile('admin-clef-voicings.html', { root: 'public' });
});

// Admin module pages
app.get('/admin/sources*', requireAuthWeb, (req, res, next) => {
  req.url = req.url.replace('/admin', '');
  express.static('public')(req, res, next);
});

app.get('/admin/modules*', requireAuthWeb, (req, res, next) => {
  req.url = req.url.replace('/admin', '');
  express.static('public')(req, res, next);
});

// Admin API routes (require authentication)
app.use('/api/admin/sources', requireAuthWeb, sourcesRouter);
app.use('/api/admin/composers', requireAuthWeb, composersRouter);
app.use('/api/admin/editors', requireAuthWeb, editorsRouter);
app.use('/api/admin/performers', requireAuthWeb, performersRouter);
app.use('/api/admin/publishers', requireAuthWeb, publishersRouter);
app.use('/api/admin/scribes', requireAuthWeb, scribesRouter);
app.use('/api/admin/functions', requireAuthWeb, functionsRouter);
app.use('/api/admin/groups', requireAuthWeb, groupsRouter);
app.use('/api/admin', requireAuthWeb, adminRouter);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Visit http://localhost:${port} to access the application`);
  console.log(`Default admin login: admin@polyphony.local / tempPassword123!`);
  console.log(`Please change the default password immediately after first login.`);
}); 