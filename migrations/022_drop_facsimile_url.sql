-- Facsimile links live in the existing source_images table (url + label per
-- source) — the facsimile_url column added by 021 duplicated that and is
-- dropped before anything uses it. source_rism accepts now insert into
-- source_images instead.

ALTER TABLE sources DROP COLUMN IF EXISTS facsimile_url;
