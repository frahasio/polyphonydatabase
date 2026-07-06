-- Edition commissions: public enquiry → admin sets a price → commissioner
-- pays (Stripe) or declines. No commissioner account; they act via a signed
-- link containing the access token.

CREATE TABLE IF NOT EXISTS commissions (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'enquiry',   -- enquiry | offered | paid | declined | cancelled
  commissioner_name TEXT NOT NULL,
  commissioner_email TEXT NOT NULL,
  piece_description TEXT NOT NULL,          -- what they want set
  requirements TEXT NOT NULL DEFAULT '',    -- notes e.g. "transpose down a tone"
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,  -- optional catalogue link
  price_pence INTEGER,                      -- set by admin when making an offer
  currency TEXT NOT NULL DEFAULT 'GBP',
  admin_note TEXT NOT NULL DEFAULT '',      -- message shown with the offer
  access_token TEXT NOT NULL UNIQUE,        -- unguessable token for the commissioner link
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offered_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions (status, created_at DESC);
