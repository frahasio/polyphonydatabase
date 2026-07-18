-- Evidence for title->function links: the liturgical text the title's
-- incipit matches, its scripture citation and position. Shown as hover
-- tooltips on the public functions column. Filled by the DO matcher run
-- (rows without a DO basis stay NULL and simply get no tooltip).

ALTER TABLE functions_titles ADD COLUMN IF NOT EXISTS match_text text;
ALTER TABLE functions_titles ADD COLUMN IF NOT EXISTS match_citation text;
ALTER TABLE functions_titles ADD COLUMN IF NOT EXISTS match_position text;
