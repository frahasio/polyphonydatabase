-- Prioritise the old calendar in Ordinary Time function names:
-- "Ordinary Time 7 (post Pentecost I)" -> "Post Pentecost I (Ordinary Time 7)".
-- Plain "Ordinary Time NN" rows (no old-calendar equivalent recorded) are
-- left unchanged.

UPDATE functions
SET name = regexp_replace(name, '^Ordinary Time (\d+) \((.+)\)$', '\2 (Ordinary Time \1)'),
    updated_at = CURRENT_TIMESTAMP
WHERE name ~ '^Ordinary Time \d+ \(.+\)$';

-- Capitalise the now-leading "post Pentecost ..." labels.
UPDATE functions
SET name = 'P' || substring(name from 2)
WHERE name LIKE 'post Pentecost%';
