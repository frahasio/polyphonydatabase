import express from 'express';
import bcrypt from 'bcrypt';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { pool } from '../db.js';
import { isAccountLocked, requireAuth, CATALOGUE_ENTITIES } from '../middleware/auth.js';
import { ensureUserPermissions } from '../db.js';
import emailService from '../services/emailService.js';
import { issueFormToken, checkAntiSpam } from '../middleware/antiSpam.js';

const router = express.Router();

// Unverified registrations are garbage-collected after this long.
const UNVERIFIED_TTL_DAYS = 7;
const VERIFY_TOKEN_HOURS = 48;

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

// Signed timestamp for the public forms' anti-spam timing check.
router.get('/form-token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: issueFormToken() });
});

const REGISTERED_MESSAGE =
  'Thank you. Please check your email and click the confirmation link to complete your registration.';

// User registration. Two-step: the account is created unverified and a
// confirmation link is emailed; only once the applicant clicks it does the
// admin get notified and the account appear in the pending list. Bots and
// throwaway addresses never complete the loop. The confirmation email
// contains nothing user-supplied, so it cannot be abused to relay spam.
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const spam = checkAntiSpam(req, 'register');
    if (!spam.ok) {
      if (spam.silent) return res.status(201).json({ message: REGISTERED_MESSAGE });
      return res.status(400).json({ error: spam.error });
    }

    const { email, password, message } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Optional message about what access the applicant is hoping for
    const applicationMessage = typeof message === 'string' && message.trim()
      ? message.trim().slice(0, 2000)
      : null;

    if (typeof email !== 'string' || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
    }
    // A name is never a link or markup; this field is the classic spam carrier.
    if (/https?:|www\.|[<>]/i.test(name)) {
      return res.status(400).json({ error: 'Please enter your name only' });
    }

    const emailLower = email.toLowerCase();

    // Garbage-collect stale unverified sign-ups so bot rows never accumulate.
    await pool.query(
      `DELETE FROM users WHERE email_verified_at IS NULL
         AND created_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval`,
      [UNVERIFIED_TTL_DAYS]
    );

    const existingUser = await pool.query(
      'SELECT id, email_verified_at FROM users WHERE email = $1',
      [emailLower]
    );
    const existing = existingUser.rows[0];
    if (existing && existing.email_verified_at) {
      // Same wording as success so the form cannot be used to enumerate
      // registered addresses.
      console.log(`Registration attempt for existing account ${emailLower}`);
      return res.status(201).json({ message: REGISTERED_MESSAGE });
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000);

    if (existing) {
      // Unverified re-registration (lost the email, typo in name...): replace
      // the pending details and send a fresh link.
      await pool.query(
        `UPDATE users SET password_hash = $1, name = $2, application_message = $3,
                          verify_token = $4, verify_token_expires = $5, created_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [passwordHash, name, applicationMessage, hashResetToken(verifyToken), verifyExpires, existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO users (email, password_hash, name, status, role, application_message,
                            verify_token, verify_token_expires)
         VALUES ($1, $2, $3, 'pending', 'user', $4, $5, $6)`,
        [emailLower, passwordHash, name, applicationMessage, hashResetToken(verifyToken), verifyExpires]
      );
    }

    const sent = await emailService.sendVerificationEmail(emailLower, verifyToken);
    if (sent) {
      console.log(`Verification email sent to ${emailLower}`);
    } else {
      console.error(`Failed to send verification email to ${emailLower}`);
    }

    res.status(201).json({ message: REGISTERED_MESSAGE });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// Email confirmation link target. Marks the address verified, notifies the
// admin (this is the point the application becomes visible), and lands the
// applicant on the register page with a status banner.
router.get('/verify-email/:token', async (req, res) => {
  const fail = () => res.redirect('/admin/register?verified=0');
  try {
    const token = String(req.params.token || '');
    if (!/^[0-9a-f]{64}$/.test(token)) return fail();

    const result = await pool.query(
      `UPDATE users
         SET email_verified_at = CURRENT_TIMESTAMP, verify_token = NULL, verify_token_expires = NULL
       WHERE verify_token = $1 AND verify_token_expires > CURRENT_TIMESTAMP
         AND email_verified_at IS NULL
       RETURNING id, email, name, application_message`,
      [hashResetToken(token)]
    );
    if (!result.rows.length) return fail();

    const user = result.rows[0];
    console.log(`Email verified for new user ${user.email}`);
    const adminEmailSent = await emailService.sendAdminNotificationEmail(user.email, user.name, user.application_message);
    if (!adminEmailSent) {
      console.error(`Failed to send admin notification email for user: ${user.email}`);
    }
    res.redirect('/admin/register?verified=1');
  } catch (error) {
    console.error('Email verification error:', error);
    fail();
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
      'SELECT id, email, name, password_hash, status, role, login_attempts, locked_until, email_verified_at FROM users WHERE email = $1',
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
      if (user.status === 'pending' && !user.email_verified_at) {
        message = 'Please confirm your email address first — check your inbox for the confirmation link';
      } else if (user.status === 'pending') {
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

// Check authentication status (no authentication required). Includes the
// role so the public search page can show admin-only filters.
router.get('/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.json({ authenticated: false });
  try {
    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1 AND status = 'approved'`,
      [userId]
    );
    if (!result.rows.length) return res.json({ authenticated: false });
    res.json({ authenticated: true, role: result.rows[0].role });
  } catch {
    res.json({ authenticated: !!userId });
  }
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
  // Per-entity write levels ('write' | 'full'; absent = read-only).
  let entityPermissions = {};

  if (req.user.role === 'admin') {
    CATALOGUE_ENTITIES.forEach((entity) => { entityPermissions[entity] = 'full'; });
  } else {
    await ensureUserPermissions(req.user.id);
    const permResult = await pool.query(
      'SELECT catalogue, booklet_creator, import_source, commissions FROM user_permissions WHERE user_id = $1',
      [req.user.id]
    );
    if (permResult.rows.length) {
      permissions = permResult.rows[0];
    }
    const entityResult = await pool.query(
      'SELECT entity, level FROM user_entity_permissions WHERE user_id = $1',
      [req.user.id]
    );
    entityResult.rows.forEach((row) => { entityPermissions[row.entity] = row.level; });
  }

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      status: req.user.status,
      last_login: req.user.last_login,
      permissions,
      entity_permissions: entityPermissions
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
