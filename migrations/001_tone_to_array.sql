-- Migration: Convert compositions.tone from text to text[]
-- Run this against your PostgreSQL database before deploying the updated code.

ALTER TABLE compositions 
  ALTER COLUMN tone TYPE text[] 
  USING CASE WHEN tone IS NOT NULL THEN ARRAY[tone] ELSE NULL END;
