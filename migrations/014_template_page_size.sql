-- Page size as a template attribute. Hand-made/curated documents are laid
-- out for one size (line breaks, spacing); buildable propers cores stay
-- NULL and can be built at any size.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS page_size TEXT;

UPDATE booklet_templates
SET page_size = UPPER(project->'settings'->>'pageSize')
WHERE page_size IS NULL
  AND (project->'meta'->>'buildable') IS NULL
  AND UPPER(project->'settings'->>'pageSize') IN ('A4', 'A5');
