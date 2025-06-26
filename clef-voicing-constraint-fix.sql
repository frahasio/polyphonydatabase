-- Fix for clef_combinations_voicings table constraints
-- This addresses the "ON CONFLICT" error by ensuring proper constraints exist

-- Step 1: Check if the table has any constraints
-- Step 2: Add primary key constraint if missing
-- Step 3: Remove any duplicates first

-- Remove any duplicate mappings that might exist
DELETE FROM clef_combinations_voicings a
USING clef_combinations_voicings b
WHERE a.ctid < b.ctid
  AND a.clef_combination_id = b.clef_combination_id
  AND a.voicing_id = b.voicing_id;

-- Add primary key constraint if it doesn't exist
-- First check if constraint already exists
DO $$
BEGIN
    -- Check if primary key already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'clef_combinations_voicings' 
        AND constraint_type = 'PRIMARY KEY'
    ) THEN
        -- Add primary key constraint
        ALTER TABLE clef_combinations_voicings 
        ADD CONSTRAINT pk_clef_combinations_voicings 
        PRIMARY KEY (clef_combination_id, voicing_id);
        
        RAISE NOTICE 'Primary key constraint added to clef_combinations_voicings';
    ELSE
        RAISE NOTICE 'Primary key constraint already exists on clef_combinations_voicings';
    END IF;
END $$;

-- Alternatively, if primary key can't be added, add unique constraint
DO $$
BEGIN
    -- Check if unique constraint already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'clef_combinations_voicings' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'uk_clef_combinations_voicings'
    ) THEN
        -- Add unique constraint if primary key doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.table_constraints 
            WHERE table_name = 'clef_combinations_voicings' 
            AND constraint_type = 'PRIMARY KEY'
        ) THEN
            ALTER TABLE clef_combinations_voicings 
            ADD CONSTRAINT uk_clef_combinations_voicings 
            UNIQUE (clef_combination_id, voicing_id);
            
            RAISE NOTICE 'Unique constraint added to clef_combinations_voicings';
        END IF;
    ELSE
        RAISE NOTICE 'Unique constraint already exists on clef_combinations_voicings';
    END IF;
END $$;

-- Verify the constraints
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints 
WHERE table_name = 'clef_combinations_voicings'; 