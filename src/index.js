import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, runMigrations } from './db.js';
import { requireAuthWeb, requirePermission, requirePermissionWeb } from './middleware/auth.js';
import sourcesRouter from './routes/sources.js';
import composersRouter from './routes/composers.js';
import editorsRouter from './routes/editors.js';
import performersRouter from './routes/performers.js';
import publishersRouter from './routes/publishers.js';
import scribesRouter from './routes/scribes.js';
import functionsRouter from './routes/functions.js';
import authRouter from './routes/auth.js';
import searchRouter from './routes/search.js';
import bookletApiRouter from './routes/booklet.js';
import groupsRouter from './routes/groups.js';
import adminRouter from './routes/admin.js';
import adminUsersRouter from './routes/adminUsers.js';
import importRouter from './routes/import.js';
import path from 'path';

const PgStore = connectPgSimple(session);

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Refuse to run in production with a guessable secret.
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// Trust proxy for Heroku deployment
app.set('trust proxy', 1);

// Session configuration with PostgreSQL-backed store
app.use(session({
  store: new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'insecure-dev-only-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Heroku terminates TLS at the router; trust proxy above makes
    // express-session honour X-Forwarded-Proto for the Secure flag.
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
  }
}));

// Middleware
app.use(express.json({ limit: '25mb' }));

// CSRF protection for session-authenticated APIs: browsers send an Origin
// header on cross-site requests; reject mutating API calls whose Origin does
// not match the request host. Same-origin requests (and non-browser clients,
// which omit Origin) pass through. Complements the sameSite=lax cookie.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    /* malformed Origin falls through to rejection */
  }
  return res.status(403).json({ error: 'Cross-origin request rejected' });
});

// Simple favicon handler to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).send());

// Auth routes (no authentication required)
app.use('/api/auth', authRouter);

// Liturgy booklet (requires booklet_creator permission)
app.get('/booklet', requireAuthWeb, requirePermissionWeb('booklet_creator'), (req, res) => {
  res.sendFile('modules/liturgy-booklet/index.html', { root: 'public' });
});

// Admin-only static content: the plain static mount below serves everything
// in public/, so without this gate the whole admin UI (module pages, booklet,
// dashboards) is downloadable anonymously. APIs enforce their own auth; this
// closes the UI exposure. Login/register/reset pages and public assets
// (css/js/images/vendor) remain unauthenticated.
const protectedStaticPrefixes = ['/modules/'];
const protectedStaticPages = new Set([
  '/admin-dashboard.html',
  '/user-management.html',
  '/group-management.html',
]);
app.use((req, res, next) => {
  const p = req.path;
  if (protectedStaticPrefixes.some((prefix) => p.startsWith(prefix)) || protectedStaticPages.has(p)) {
    return requireAuthWeb(req, res, next);
  }
  next();
});

// Serve static files. Fonts get a CORS header: unlike CSS/images, web fonts
// are blocked for cross/null-origin documents without it. The PDF export
// renders pages via Puppeteer setContent() (null origin), so without this the
// bold Crimson faces fail there and Chrome falls back to DejaVu (oversized
// bold lyrics, broken small-caps text mapping in exported PDFs).
app.use(express.static('public', {
  setHeaders: function (res, path) {
    if (/\.(ttf|otf|woff2?|eot)$/i.test(path)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  },
}));

// PUBLIC ROUTES (no authentication required)
// Root URL serves the public search interface
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Public API routes for search
app.use('/api/search', searchRouter);

// Booklet helpers (requires booklet_creator permission)
app.use('/api/booklet', requireAuthWeb, requirePermission('booklet_creator'), bookletApiRouter);

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
  res.sendFile('modules/clef-voicings/index.html', { root: 'public' });
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

// Admin API routes (require authentication + feature permissions)
app.use('/api/admin/sources', requireAuthWeb, requirePermission('catalogue'), sourcesRouter);
app.use('/api/admin/composers', requireAuthWeb, requirePermission('catalogue'), composersRouter);
app.use('/api/admin/editors', requireAuthWeb, requirePermission('catalogue'), editorsRouter);
app.use('/api/admin/performers', requireAuthWeb, requirePermission('catalogue'), performersRouter);
app.use('/api/admin/publishers', requireAuthWeb, requirePermission('catalogue'), publishersRouter);
app.use('/api/admin/scribes', requireAuthWeb, requirePermission('catalogue'), scribesRouter);
app.use('/api/admin/functions', requireAuthWeb, requirePermission('catalogue'), functionsRouter);
app.use('/api/admin/groups', requireAuthWeb, requirePermission('catalogue'), groupsRouter);
app.use('/api/admin/import', requireAuthWeb, requirePermission('import_source'), importRouter);
// User management (guards itself with requireAdmin → JSON 401/403, no redirects)
app.use('/api/admin', adminUsersRouter);
app.use('/api/admin', requireAuthWeb, adminRouter);

// Run migrations then start the server. In production a migration failure
// refuses to start (the Heroku release phase should have caught it first);
// in development we warn and start anyway so local work without a database
// connection remains possible.
function startServer() {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
  });
}

runMigrations()
  .then(startServer)
  .catch((error) => {
    console.error('Migration failure:', error.message);
    if (isProduction) {
      process.exit(1);
    }
    console.error('Development mode: starting without verified migrations.');
    startServer();
  });
