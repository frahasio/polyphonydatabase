-- Migration to convert tone column from integer to string with readable values
-- This updates the compositions table to use string values instead of integers

-- Step 1: Add a temporary column for the new string values
ALTER TABLE compositions ADD COLUMN tone_temp VARCHAR(10);

-- Step 2: Convert existing integer values to string values
UPDATE compositions SET tone_temp = CASE
    WHEN tone = 0 THEN '1'
    WHEN tone = 1 THEN '2'
    WHEN tone = 2 THEN '3'
    WHEN tone = 3 THEN '4'
    WHEN tone = 4 THEN '5'
    WHEN tone = 5 THEN '6'
    WHEN tone = 6 THEN '7'
    WHEN tone = 7 THEN '8'
    WHEN tone = 8 THEN '9'
    WHEN tone = 9 THEN '12'  -- duodecimi toni
    WHEN tone = 10 THEN 'mix'  -- mixti toni
    WHEN tone = 11 THEN 'per'  -- peregrini toni
    WHEN tone = 12 THEN 'pro'  -- proprii toni
    WHEN tone = 13 THEN 'pro'  -- proprii toni (fallback if 13 was used)
    ELSE NULL
END
WHERE tone IS NOT NULL;

-- Step 3: Drop the old integer column
ALTER TABLE compositions DROP COLUMN tone;

-- Step 4: Rename the temporary column to the original name
ALTER TABLE compositions RENAME COLUMN tone_temp TO tone;

-- Step 5: Add an index for performance
CREATE INDEX idx_compositions_tone ON compositions(tone);

-- Verification query (optional - uncomment to check results)
-- SELECT tone, COUNT(*) as count 
-- FROM compositions 
-- WHERE tone IS NOT NULL 
-- GROUP BY tone 
-- ORDER BY tone; 