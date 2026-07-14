-- Progress tracking for the recording matcher: groups are marked when
-- searched (matched or not), so daily runs advance through the catalogue.
-- Previously the script always took the lowest group ids with no recording
-- and no suggestion row, so once those failed to match it re-searched the
-- same block every day and inserts dropped to zero.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS recordings_checked_at TIMESTAMPTZ;

-- Backfill: groups that already have a recording suggestion were searched.
UPDATE groups SET recordings_checked_at = NOW()
WHERE recordings_checked_at IS NULL
  AND id IN (
    SELECT group_id FROM suggestions
    WHERE kind IN ('recording_youtube', 'recording_spotify') AND group_id IS NOT NULL
  );
