-- Manual (non-Stripe) payments: record how a commission was paid when an
-- admin marks it paid by hand, e.g. "BACS 22 Jul 2026". Stripe-webhook
-- payments leave this NULL.

ALTER TABLE commissions ADD COLUMN IF NOT EXISTS payment_note TEXT;
