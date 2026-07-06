-- Progress tracking for the Cantus Index matcher: titles are marked when
-- checked (matched or not), so hourly runs advance through the catalogue
-- instead of re-checking the same unmatched block forever.

ALTER TABLE titles ADD COLUMN IF NOT EXISTS cantus_checked_at TIMESTAMPTZ;

-- Backfill: titles that already have a title_function suggestion were checked.
UPDATE titles SET cantus_checked_at = NOW()
WHERE cantus_checked_at IS NULL
  AND id IN (
    SELECT title_id FROM suggestions
    WHERE kind = 'title_function' AND title_id IS NOT NULL
  );
