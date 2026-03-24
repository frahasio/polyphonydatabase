import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Middleware to require authentication
export const requireAuth = async (req, res, next) => {
  try {
    const token = req.session?.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.userId);
    
    if (!user || user.status !== 'approved') {
      return res.status(401).json({ error: 'Account not approved or invalid' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware to require admin role
export const requireAdmin = async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Admin access required' });
  }
};

// Middleware to redirect to login page for web routes
export const requireAuthWeb = async (req, res, next) => {
  try {
    const token = req.session?.token;
    
    if (!token) {
      return res.redirect('/admin/login');
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.userId);
    
    if (!user || user.status !== 'approved') {
      req.session.destroy();
      return res.redirect('/admin/login');
    }

    req.user = user;
    next();
  } catch (error) {
    req.session.destroy();
    return res.redirect('/admin/login');
  }
};

// Middleware to require specific role for data access
export const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      await requireAuth(req, res, () => {});
      
      if (!allowedRoles.includes(req.user?.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Access denied' });
    }
  };
};

// Middleware for public data access with optional authentication
export const optionalAuth = async (req, res, next) => {
  try {
    const token = req.session?.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await getUserById(decoded.userId);
      
      if (user && user.status === 'approved') {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
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

// Generate JWT token
export function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '365d' });
}

// Check if user account is locked
export function isAccountLocked(user) {
  return user.locked_until && new Date(user.locked_until) > new Date();
} 