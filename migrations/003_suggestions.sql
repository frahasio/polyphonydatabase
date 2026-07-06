-- Unified review queue: automated matchers (Cantus Index title-function
-- matching, YouTube/Spotify recording discovery) write suggestions here;
-- catalogue users accept/reject them in the admin review UI.

CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                -- 'title_function' | 'recording_youtube' | 'recording_spotify'
  title_id INTEGER REFERENCES titles(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  score REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected | skipped
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suggestions_queue
  ON suggestions (kind, status, score DESC, id);

-- Permanent link from a title into the wider chant-research ecosystem
-- (Cantus Database, Usuarium etc.), set when a Cantus match is accepted.
ALTER TABLE titles ADD COLUMN IF NOT EXISTS cantus_id TEXT;
