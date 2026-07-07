-- Hand-curated official templates: once an admin has tidied and saved a
-- generated template, the seed generator must never overwrite it again.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS curated BOOLEAN NOT NULL DEFAULT false;
