-- Migration to add performance optimization for voicing filters
-- This creates an indexed column to avoid expensive JSONB operations

-- Step 1: Add the sorted_clef_combination column
ALTER TABLE inclusions 
ADD COLUMN IF NOT EXISTS sorted_clef_combination TEXT;

-- Step 2: Create function to compute sorted clef combination from JSONB clefs
CREATE OR REPLACE FUNCTION compute_sorted_clef_combination(clefs_jsonb JSONB)
RETURNS TEXT AS $$
DECLARE
    clef_order TEXT[] := ARRAY[
        'g1', 'g2', 'g3', 'c1', 'g4', 'c2', 'g5', 'c3', 'f1', 'g28', 
        'c4', 'f2', 'c5', 'd1', 'f3', 'd2', 'f4', 'd3', 'y1', 'f5', 
        'd4', 'y2', 'd5', 'y3', 'y4', 'y5', 'x1', 'x2', 'x3', 'x4', 
        'x5', 'org', 'bc', 'lut'
    ];
    result TEXT;
BEGIN
    -- Return NULL if no clefs
    IF clefs_jsonb IS NULL OR jsonb_array_length(clefs_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    -- Extract non-optional clefs, sort them, and concatenate
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

-- Step 3: Populate the column for existing data
UPDATE inclusions 
SET sorted_clef_combination = compute_sorted_clef_combination(clefs)
WHERE clefs IS NOT NULL;

-- Step 4: Create index on the new column
CREATE INDEX IF NOT EXISTS idx_inclusions_sorted_clef_combination 
ON inclusions (sorted_clef_combination) 
WHERE sorted_clef_combination IS NOT NULL;

-- Step 5: Create trigger to keep the column updated
CREATE OR REPLACE FUNCTION update_sorted_clef_combination()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sorted_clef_combination := compute_sorted_clef_combination(NEW.clefs);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_sorted_clef_combination ON inclusions;
CREATE TRIGGER trg_update_sorted_clef_combination
    BEFORE INSERT OR UPDATE OF clefs ON inclusions
    FOR EACH ROW 
    EXECUTE FUNCTION update_sorted_clef_combination();

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
    array_agg(DISTINCT i.sorted_clef_combination) FILTER (WHERE i.sorted_clef_combination IS NOT NULL) as clef_combinations
FROM groups g
LEFT JOIN compositions c ON g.id = c.group_id
LEFT JOIN inclusions i ON c.id = i.composition_id
GROUP BY g.id, g.display_title, g.functions_list;

COMMENT ON TABLE inclusions IS 'Inclusions table with optimized sorted_clef_combination column for fast voicing searches';
COMMENT ON COLUMN inclusions.sorted_clef_combination IS 'Computed column containing sorted non-optional clefs for fast voicing filter matching'; 