-- Latin -> English feast-name dictionary for the Divinum Officium matcher.
-- One row per distinct DO day label (normalized Latin). "english" is the
-- catalogue-style feast name the matcher should use for that day; rows with
-- source = 'manual' are reviewer-curated and are never overwritten by the
-- seeding script (scripts/seed-feast-translations.js).

CREATE TABLE IF NOT EXISTS feast_translations (
  id SERIAL PRIMARY KEY,
  latin TEXT NOT NULL UNIQUE,          -- normalized label (normalizeFeast output)
  latin_display TEXT,                  -- the label as it appears in DO
  english TEXT,                        -- curated/guessed function name (NULL = unmapped)
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  day_count INTEGER NOT NULL DEFAULT 0, -- how many DO day files carry this label
  sample_day TEXT,                     -- one file rel, for context
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feast_translations_source ON feast_translations (source);
