-- Composer biography matcher support (review-queue kind 'composer_bio'):
-- suggestions can now reference a composer, composers get a checkpoint so
-- runs advance through the list, and a permanent Wikidata link is set when
-- a bio suggestion is accepted (mirrors titles.cantus_id).

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS composer_id INTEGER REFERENCES composers(id) ON DELETE CASCADE;
ALTER TABLE composers ADD COLUMN IF NOT EXISTS wikidata_checked_at TIMESTAMPTZ;
ALTER TABLE composers ADD COLUMN IF NOT EXISTS wikidata_id TEXT;
