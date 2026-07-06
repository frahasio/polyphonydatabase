CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  catalogue BOOLEAN NOT NULL DEFAULT true,
  booklet_creator BOOLEAN NOT NULL DEFAULT false,
  import_source BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id)
);
