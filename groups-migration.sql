-- Migration to add groups, editions, and recordings tables
-- This extends the existing schema to support the new grouping functionality

-- Create groups table
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    display_title VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create editions table
CREATE TABLE IF NOT EXISTS editions (
    id SERIAL PRIMARY KEY,
    voicing VARCHAR(255),
    file_url VARCHAR(500) NOT NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    editor_id INTEGER REFERENCES editors(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create recordings table
CREATE TABLE IF NOT EXISTS recordings (
    id SERIAL PRIMARY KEY,
    file_url VARCHAR(500) NOT NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    performer_id INTEGER REFERENCES performers(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add group_id to compositions table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'compositions' AND column_name = 'group_id') THEN
        ALTER TABLE compositions ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_compositions_group_id ON compositions(group_id);
CREATE INDEX IF NOT EXISTS idx_editions_group_id ON editions(group_id);
CREATE INDEX IF NOT EXISTS idx_recordings_group_id ON recordings(group_id);
CREATE INDEX IF NOT EXISTS idx_editions_editor_id ON editions(editor_id);
CREATE INDEX IF NOT EXISTS idx_recordings_performer_id ON recordings(performer_id);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for groups table
DROP TRIGGER IF EXISTS update_groups_updated_at ON groups;
CREATE TRIGGER update_groups_updated_at 
    BEFORE UPDATE ON groups 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create triggers for editions table
DROP TRIGGER IF EXISTS update_editions_updated_at ON editions;
CREATE TRIGGER update_editions_updated_at 
    BEFORE UPDATE ON editions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create triggers for recordings table
DROP TRIGGER IF EXISTS update_recordings_updated_at ON recordings;
CREATE TRIGGER update_recordings_updated_at 
    BEFORE UPDATE ON recordings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create default groups for existing compositions without groups
-- This will create one group per composition initially
INSERT INTO groups (display_title)
SELECT DISTINCT 
    COALESCE(t.text, 'Untitled') || 
    CASE WHEN ct.name IS NOT NULL THEN ' (' || ct.name || ')' ELSE '' END
FROM compositions c
LEFT JOIN titles t ON c.title_id = t.id
LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
WHERE c.group_id IS NULL
AND NOT EXISTS (SELECT 1 FROM groups);

-- Assign group_id to compositions that don't have one
-- This is a simplified approach - in practice you might want to do this more carefully
DO $$
DECLARE
    comp_record RECORD;
    group_id_val INTEGER;
BEGIN
    FOR comp_record IN 
        SELECT c.id, 
               COALESCE(t.text, 'Untitled') || 
               CASE WHEN ct.name IS NOT NULL THEN ' (' || ct.name || ')' ELSE '' END as title
        FROM compositions c
        LEFT JOIN titles t ON c.title_id = t.id
        LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
        WHERE c.group_id IS NULL
    LOOP
        -- Create a group for this composition
        INSERT INTO groups (display_title) 
        VALUES (comp_record.title) 
        RETURNING id INTO group_id_val;
        
        -- Assign the group to the composition
        UPDATE compositions 
        SET group_id = group_id_val 
        WHERE id = comp_record.id;
    END LOOP;
END $$;

-- Add some sample data for testing
-- Note: Replace these with actual data or remove in production

-- Sample comment for verification
SELECT 'Groups migration completed successfully' as message,
       (SELECT COUNT(*) FROM groups) as total_groups,
       (SELECT COUNT(*) FROM compositions WHERE group_id IS NOT NULL) as compositions_with_groups; 