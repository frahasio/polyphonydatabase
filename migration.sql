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
COMMENT ON COLUMN inclusions.position IS 'Folio numbers or other position indicators'; 