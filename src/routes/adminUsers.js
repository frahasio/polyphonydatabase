import express from 'express';
import { pool, ensureUserPermissions } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import emailService from '../services/emailService.js';

// Admin user management, mounted at /api/admin (moved here from the old
// /api/auth/admin/* surface so all admin APIs share one router and guard).
const router = express.Router();

// Scoped to /users so sibling /api/admin routes are not double-authenticated.
router.use('/users', requireAdmin);

// List users (optionally filtered by status)
router.get('/users', async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected', 'suspended'].includes(req.query.status)
      ? req.query.status
      : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [limit, offset];

    if (status) {
      whereClause = 'WHERE u.status = $3';
      params.push(status);
    }

    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.status, u.role, u.created_at, u.last_login, u.login_attempts,
             COALESCE(p.catalogue, true) AS perm_catalogue,
             COALESCE(p.booklet_creator, false) AS perm_booklet_creator,
             COALESCE(p.import_source, false) AS perm_import_source,
             COALESCE(p.commissions, false) AS perm_commissions
      FROM users u
      LEFT JOIN user_permissions p ON p.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC 
      LIMIT $1 OFFSET $2
    `, params);

    const countWhereClause = status ? 'WHERE status = $1' : '';
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM users ${countWhereClause}
    `, status ? [status] : []);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    const users = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      role: row.role,
      created_at: row.created_at,
      last_login: row.last_login,
      login_attempts: row.login_attempts,
      permissions: {
        catalogue: row.perm_catalogue,
        booklet_creator: row.perm_booklet_creator,
        import_source: row.perm_import_source,
        commissions: row.perm_commissions
      }
    }));

    res.json({
      users,
      pagination: {
        total,
        page,
        limit,
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

// Update user status (pending/approved/rejected/suspended)
router.put('/users/:id/status', async (req, res) => {
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

    // Get current user details before updating
    const currentUserResult = await pool.query(
      'SELECT email, name, status FROM users WHERE id = $1',
      [id]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const previousStatus = currentUserResult.rows[0].status;

    // Update user status
    const result = await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, name, status',
      [status, id]
    );

    const updatedUser = result.rows[0];

    // Revoke sessions when access is withdrawn.
    if ((status === 'suspended' || status === 'rejected') && previousStatus === 'approved') {
      try {
        await pool.query(
          `DELETE FROM user_sessions WHERE (sess::jsonb ->> 'userId')::int = $1`,
          [id]
        );
      } catch (sessionErr) {
        console.error('Failed to clear sessions after status change:', sessionErr.message);
      }
    }

    // Send email notification if status changed
    if (previousStatus !== status) {
      switch (status) {
        case 'approved': {
          const isReactivation = previousStatus === 'suspended';
          const sent = await emailService.sendAccountApprovedEmail(updatedUser.email, updatedUser.name, isReactivation);
          if (!sent) console.error(`Failed to send account approved email to ${updatedUser.email}`);
          break;
        }
        case 'suspended': {
          const sent = await emailService.sendAccountSuspendedEmail(updatedUser.email, updatedUser.name);
          if (!sent) console.error(`Failed to send account suspended email to ${updatedUser.email}`);
          break;
        }
        case 'rejected': {
          const sent = await emailService.sendAccountRejectedEmail(updatedUser.email, updatedUser.name);
          if (!sent) console.error(`Failed to send account rejected email to ${updatedUser.email}`);
          break;
        }
        default:
          break;
      }
    }

    res.json({
      message: `User status updated to ${status}`,
      user: updatedUser
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role
router.put('/users/:id/role', async (req, res) => {
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
      'UPDATE users SET role = $1, is_admin = $2 WHERE id = $3 RETURNING id, email, name, role',
      [role, role === 'admin', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.id,
          req.user.email,
          'UPDATE',
          'users',
          parseInt(id),
          null,
          JSON.stringify({ role })
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped:', auditError.message);
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

// Update user feature permissions
router.put('/users/:id/permissions', async (req, res) => {
  try {
    const { id } = req.params;
    const { catalogue, booklet_creator, import_source, commissions } = req.body;

    if (typeof catalogue !== 'boolean' || typeof booklet_creator !== 'boolean' ||
        typeof import_source !== 'boolean' || typeof commissions !== 'boolean') {
      return res.status(400).json({ error: 'catalogue, booklet_creator, import_source and commissions must be booleans' });
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await ensureUserPermissions(parseInt(id));

    await pool.query(
      `UPDATE user_permissions
       SET catalogue = $1, booklet_creator = $2, import_source = $3, commissions = $4,
           updated_at = NOW(), updated_by = $5
       WHERE user_id = $6`,
      [catalogue, booklet_creator, import_source, commissions, req.user.id, id]
    );

    res.json({
      message: 'Permissions updated',
      permissions: { catalogue, booklet_creator, import_source, commissions }
    });

  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
