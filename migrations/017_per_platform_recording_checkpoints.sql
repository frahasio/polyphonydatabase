-- Per-platform checkpoints for the recording matcher, so Spotify (no hard
-- API cap) can sweep the catalogue in big batches on its own schedule while
-- YouTube stays within its ~100-searches/day quota. Replaces the combined
-- recordings_checked_at added in 015.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS youtube_checked_at TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS spotify_checked_at TIMESTAMPTZ;

UPDATE groups
SET youtube_checked_at = recordings_checked_at,
    spotify_checked_at = recordings_checked_at
WHERE recordings_checked_at IS NOT NULL;

ALTER TABLE groups DROP COLUMN IF EXISTS recordings_checked_at;
