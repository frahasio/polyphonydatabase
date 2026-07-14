-- Composer bio matcher v2 identifies people on RISM (the musicological
-- authority file) instead of fuzzy Wikidata name search; accepted
-- suggestions record the permanent RISM person id.

ALTER TABLE composers ADD COLUMN IF NOT EXISTS rism_id TEXT;
