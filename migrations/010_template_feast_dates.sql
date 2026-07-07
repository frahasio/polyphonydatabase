-- Fixed calendar dates for templates (sanctorale and user-added feasts like
-- St Birinus), so the library calendar can place them. Moveable temporale
-- feasts keep using feast_key + client-side computus.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS feast_month SMALLINT;
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS feast_day SMALLINT;
