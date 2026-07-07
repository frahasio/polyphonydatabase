-- Office-type facet for the template library's calendar/finder UI.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS office_type TEXT NOT NULL DEFAULT 'mass';

-- Backfill user-visible office templates by name.
UPDATE booklet_templates
SET office_type = 'office'
WHERE office_type = 'mass'
  AND (name ~* 'vespers|lauds|compline|matins|terce|sext|none\b|prime\b');
