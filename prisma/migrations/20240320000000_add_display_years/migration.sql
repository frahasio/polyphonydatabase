-- Add display_years column to composers table
ALTER TABLE composers ADD COLUMN IF NOT EXISTS display_years TEXT; 