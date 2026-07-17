-- RISM source-enrichment suggestions (kind 'source_rism'):
-- suggestions can now reference a source; sources gain a digital-facsimile
-- URL (proposed from RISM's digitization links) and a matcher checkpoint.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS source_id integer REFERENCES sources(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_suggestions_source_id ON suggestions (source_id);

ALTER TABLE sources ADD COLUMN IF NOT EXISTS facsimile_url text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS rism_checked_at timestamp;
