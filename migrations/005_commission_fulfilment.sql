-- Fulfilment step: mark a paid commission as delivered and record where the
-- finished edition lives (optional link included in the "ready" email).

ALTER TABLE commissions ADD COLUMN IF NOT EXISTS edition_url TEXT;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
