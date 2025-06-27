-- Bulk Inclusions Import SQL Script
-- This script creates the temp_inclusions table and populates it with sample data
-- that can then be processed by the existing save-with-inclusions system

-- =============================================
-- STEP 1: Create the temp_inclusions table if it doesn't exist
-- =============================================

CREATE TABLE IF NOT EXISTS temp_inclusions (
    id SERIAL PRIMARY KEY,
    source_id INTEGER,
    position INTEGER,
    composition_name TEXT,
    composition_type TEXT,
    composers TEXT,
    clefs TEXT,
    composition_id INTEGER,
    processed BOOLEAN DEFAULT FALSE,
    -- Enhanced fields for proper matching
    original_composition_id INTEGER,
    tone TEXT,
    even_odd INTEGER,
    composition_type_id INTEGER,
    number_of_voices INTEGER,
    composer_ids_json TEXT
);

-- =============================================
-- STEP 2: Clear any existing temp data (optional)
-- =============================================

-- Uncomment the next line if you want to clear existing temp data
-- DELETE FROM temp_inclusions;

-- =============================================
-- STEP 3: Insert your inclusion data here
-- Replace the source_id (1) with your actual source ID
-- =============================================

-- Example insertions - customize these for your data:

-- IMPORTANT: Change source_id to match your target source
\set source_id 1

INSERT INTO temp_inclusions (
    source_id, position, composition_name, composition_type, composers, 
    clefs, tone, even_odd, composition_type_id, number_of_voices, composer_ids_json
) VALUES 
-- Row 1: Ave Maria by Josquin
(:source_id, 1, 'Ave Maria', 'Mass', 'Josquin des Prez', 
 '[{"clef":"c2"},{"clef":"c3"},{"clef":"f3"}]', '1', 1, 
 (SELECT id FROM composition_types WHERE name = 'Mass' LIMIT 1), 3, 
 '[]'),

-- Row 2: Kyrie by Palestrina
(:source_id, 2, 'Kyrie', 'Mass', 'Palestrina, Giovanni Pierluigi da', 
 '[{"clef":"c1"},{"clef":"c3"},{"clef":"c4"},{"clef":"f4"}]', '2', 0, 
 (SELECT id FROM composition_types WHERE name = 'Mass' LIMIT 1), 4, 
 '[]'),

-- Row 3: Anonymous Sanctus
(:source_id, 3, 'Sanctus', 'Mass', 'Anonymous', 
 '[{"clef":"c2"},{"clef":"c3"},{"clef":"c4"},{"clef":"f3"}]', '8', 1, 
 (SELECT id FROM composition_types WHERE name = 'Mass' LIMIT 1), 4, 
 '[]'),

-- Row 4: Example with optional and missing clefs
(:source_id, 4, 'Gloria', 'Mass', 'Anonymous', 
 '[{"clef":"c1"},{"clef":"c2","optional":true},{"clef":"c3"},{"clef":"f3","missing":true}]', '1', 1, 
 (SELECT id FROM composition_types WHERE name = 'Mass' LIMIT 1), 3, 
 '[]'),

-- Row 5: Example with incomplete and transitional clefs
(:source_id, 5, 'Credo', 'Mass', 'Anonymous', 
 '[{"clef":"c1"},{"clef":"c2","incomplete":true},{"clef":"c3","transitions_to":["c4"]},{"clef":"f3"}]', '2', 0, 
 (SELECT id FROM composition_types WHERE name = 'Mass' LIMIT 1), 4, 
 '[]');

-- =============================================
-- STEP 4: Template for adding more rows
-- =============================================

/*

Use this template to add more inclusions:

INSERT INTO temp_inclusions (
    source_id, position, composition_name, composition_type, composers, 
    clefs, tone, even_odd, composition_type_id, number_of_voices, composer_ids_json
) VALUES 
(:source_id, [ORDER_NUMBER], '[TITLE]', '[TYPE]', '[COMPOSER_NAMES]', 
 '[CLEFS_JSON]', '[TONE]', [EVEN_ODD], 
 (SELECT id FROM composition_types WHERE name = '[TYPE]' LIMIT 1), [VOICE_COUNT], 
 '[]');

Field explanations:
- source_id: The ID of the source you're adding inclusions to
- position: Order number (1, 2, 3, etc.)
- composition_name: Title of the piece
- composition_type: Type like 'Mass', 'Hymn', 'Responsory', etc.
- composers: Composer name(s), comma-separated
- clefs: JSON array of clef objects, e.g. '[{"clef":"c2"},{"clef":"c3"},{"clef":"f3"}]'
- tone: Tone number as text ('1', '2', '8', 'mix', etc.) or NULL
- even_odd: 1 for even, 0 for odd, NULL for neither
- number_of_voices: Count of clefs (auto-calculated from clefs array)
- composer_ids_json: Leave as '[]' - system will resolve composer names

Common clef values: c1, c2, c3, c4, c5, f3, f4, f5, g1, g2

CLEF SPECIAL PROPERTIES:
- optional: {"clef":"c2","optional":true} - Optional clef (not counted in voices)
- missing: {"clef":"c2","missing":true} - Missing from source but expected
- incomplete: {"clef":"c2","incomplete":true} - Incomplete notation in source
- transitions_to: {"clef":"c2","transitions_to":["c3","c4"]} - Clef changes during piece

Examples:
- Basic: [{"clef":"c1"},{"clef":"c2"},{"clef":"f3"}]
- With optional: [{"clef":"c1"},{"clef":"c2","optional":true},{"clef":"f3"}] 
- With missing: [{"clef":"c1"},{"clef":"c2","missing":true},{"clef":"f3"}]
- With transitions: [{"clef":"c1"},{"clef":"c2","transitions_to":["c3"]},{"clef":"f3"}]
- Combined: [{"clef":"c1"},{"clef":"c2","optional":true,"missing":true},{"clef":"f3"}]

*/

-- =============================================
-- STEP 5: Verify your data (optional)
-- =============================================

-- View what you've inserted:
SELECT id, source_id, position, composition_name, composition_type, 
       composers, tone, even_odd, number_of_voices, processed
FROM temp_inclusions 
WHERE source_id = :source_id
ORDER BY position;

-- =============================================
-- STEP 6: Process the data
-- =============================================

/*

After running this script:

1. Go to your source editor in the web interface
2. Navigate to the source with ID matching your source_id
3. Click "Save All Changes" - the system will automatically detect and process any staged temp_inclusions
4. Your staged inclusions will be converted to final inclusions automatically!

The save-with-inclusions endpoint now automatically:
- Processes any unprocessed temp_inclusions for the source
- Converts them to proper compositions and inclusions
- Handles the normal form data as usual
- All in one seamless transaction

No manual processing step required!

*/

-- =============================================
-- Additional Helper Queries
-- =============================================

-- Show available composition types:
-- SELECT id, name FROM composition_types ORDER BY name;

-- Show available composers:
-- SELECT id, name FROM composers ORDER BY name;

-- Clear temp data for a specific source:
-- DELETE FROM temp_inclusions WHERE source_id = :source_id;

-- Show processing status:
-- SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE processed = true) as processed
-- FROM temp_inclusions WHERE source_id = :source_id; 