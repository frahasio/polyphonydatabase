-- Booklet template library: official (admin-curated) templates seeded from
-- the jgabc propers data plus user-published templates, all loadable from
-- the liturgical booklet maker.

CREATE TABLE IF NOT EXISTS booklet_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL DEFAULT '',      -- browsing group, e.g. 'Advent', 'Votive'
  feast_key TEXT,                       -- jgabc day key (e.g. 'Adv1') for generated ones
  official BOOLEAN NOT NULL DEFAULT false,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL DEFAULT '',  -- display label ("by ...") for user templates
  project JSONB NOT NULL,               -- booklet project (schema v8 JSON)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booklet_templates_browse
  ON booklet_templates (official DESC, season, name);
