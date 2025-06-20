-- Database Cleanup Script: Remove old clef_inclusions structure
-- Run these commands on your production database

-- 1. First, check what constraints exist
SELECT 
    conname as constraint_name,
    conrelid::regclass as table_name,
    confrelid::regclass as referenced_table,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conname LIKE '%clef%' OR conrelid::regclass::text LIKE '%clef%';

-- 2. Drop foreign key constraints referencing clef_inclusions
-- (The constraint name might vary, but typically looks like this:)
ALTER TABLE clef_inclusions DROP CONSTRAINT IF EXISTS fk_rails_69625a4135;
ALTER TABLE clef_inclusions DROP CONSTRAINT IF EXISTS fk_clef_inclusions_inclusion_id;
ALTER TABLE clef_inclusions DROP CONSTRAINT IF EXISTS fk_clef_inclusions_clef_id;

-- 3. Check for any triggers related to clef_inclusions
SELECT 
    trigger_name,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'clef_inclusions';

-- 4. Drop any triggers (if they exist)
-- DROP TRIGGER IF EXISTS trigger_name ON clef_inclusions;

-- 5. Drop indexes on clef_inclusions table
DROP INDEX IF EXISTS index_clef_inclusions_on_inclusion_id;
DROP INDEX IF EXISTS index_clef_inclusions_on_clef_id;

-- 6. Finally, drop the clef_inclusions table
DROP TABLE IF EXISTS clef_inclusions;

-- 7. Also check if there's a clefs table that's no longer needed
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('clefs', 'clef_inclusions');

-- If clefs table exists and is no longer used, drop it too:
-- DROP TABLE IF EXISTS clefs;

-- 8. Verify the inclusions table has the clefs column as JSONB
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'inclusions' 
AND column_name = 'clefs';

-- 9. If clefs column doesn't exist in inclusions, add it:
-- ALTER TABLE inclusions ADD COLUMN IF NOT EXISTS clefs JSONB DEFAULT '[]'::jsonb; 