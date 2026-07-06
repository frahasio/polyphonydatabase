import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import { pool } from '../db.js';
import emailService from '../services/emailService.js';

// Public + commissioner-facing commission endpoints (no login). Mounted at
// /api/commissions. The Stripe webhook is mounted separately in index.js
// because it needs the raw request body.
const router = express.Router();

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many enquiries, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

function publicView(c) {
  return {
    status: c.status,
    commissioner_name: c.commissioner_name,
    piece_description: c.piece_description,
    requirements: c.requirements,
    price_pence: c.price_pence,
    currency: c.currency,
    admin_note: c.admin_note,
  };
}

// Submit a commission enquiry (no price yet).
router.post('/enquiry', enquiryLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 200);
    const email = String(req.body.email || '').trim().slice(0, 200);
    const piece = String(req.body.piece_description || '').trim().slice(0, 2000);
    const requirements = String(req.body.requirements || '').trim().slice(0, 4000);
    let groupId = parseInt(req.body.group_id, 10);
    if (!Number.isInteger(groupId)) groupId = null;

    if (!name || !email || !piece) {
      return res.status(400).json({ error: 'Name, email and a description of the piece are required' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    const accessToken = crypto.randomBytes(24).toString('hex');
    const result = await pool.query(
      `INSERT INTO commissions
         (status, commissioner_name, commissioner_email, piece_description, requirements, group_id, access_token)
       VALUES ('enquiry', $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, email.toLowerCase(), piece, requirements, groupId, accessToken]
    );

    emailService.sendCommissionEnquiryAdmin(result.rows[0]).catch((e) =>
      console.error('Commission enquiry admin email failed:', e.message)
    );

    res.status(201).json({ message: 'Thank you — your enquiry has been received. We will email you with a price.' });
  } catch (error) {
    console.error('Commission enquiry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Commissioner views their commission via the signed link token.
router.get('/view/:token', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM commissions WHERE access_token = $1', [req.params.token]);
    if (!result.rows.length) return res.status(404).json({ error: 'Commission not found' });
    res.json({ commission: publicView(result.rows[0]) });
  } catch (error) {
    console.error('Commission view error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Commissioner declines an offer.
router.post('/view/:token/decline', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE commissions SET status = 'declined', updated_at = NOW()
       WHERE access_token = $1 AND status = 'offered' RETURNING id`,
      [req.params.token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'This commission cannot be declined' });
    res.json({ message: 'Commission declined' });
  } catch (error) {
    console.error('Commission decline error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Commissioner starts payment: create a Stripe Checkout session.
router.post('/view/:token/checkout', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM commissions WHERE access_token = $1', [req.params.token]);
    if (!result.rows.length) return res.status(404).json({ error: 'Commission not found' });
    const c = result.rows[0];
    if (c.status !== 'offered' || !c.price_pence) {
      return res.status(400).json({ error: 'This commission is not ready for payment' });
    }

    const stripe = await getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payment is not configured on this server' });

    const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: c.commissioner_email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (c.currency || 'GBP').toLowerCase(),
          unit_amount: c.price_pence,
          product_data: {
            name: 'Edition commission',
            description: c.piece_description.slice(0, 300),
          },
        },
      }],
      metadata: { commission_id: String(c.id), access_token: c.access_token },
      success_url: `${base}/commission/${c.access_token}?paid=1`,
      cancel_url: `${base}/commission/${c.access_token}`,
    });

    await pool.query('UPDATE commissions SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2', [session.id, c.id]);
    res.json({ url: session.url });
  } catch (error) {
    console.error('Commission checkout error:', error);
    res.status(500).json({ error: 'Could not start payment' });
  }
});

// Lazily load Stripe so the app runs without the dependency/key in dev.
let _stripe;
export async function getStripe() {
  if (_stripe !== undefined) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) {
    _stripe = null;
    return _stripe;
  }
  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.error('Stripe module load failed:', e.message);
    _stripe = null;
  }
  return _stripe;
}

// Mark a commission paid (called from the Stripe webhook after signature
// verification). Idempotent: a repeated event is a no-op.
export async function markCommissionPaid(session) {
  const commissionId = parseInt(session.metadata && session.metadata.commission_id, 10);
  if (!Number.isInteger(commissionId)) return;
  const result = await pool.query(
    `UPDATE commissions SET status = 'paid', paid_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status != 'paid' RETURNING *`,
    [commissionId]
  );
  if (result.rows.length) {
    emailService.sendCommissionPaidAdmin(result.rows[0]).catch((e) =>
      console.error('Commission paid admin email failed:', e.message)
    );
  }
}

export default router;
