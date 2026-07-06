import { pool, ensureUserPermissions } from '../db.js';

// Session-based authentication: the server-side session (PostgreSQL-backed)
// is the single credential. req.session.userId is set at login and cleared
// by logout / password reset. No tokens are issued to the client.

// Load the session's user. Returns null when not logged in or not approved.
async function getSessionUser(req) {
  const userId = req.session?.userId;
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user || user.status !== 'approved') return null;
  return user;
}

// Middleware to require authentication (JSON APIs)
export const requireAuth = async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication required' });
  }
};

// Middleware for web pages: redirects to login instead of returning JSON
export const requireAuthWeb = async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      if (req.session?.userId) {
        // Session references a missing/unapproved user — drop it.
        req.session.destroy(() => {});
      }
      return res.redirect('/admin/login');
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.redirect('/admin/login');
  }
};

// Middleware to require admin role. Delegates to requireAuth, which only
// invokes the continuation on success — so exactly one response is ever sent.
export const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

// Middleware to require a specific permission (admins bypass)
export const requirePermission = (permName) => {
  const validPerms = ['catalogue', 'booklet_creator', 'import_source'];
  if (!validPerms.includes(permName)) {
    throw new Error(`Invalid permission name: ${permName}`);
  }

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (req.user.role === 'admin') {
        return next();
      }

      await ensureUserPermissions(req.user.id);

      const result = await pool.query(
        `SELECT ${permName} FROM user_permissions WHERE user_id = $1`,
        [req.user.id]
      );

      if (!result.rows.length || !result.rows[0][permName]) {
        return res.status(403).json({ error: 'You do not have permission to access this feature' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(403).json({ error: 'Permission check failed' });
    }
  };
};

// Helper function to get user by ID
async function getUserById(id) {
  try {
    const result = await pool.query(
      'SELECT id, email, name, status, role, last_login FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
}

// Check if user account is locked
export function isAccountLocked(user) {
  return user.locked_until && new Date(user.locked_until) > new Date();
}
