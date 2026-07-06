import express from 'express';
import bcrypt from 'bcrypt';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { pool } from '../db.js';
import { isAccountLocked, requireAuth } from '../middleware/auth.js';
import { ensureUserPermissions } from '../db.js';
import emailService from '../services/emailService.js';

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

// Rate limiting for password reset flows (prevents email bombing and
// brute-forcing of reset tokens)
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many password reset attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reset tokens are stored hashed so a database leak cannot be used to take
// over accounts; the raw token only ever exists in the reset email.
function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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

    // Send welcome email to user
    const welcomeEmailSent = await emailService.sendWelcomeEmail(newUser.email, newUser.name);
    if (welcomeEmailSent) {
      console.log(`Welcome email sent to ${newUser.email}`);
    } else {
      console.error(`Failed to send welcome email to ${newUser.email}`);
    }

    // Send notification email to admin
    const adminEmailSent = await emailService.sendAdminNotificationEmail(newUser.email, newUser.name);
    if (adminEmailSent) {
      console.log(`Admin notification email sent for new user: ${newUser.email}`);
    } else {
      console.error(`Failed to send admin notification email for user: ${newUser.email}`);
    }

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

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user
    const result = await pool.query(
      'SELECT id, email, name, password_hash, status, role, login_attempts, locked_until FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if account is locked
    if (isAccountLocked(user)) {
      return res.status(423).json({ error: 'Account temporarily locked due to multiple failed login attempts' });
    }

    // Check if account is approved
    if (user.status !== 'approved') {
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

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
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

    // Regenerate the session id at login (prevents session fixation), then
    // record the user. The session cookie is the only credential.
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ error: 'Internal server error during login' });
      }
      req.session.userId = user.id;
      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
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

// Check authentication status (no authentication required)
router.get('/status', (req, res) => {
  const authenticated = !!req.session?.userId;
  res.json({ authenticated });
});

// Extend the session without requiring re-login (kept for older clients;
// sessions no longer carry tokens)
router.post('/refresh', requireAuth, (req, res) => {
  req.session.touch();
  res.json({
    message: 'Session refreshed successfully',
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// Get current user info (including permissions)
router.get('/me', requireAuth, async (req, res) => {
  let permissions = { catalogue: true, booklet_creator: true, import_source: true, commissions: true };

  if (req.user.role !== 'admin') {
    await ensureUserPermissions(req.user.id);
    const permResult = await pool.query(
      'SELECT catalogue, booklet_creator, import_source, commissions FROM user_permissions WHERE user_id = $1',
      [req.user.id]
    );
    if (permResult.rows.length) {
      permissions = permResult.rows[0];
    }
  }

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      status: req.user.status,
      last_login: req.user.last_login,
      permissions
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
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
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

    // Generate reset token; only the hash is persisted
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [hashResetToken(resetToken), resetTokenExpires, user.rows[0].id]
    );

    // Send password reset email
    const emailSent = await emailService.sendPasswordResetEmail(email, resetToken);
    
    if (emailSent) {
      console.log(`Password reset email sent to ${email}`);
    } else {
      console.error(`Failed to send password reset email to ${email}`);
    }

    res.json({ message: 'If an account with that email exists, a password reset link has been sent' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error during password reset' });
  }
});

// Reset password with token
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Find user with valid reset token (tokens are stored hashed)
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
      [hashResetToken(String(token))]
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

    // Invalidate the user's existing sessions so a stolen session cookie
    // does not survive a password reset.
    try {
      await pool.query(
        `DELETE FROM user_sessions WHERE (sess::jsonb ->> 'userId')::int = $1`,
        [userId]
      );
    } catch (sessionErr) {
      console.error('Failed to clear sessions after password reset:', sessionErr.message);
    }

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error during password reset' });
  }
});

export default router;
