-- Test query to demonstrate how optional clefs will work
-- This shows what data will look like after the migration

-- Example: An inclusion with clefs c1,(c1),c2,c3,c4 (where (c1) is optional)
-- would have this JSONB structure:
/*
[
  {"clef": "c1", "optional": false},
  {"clef": "c1", "optional": true}, 
  {"clef": "c2", "optional": false},
  {"clef": "c3", "optional": false},
  {"clef": "c4", "optional": false}
]
*/

-- After migration, the computed columns would be:
-- sorted_clef_combination_required: "c1c2c3c4" (excludes optional c1)
-- sorted_clef_combination_all: "c1c1c2c3c4" (includes optional c1)

-- This means the inclusion would match searches for BOTH:
-- 1. Voicings mapped to clef combination "c1c2c3c4" 
-- 2. Voicings mapped to clef combination "c1c1c2c3c4"

-- Test the functions (run after migration):
SELECT 
    'Example clefs with optional' as description,
    compute_sorted_clef_combination_required('[
        {"clef": "c1", "optional": false},
        {"clef": "c1", "optional": true}, 
        {"clef": "c2", "optional": false},
        {"clef": "c3", "optional": false},
        {"clef": "c4", "optional": false}
    ]'::jsonb) as required_only,
    compute_sorted_clef_combination_all('[
        {"clef": "c1", "optional": false},
        {"clef": "c1", "optional": true}, 
        {"clef": "c2", "optional": false},
        {"clef": "c3", "optional": false},
        {"clef": "c4", "optional": false}
    ]'::jsonb) as all_clefs;

-- Expected result:
-- required_only: "c1c2c3c4"
-- all_clefs: "c1c1c2c3c4" 