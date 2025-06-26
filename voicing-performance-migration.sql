-- Migration to add performance optimization for voicing filters
-- This creates an indexed column to avoid expensive JSONB operations

-- Step 1: Add columns for both clef combination types
ALTER TABLE inclusions 
ADD COLUMN IF NOT EXISTS sorted_clef_combination_required TEXT,
ADD COLUMN IF NOT EXISTS sorted_clef_combination_all TEXT;

-- Step 2: Create functions to compute sorted clef combinations from JSONB clefs
CREATE OR REPLACE FUNCTION compute_sorted_clef_combination_required(clefs_jsonb JSONB)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    -- Return NULL if no clefs
    IF clefs_jsonb IS NULL OR jsonb_array_length(clefs_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    -- Extract NON-OPTIONAL clefs only, sort them, and concatenate
    SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
        CASE clef_obj->>'clef'
            WHEN 'g1' THEN 0 WHEN 'g2' THEN 1 WHEN 'g3' THEN 2 WHEN 'c1' THEN 3
            WHEN 'g4' THEN 4 WHEN 'c2' THEN 5 WHEN 'g5' THEN 6 WHEN 'c3' THEN 7
            WHEN 'f1' THEN 8 WHEN 'g28' THEN 9 WHEN 'c4' THEN 10 WHEN 'f2' THEN 11
            WHEN 'c5' THEN 12 WHEN 'd1' THEN 13 WHEN 'f3' THEN 14 WHEN 'd2' THEN 15
            WHEN 'f4' THEN 16 WHEN 'd3' THEN 17 WHEN 'y1' THEN 18 WHEN 'f5' THEN 19
            WHEN 'd4' THEN 20 WHEN 'y2' THEN 21 WHEN 'd5' THEN 22 WHEN 'y3' THEN 23
            WHEN 'y4' THEN 24 WHEN 'y5' THEN 25 WHEN 'x1' THEN 26 WHEN 'x2' THEN 27
            WHEN 'x3' THEN 28 WHEN 'x4' THEN 29 WHEN 'x5' THEN 30 WHEN 'org' THEN 31
            WHEN 'bc' THEN 32 WHEN 'lut' THEN 33
            ELSE 999
        END
    )
    INTO result
    FROM jsonb_array_elements(clefs_jsonb) AS clef_obj
    WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
    AND clef_obj->>'clef' IS NOT NULL
    AND clef_obj->>'clef' != '';
    
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION compute_sorted_clef_combination_all(clefs_jsonb JSONB)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    -- Return NULL if no clefs
    IF clefs_jsonb IS NULL OR jsonb_array_length(clefs_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    -- Extract ALL clefs (required AND optional), sort them, and concatenate
    SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
        CASE clef_obj->>'clef'
            WHEN 'g1' THEN 0 WHEN 'g2' THEN 1 WHEN 'g3' THEN 2 WHEN 'c1' THEN 3
            WHEN 'g4' THEN 4 WHEN 'c2' THEN 5 WHEN 'g5' THEN 6 WHEN 'c3' THEN 7
            WHEN 'f1' THEN 8 WHEN 'g28' THEN 9 WHEN 'c4' THEN 10 WHEN 'f2' THEN 11
            WHEN 'c5' THEN 12 WHEN 'd1' THEN 13 WHEN 'f3' THEN 14 WHEN 'd2' THEN 15
            WHEN 'f4' THEN 16 WHEN 'd3' THEN 17 WHEN 'y1' THEN 18 WHEN 'f5' THEN 19
            WHEN 'd4' THEN 20 WHEN 'y2' THEN 21 WHEN 'd5' THEN 22 WHEN 'y3' THEN 23
            WHEN 'y4' THEN 24 WHEN 'y5' THEN 25 WHEN 'x1' THEN 26 WHEN 'x2' THEN 27
            WHEN 'x3' THEN 28 WHEN 'x4' THEN 29 WHEN 'x5' THEN 30 WHEN 'org' THEN 31
            WHEN 'bc' THEN 32 WHEN 'lut' THEN 33
            ELSE 999
        END
    )
    INTO result
    FROM jsonb_array_elements(clefs_jsonb) AS clef_obj
    WHERE clef_obj->>'clef' IS NOT NULL
    AND clef_obj->>'clef' != '';
    
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Populate both columns for existing data
UPDATE inclusions 
SET 
    sorted_clef_combination_required = compute_sorted_clef_combination_required(clefs),
    sorted_clef_combination_all = compute_sorted_clef_combination_all(clefs)
WHERE clefs IS NOT NULL;

-- Step 4: Create indexes on both new columns
CREATE INDEX IF NOT EXISTS idx_inclusions_sorted_clef_combination_required 
ON inclusions (sorted_clef_combination_required) 
WHERE sorted_clef_combination_required IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inclusions_sorted_clef_combination_all 
ON inclusions (sorted_clef_combination_all) 
WHERE sorted_clef_combination_all IS NOT NULL;

-- Step 5: Create trigger to keep both columns updated
CREATE OR REPLACE FUNCTION update_sorted_clef_combinations()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sorted_clef_combination_required := compute_sorted_clef_combination_required(NEW.clefs);
    NEW.sorted_clef_combination_all := compute_sorted_clef_combination_all(NEW.clefs);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_sorted_clef_combinations ON inclusions;
CREATE TRIGGER trg_update_sorted_clef_combinations
    BEFORE INSERT OR UPDATE OF clefs ON inclusions
    FOR EACH ROW 
    EXECUTE FUNCTION update_sorted_clef_combinations();

-- Step 6: Add index on group_id for faster joins (if not already exists)
CREATE INDEX IF NOT EXISTS idx_inclusions_composition_group 
ON inclusions (composition_id);

CREATE INDEX IF NOT EXISTS idx_compositions_group_id
ON compositions (group_id);

-- Step 7: Create specialized view for voicing searches (optional optimization)
CREATE OR REPLACE VIEW voicing_search_index AS
SELECT 
    g.id as group_id,
    g.display_title,
    g.functions_list,
    array_agg(DISTINCT i.sorted_clef_combination_required) FILTER (WHERE i.sorted_clef_combination_required IS NOT NULL) as clef_combinations_required,
    array_agg(DISTINCT i.sorted_clef_combination_all) FILTER (WHERE i.sorted_clef_combination_all IS NOT NULL) as clef_combinations_all
FROM groups g
LEFT JOIN compositions c ON g.id = c.group_id
LEFT JOIN inclusions i ON c.id = i.composition_id
GROUP BY g.id, g.display_title, g.functions_list;

COMMENT ON TABLE inclusions IS 'Inclusions table with optimized sorted clef combination columns for fast voicing searches';
COMMENT ON COLUMN inclusions.sorted_clef_combination_required IS 'Computed column containing sorted non-optional clefs only';
COMMENT ON COLUMN inclusions.sorted_clef_combination_all IS 'Computed column containing sorted clefs including optional ones'; 