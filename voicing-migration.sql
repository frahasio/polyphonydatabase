-- Migration for simplified voicing and clef combination system
-- This replaces the complex algorithmic voicing system with a simple database-driven approach

-- Create clef_combinations table - automatically populated from source editor
CREATE TABLE clef_combinations (
    id SERIAL PRIMARY KEY,
    clefcombo VARCHAR(255) NOT NULL UNIQUE -- e.g., "c1c1c2c4f4", "g2c2c3f3"
);

-- Create voicings table - manually maintained list
CREATE TABLE voicings (
    id SERIAL PRIMARY KEY,
    voicing VARCHAR(255) NOT NULL UNIQUE -- e.g., "SATB", "SSAATBarB", "SSA"
);

-- Create many-to-many relationship between clef combinations and voicings
CREATE TABLE clef_combos_voicings (
    clef_combo_id INTEGER NOT NULL REFERENCES clef_combinations(id) ON DELETE CASCADE,
    voicing_id INTEGER NOT NULL REFERENCES voicings(id) ON DELETE CASCADE,
    PRIMARY KEY (clef_combo_id, voicing_id)
);

-- Create indexes for performance
CREATE INDEX idx_clef_combinations_clefcombo ON clef_combinations(clefcombo);
CREATE INDEX idx_voicings_voicing ON voicings(voicing);
CREATE INDEX idx_clef_combos_voicings_clef_combo ON clef_combos_voicings(clef_combo_id);
CREATE INDEX idx_clef_combos_voicings_voicing ON clef_combos_voicings(voicing_id);

-- Insert common voicings
INSERT INTO voicings (voicing) VALUES
('SATB'),
('SSA'),
('SAT'),
('ATB'),
('SSATB'),
('SAATB'),
('SATTB'),
('SATBB'),
('SSAATB'),
('SSATTB'),
('SSATBB'),
('SAATTB'),
('SATTBB'),
('SAATBB'),
('SSAATBarB'),
('SATBarB'),
('SSAB'),
('SATB (Canonic)'),
('SSAA'),
('TTBB'),
('SAA'),
('STB'),
('ATT'),
('TBB');

-- Insert some common clef combinations (these would be auto-populated in real use)
INSERT INTO clef_combinations (clefcombo) VALUES
('g2c2c3f3'),
('c1c3c4f4'),
('g2c1c3f3'),
('g2g2c2c3f3'),
('g2c2c2c3f3'),
('g2c2c3c4f3'),
('g2c2c3f3f3'),
('c1c1c3c4f4'),
('g2c1c1c3f3'),
('g2c2c3c4f4'),
('c1c2c3f3'),
('g2c3f3'),
('c1c3f4'),
('g2c2f3'),
('c2c3f3'),
('g2g2c3f3');

-- Create some sample mappings (in real use, this would be managed through admin interface)
INSERT INTO clef_combos_voicings (clef_combo_id, voicing_id) VALUES
-- SATB mappings
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2c3f3'), (SELECT id FROM voicings WHERE voicing = 'SATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'c1c3c4f4'), (SELECT id FROM voicings WHERE voicing = 'SATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c1c3f3'), (SELECT id FROM voicings WHERE voicing = 'SATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'c1c2c3f3'), (SELECT id FROM voicings WHERE voicing = 'SATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2c3f4'), (SELECT id FROM voicings WHERE voicing = 'SATB')),

-- 5-voice mappings
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2g2c2c3f3'), (SELECT id FROM voicings WHERE voicing = 'SSATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2c2c3f3'), (SELECT id FROM voicings WHERE voicing = 'SAATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2c3c4f3'), (SELECT id FROM voicings WHERE voicing = 'SATTB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2c3f3f3'), (SELECT id FROM voicings WHERE voicing = 'SATBB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'c1c1c3c4f4'), (SELECT id FROM voicings WHERE voicing = 'SSATB')),

-- 3-voice mappings
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c3f3'), (SELECT id FROM voicings WHERE voicing = 'SSA')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'c1c3f4'), (SELECT id FROM voicings WHERE voicing = 'SAT')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'c2c3f3'), (SELECT id FROM voicings WHERE voicing = 'ATB')),
((SELECT id FROM clef_combinations WHERE clefcombo = 'g2c2f3'), (SELECT id FROM voicings WHERE voicing = 'SAT'));

-- Add audit table for data quality alerts that can be permanently ignored
CREATE TABLE ignored_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(255) NOT NULL, -- e.g., 'clef_combo_no_voicing', 'voicing_no_clef_combo'
    entity_type VARCHAR(255) NOT NULL, -- e.g., 'clef_combination', 'voicing', 'composer', 'group'
    entity_id INTEGER NOT NULL, -- ID of the entity to ignore
    ignored_by INTEGER REFERENCES users(id),
    ignored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    UNIQUE(alert_type, entity_type, entity_id)
);

CREATE INDEX idx_ignored_alerts_lookup ON ignored_alerts(alert_type, entity_type, entity_id); 