import express from 'express';
import session from 'express-session';
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

const app = express();
const port = process.env.PORT || 3000;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(express.json());

// Serve static files with authentication for admin modules
app.use('/modules', requireAuthWeb, express.static('public/modules'));
app.use('/js', requireAuthWeb, express.static('public/js'));
app.use('/css', requireAuthWeb, express.static('public/css'));

// Serve public static files (login, registration, etc.) without authentication
app.use(express.static('public', {
  ignore: ['modules', 'js', 'css'] // These are handled above with auth
}));

// Simple favicon handler to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).send());

// Auth routes (no authentication required)
app.use('/api/auth', authRouter);

// API routes (require authentication)
app.use('/api/sources', requireAuthWeb, sourcesRouter);
app.use('/api/composers', requireAuthWeb, composersRouter);
app.use('/api/editors', requireAuthWeb, editorsRouter);
app.use('/api/performers', requireAuthWeb, performersRouter);
app.use('/api/publishers', requireAuthWeb, publishersRouter);
app.use('/api/scribes', requireAuthWeb, scribesRouter);
app.use('/api/functions', requireAuthWeb, functionsRouter);

// Protect the main admin page - redirect to login if not authenticated
app.get('/', requireAuthWeb, (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Public routes that don't require authentication
app.get('/login.html', (req, res) => {
  res.sendFile('login.html', { root: 'public' });
});

app.get('/register.html', (req, res) => {
  res.sendFile('register.html', { root: 'public' });
});

app.get('/forgot-password.html', (req, res) => {
  res.sendFile('forgot-password.html', { root: 'public' });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Visit http://localhost:${port} to access the application`);
  console.log(`Default admin login: admin@polyphony.local / tempPassword123!`);
  console.log(`Please change the default password immediately after first login.`);
}); 