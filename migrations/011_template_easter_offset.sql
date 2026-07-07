-- Easter-relative calendar placement for temporale documents that have no
-- jgabc feast key (Good Friday liturgy, Tenebrae, etc.). Offset in days
-- from Easter Sunday: -2 = Good Friday, -3 = Maundy Thursday, 49 = Pentecost.
ALTER TABLE booklet_templates ADD COLUMN IF NOT EXISTS easter_offset SMALLINT;
