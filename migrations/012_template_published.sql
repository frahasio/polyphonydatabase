-- Draft/published workflow for official templates: seeded templates start as
-- drafts, visible only to admins, until individually checked and published.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT true;

-- All machine-seeded official templates (they carry a feast_key) become
-- drafts pending review. Hand-imported official templates and community
-- templates stay visible.
UPDATE booklet_templates SET published = false WHERE official = true AND feast_key IS NOT NULL;
