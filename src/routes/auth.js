import express from 'express';
import bcrypt from 'bcrypt';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { pool } from '../db.js';
import { generateToken, isAccountLocked, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'Too many registration attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// User registration
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters long' });
    }

    // Check if email already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, status, role) 
       VALUES ($1, $2, $3, 'pending', 'user') 
       RETURNING id, email, name, status, created_at`,
      [email.toLowerCase(), passwordHash, name.trim()]
    );

    const newUser = result.rows[0];

    res.status(201).json({
      message: 'Registration successful. Your account is pending approval.',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        status: newUser.status
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// User login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('Login attempt for:', email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user
    const result = await pool.query(
      'SELECT id, email, name, password_hash, status, role, login_attempts, locked_until FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    console.log('Database query result:', result.rows.length, 'users found');

    const user = result.rows[0];
    if (!user) {
      console.log('No user found for email:', email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('User found:', user.email, 'Status:', user.status, 'Role:', user.role);

    // Check if account is locked
    if (isAccountLocked(user)) {
      console.log('Account is locked until:', user.locked_until);
      return res.status(423).json({ error: 'Account temporarily locked due to multiple failed login attempts' });
    }

    // Check if account is approved
    if (user.status !== 'approved') {
      console.log('Account status is not approved:', user.status);
      let message = 'Account not approved';
      if (user.status === 'pending') {
        message = 'Account is pending approval';
      } else if (user.status === 'rejected') {
        message = 'Account has been rejected';
      } else if (user.status === 'suspended') {
        message = 'Account has been suspended';
      }
      return res.status(403).json({ error: message });
    }

    console.log('Verifying password...');
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log('Password match:', passwordMatch);
    
    if (!passwordMatch) {
      console.log('Password verification failed');
      // Increment failed login attempts
      const newAttempts = user.login_attempts + 1;
      let lockedUntil = null;
      
      if (newAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
      }

      await pool.query(
        'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
        [newAttempts, lockedUntil, user.id]
      );

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Successful login - reset attempts and update last login
    await pool.query(
      'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate token
    const token = generateToken(user.id);

    // Store token in session
    req.session.token = token;
    req.session.userId = user.id;

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Error during logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user info
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      status: req.user.status,
      last_login: req.user.last_login
    }
  });
});

// Change password (authenticated users)
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Get current user's password hash
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, req.user.id]);

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error during password change' });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    
    // Always return success to prevent email enumeration
    if (user.rows.length === 0) {
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, resetTokenExpires, user.rows[0].id]
    );

    // TODO: Send email with reset link
    console.log(`Password reset requested for ${email}. Reset token: ${resetToken}`);

    res.json({ message: 'If an account with that email exists, a password reset link has been sent' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error during password reset' });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Find user with valid reset token
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const userId = result.rows[0].id;

    // Hash new password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear reset token
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [passwordHash, userId]
    );

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error during password reset' });
  }
});

// Admin: Get all users
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [limit, offset];
    
    if (status && ['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
      whereClause = 'WHERE status = $3';
      params.push(status);
    }

    const result = await pool.query(`
      SELECT id, email, name, status, role, created_at, last_login, login_attempts
      FROM users 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `, params);

    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM users ${whereClause}
    `, status ? [status] : []);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      users: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Update user status
router.put('/admin/users/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Don't allow changing own status
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own status' });
    }

    const result = await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, name, status',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: `User status updated to ${status}`,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Update user role
router.put('/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Don't allow changing own role
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role',
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: `User role updated to ${role}`,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Debug route to check if admin user exists (remove in production)
router.get('/debug/admin-user', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, status, role, created_at FROM users WHERE email = $1',
      ['admin@polyphony.local']
    );

    if (result.rows.length === 0) {
      return res.json({ 
        exists: false, 
        message: 'Admin user does not exist in database' 
      });
    }

    const user = result.rows[0];
    res.json({
      exists: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        role: user.role,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Debug admin user error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router; 