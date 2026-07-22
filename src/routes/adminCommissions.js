import express from 'express';
import { pool } from '../db.js';
import emailService from '../services/emailService.js';

// Commission management, mounted at /api/admin/commissions behind
// requireAuthWeb + requirePermission('commissions') (admins bypass the
// permission). Editing actions are additionally locked to whoever has
// claimed the commission.
const router = express.Router();

// Load a commission and check the current user may edit it. A commission
// that is claimed by someone else is locked; admins can always edit.
async function loadEditable(req, res) {
  const id = parseInt(req.params.id, 10) || 0;
  const result = await pool.query('SELECT * FROM commissions WHERE id = $1', [id]);
  if (!result.rows.length) {
    res.status(404).json({ error: 'Commission not found' });
    return null;
  }
  const c = result.rows[0];
  if (c.claimed_by && c.claimed_by !== req.user.id && req.user.role !== 'admin') {
    res.status(423).json({ error: 'This commission is claimed by another user' });
    return null;
  }
  return c;
}

// List commissions (optionally by status), with the claimer's name.
router.get('/', async (req, res) => {
  try {
    const status = ['enquiry', 'offered', 'paid', 'fulfilled', 'declined', 'cancelled'].includes(req.query.status)
      ? req.query.status
      : null;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE c.status = $1';
    }
    const result = await pool.query(`
      SELECT c.*, g.display_title AS group_title,
             u.name AS claimed_by_name, u.email AS claimed_by_email
      FROM commissions c
      LEFT JOIN groups g ON g.id = c.group_id
      LEFT JOIN users u ON u.id = c.claimed_by
      ${where}
      ORDER BY c.created_at DESC
    `, params);
    res.json({ commissions: result.rows, currentUserId: req.user.id });
  } catch (error) {
    console.error('List commissions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Claim a commission (take ownership so others can't edit it).
router.post('/:id/claim', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const result = await pool.query(
      `UPDATE commissions SET claimed_by = $1, claimed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND claimed_by IS NULL
       RETURNING id`,
      [req.user.id, id]
    );
    if (!result.rows.length) {
      return res.status(423).json({ error: 'Already claimed by someone else' });
    }
    res.json({ message: 'Commission claimed' });
  } catch (error) {
    console.error('Commission claim error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Release a commission back into the open list (claimer or admin only).
router.post('/:id/release', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const whereOwner = req.user.role === 'admin' ? '' : 'AND claimed_by = $2';
    const params = req.user.role === 'admin' ? [id] : [id, req.user.id];
    const result = await pool.query(
      `UPDATE commissions SET claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
       WHERE id = $1 ${whereOwner} RETURNING id`,
      params
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: 'You can only release a commission you have claimed' });
    }
    res.json({ message: 'Commission released' });
  } catch (error) {
    console.error('Commission release error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Make (or revise) an offer: set price + note, email the commissioner.
router.post('/:id/offer', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pricePence = Math.round(Number(req.body.price_pence));
    const adminNote = String(req.body.admin_note || '').trim().slice(0, 4000);

    if (!Number.isInteger(pricePence) || pricePence < 1) {
      return res.status(400).json({ error: 'A valid price (in pence) is required' });
    }

    if (!(await loadEditable(req, res))) return;

    const result = await pool.query(
      `UPDATE commissions
         SET status = 'offered', price_pence = $1, admin_note = $2,
             offered_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status IN ('enquiry', 'offered')
       RETURNING *`,
      [pricePence, adminNote, id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Commission not found or cannot be offered' });
    }

    const sent = await emailService.sendCommissionOffer(result.rows[0]);
    res.json({
      message: sent ? 'Offer sent to the commissioner' : 'Offer saved, but the email failed to send',
      commission: result.rows[0],
    });
  } catch (error) {
    console.error('Commission offer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manually mark a commission as paid — for payments taken outside Stripe
// (bank transfer, cash, etc). Only an offered commission with a price can
// be marked paid; the optional note records how it was paid.
router.post('/:id/mark-paid', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const note = String(req.body.payment_note || '').trim().slice(0, 500);

    if (!(await loadEditable(req, res))) return;

    const result = await pool.query(
      `UPDATE commissions
         SET status = 'paid', paid_at = NOW(), payment_note = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'offered' AND price_pence IS NOT NULL
       RETURNING *`,
      [note || 'Marked paid manually', id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Only an offered commission with a price can be marked as paid' });
    }
    res.json({ message: 'Marked as paid', commission: result.rows[0] });
  } catch (error) {
    console.error('Commission mark-paid error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark a paid commission as delivered; emails the commissioner (optionally
// with a link to the finished edition).
router.post('/:id/fulfil', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    let editionUrl = String(req.body.edition_url || '').trim().slice(0, 1000);
    if (editionUrl && !/^https?:\/\//i.test(editionUrl)) {
      return res.status(400).json({ error: 'Edition URL must be an http(s) link' });
    }

    if (!(await loadEditable(req, res))) return;

    const result = await pool.query(
      `UPDATE commissions
         SET status = 'fulfilled', edition_url = $1, fulfilled_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'paid'
       RETURNING *`,
      [editionUrl || null, id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Commission not found or not in a paid state' });
    }

    const sent = await emailService.sendCommissionReadyEmail(result.rows[0]);
    res.json({
      message: sent ? 'Marked as ready and the commissioner has been notified' : 'Marked as ready, but the email failed to send',
      commission: result.rows[0],
    });
  } catch (error) {
    console.error('Commission fulfil error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel a commission.
router.post('/:id/cancel', async (req, res) => {
  try {
    if (!(await loadEditable(req, res))) return;

    const result = await pool.query(
      `UPDATE commissions SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status != 'paid' RETURNING id`,
      [parseInt(req.params.id, 10) || 0]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Commission cannot be cancelled' });
    res.json({ message: 'Commission cancelled' });
  } catch (error) {
    console.error('Commission cancel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
