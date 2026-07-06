import express from 'express';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import emailService from '../services/emailService.js';

// Admin commission management, mounted at /api/admin/commissions behind
// requireAuthWeb; guards itself with requireAdmin.
const router = express.Router();

router.use(requireAdmin);

// List commissions (optionally by status)
router.get('/', async (req, res) => {
  try {
    const status = ['enquiry', 'offered', 'paid', 'declined', 'cancelled'].includes(req.query.status)
      ? req.query.status
      : null;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE c.status = $1';
    }
    const result = await pool.query(`
      SELECT c.*, g.display_title AS group_title
      FROM commissions c
      LEFT JOIN groups g ON g.id = c.group_id
      ${where}
      ORDER BY c.created_at DESC
    `, params);
    res.json({ commissions: result.rows });
  } catch (error) {
    console.error('List commissions error:', error);
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

// Cancel a commission.
router.post('/:id/cancel', async (req, res) => {
  try {
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
