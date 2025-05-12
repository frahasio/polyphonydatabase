-- Create the source_images table
CREATE TABLE source_images (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    label TEXT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Migrate existing URLs to the new table
INSERT INTO source_images (url, source_id)
SELECT url, id
FROM sources
WHERE url IS NOT NULL AND url != '';

-- Add an index on source_id for better performance
CREATE INDEX source_images_source_id_idx ON source_images(source_id);

-- Drop the url column from sources table
ALTER TABLE sources DROP COLUMN url; 