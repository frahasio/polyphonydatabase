-- First, add the new JSONB columns to inclusions table
ALTER TABLE inclusions 
ADD COLUMN IF NOT EXISTS clefs JSONB,
ADD COLUMN IF NOT EXISTS attribution_texts JSONB,
ADD COLUMN IF NOT EXISTS composer_ids JSONB;

-- Migrate the data using CTEs
WITH clef_data AS (
  SELECT 
    i.id as inclusion_id,
    jsonb_agg(
      jsonb_build_object(
        'clef', ci.clef,
        'optional', COALESCE(ci.optional, false),
        'missing', COALESCE(ci.missing, false),
        'incomplete', COALESCE(ci.incomplete, false),
        'transitions_to', COALESCE(ci.transitions_to, ARRAY[]::character varying[])
      ) ORDER BY ci.id
    ) as clefs
  FROM inclusions i
  LEFT JOIN clef_inclusions ci ON ci.inclusion_id = i.id
  GROUP BY i.id
),
attribution_data AS (
  SELECT 
    i.id as inclusion_id,
    jsonb_agg(DISTINCT a.text) as attribution_texts,
    jsonb_agg(DISTINCT a.refers_to_id) as composer_ids
  FROM inclusions i
  LEFT JOIN attributions a ON a.inclusion_id = i.id
  GROUP BY i.id
)
UPDATE inclusions
SET 
  clefs = cd.clefs,
  attribution_texts = ad.attribution_texts,
  composer_ids = ad.composer_ids
FROM clef_data cd
LEFT JOIN attribution_data ad ON ad.inclusion_id = cd.inclusion_id
WHERE inclusions.id = cd.inclusion_id;

-- Create indexes for the new JSONB columns
CREATE INDEX IF NOT EXISTS idx_inclusions_clefs ON inclusions USING gin (clefs);
CREATE INDEX IF NOT EXISTS idx_inclusions_attribution_texts ON inclusions USING gin (attribution_texts);
CREATE INDEX IF NOT EXISTS idx_inclusions_composer_ids ON inclusions USING gin (composer_ids);

-- Drop old columns from inclusions table
ALTER TABLE inclusions
DROP COLUMN IF EXISTS missing_clef_ids,
DROP COLUMN IF EXISTS incomplete_clef_ids,
DROP COLUMN IF EXISTS transitions_to,
DROP COLUMN IF EXISTS both_clef_ids,
DROP COLUMN IF EXISTS clef_combination_id;

-- Change position field type to varchar
ALTER TABLE inclusions 
ALTER COLUMN position TYPE varchar;

-- Add comment to explain the field
COMMENT ON COLUMN inclusions.position IS 'Position in the source, can be a number or a more complex identifier';

-- Add new columns to attributions table
ALTER TABLE attributions
ADD COLUMN IF NOT EXISTS refers_to_id integer,
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Update clef_combinations table
ALTER TABLE clef_combinations
ALTER COLUMN clef_ids SET DEFAULT '{}'::integer[],
ADD COLUMN IF NOT EXISTS sorting varchar;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS index_inclusions_on_clefs ON inclusions USING gin (clefs);
CREATE INDEX IF NOT EXISTS index_inclusions_on_attribution_texts ON inclusions USING gin (attribution_texts);
CREATE INDEX IF NOT EXISTS index_inclusions_on_composer_ids ON inclusions USING gin (composer_ids);
CREATE INDEX IF NOT EXISTS index_attributions_on_search_vector ON attributions USING gin (search_vector);
CREATE INDEX IF NOT EXISTS index_attributions_on_refers_to_id ON attributions (refers_to_id);

-- Migrate data from old columns to new JSONB columns
WITH clef_data AS (
  SELECT 
    i.id,
    jsonb_agg(
      jsonb_build_object(
        'clef', ci.clef,
        'missing', i.missing_clef_ids @> ARRAY[ci.id],
        'incomplete', i.incomplete_clef_ids @> ARRAY[ci.id]
      )
    ) as clefs_json
  FROM inclusions i
  LEFT JOIN clef_inclusions ci ON ci.inclusion_id = i.id
  GROUP BY i.id
)
UPDATE inclusions i
SET clefs = cd.clefs_json
FROM clef_data cd
WHERE i.id = cd.id;

-- Migrate attribution texts
WITH attribution_data AS (
  SELECT 
    i.id,
    jsonb_agg(a.text) as texts_json
  FROM inclusions i
  LEFT JOIN attributions a ON a.inclusion_id = i.id
  GROUP BY i.id
)
UPDATE inclusions i
SET attribution_texts = ad.texts_json
FROM attribution_data ad
WHERE i.id = ad.id;

-- Drop old columns after migration
ALTER TABLE inclusions
DROP COLUMN IF EXISTS missing_clef_ids,
DROP COLUMN IF EXISTS incomplete_clef_ids,
DROP COLUMN IF EXISTS clef_combination_id;

-- Add comment to explain position field
COMMENT ON COLUMN inclusions.position IS 'Position in the source, can be a number or a more complex identifier'; 