-- Title search used to probe every group with translate(lower(text)) ILIKE,
-- which cannot use the plain trigram index on titles.text. These expression
-- indexes match that exact translate() call (see src/routes/search.js and
-- src/routes/groups.js). The hyphen-keeping pair is for multipart-title
-- searches (" - "), which strip a smaller punctuation set.
--
-- The expressions must stay character-for-character identical to the queries.
-- Tables are small enough (tens of thousands of rows) that a regular CREATE
-- INDEX inside the migration transaction is fine.

CREATE INDEX IF NOT EXISTS idx_groups_display_title_norm_trgm
  ON groups USING gin (translate(lower(display_title), '.,;:!?"''()[]/-', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_titles_text_norm_trgm
  ON titles USING gin (translate(lower(text), '.,;:!?"''()[]/-', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_composers_name_norm_trgm
  ON composers USING gin (translate(lower(name), '.,;:!?"''()[]/-', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_groups_display_title_hyphen_trgm
  ON groups USING gin (translate(lower(display_title), '.,;:!?"''()[]/', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_titles_text_hyphen_trgm
  ON titles USING gin (translate(lower(text), '.,;:!?"''()[]/', '') gin_trgm_ops);

ANALYZE groups, titles, composers;
