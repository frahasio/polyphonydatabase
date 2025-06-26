-- Migration for voicing and clef combination system
-- This replaces the complex algorithmic voicing system with a simple database-driven approach

-- Create clef_combinations table
CREATE TABLE clef_combinations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE, -- e.g., "g2c2c3f3", "c1c3c4f4"
    clefs JSONB NOT NULL, -- Array of clef objects: [{"clef": "g2"}, {"clef": "c2"}, ...]
    voice_count INTEGER NOT NULL, -- Total number of voices
    description TEXT, -- Optional description
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create voicings table
CREATE TABLE voicings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE, -- e.g., "SATB", "SSA", "ATTB"
    description TEXT, -- Optional description
    voice_count INTEGER NOT NULL, -- Total number of voices
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create many-to-many relationship between voicings and clef combinations
CREATE TABLE voicing_clef_combinations (
    id SERIAL PRIMARY KEY,
    voicing_id INTEGER NOT NULL REFERENCES voicings(id) ON DELETE CASCADE,
    clef_combination_id INTEGER NOT NULL REFERENCES clef_combinations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(voicing_id, clef_combination_id)
);

-- Create indexes for performance
CREATE INDEX idx_clef_combinations_voice_count ON clef_combinations(voice_count);
CREATE INDEX idx_voicings_voice_count ON voicings(voice_count);
CREATE INDEX idx_voicing_clef_combinations_voicing_id ON voicing_clef_combinations(voicing_id);
CREATE INDEX idx_voicing_clef_combinations_clef_combination_id ON voicing_clef_combinations(clef_combination_id);

-- Insert some common voicings
INSERT INTO voicings (name, voice_count, description) VALUES
('SATB', 4, 'Soprano, Alto, Tenor, Bass'),
('SSA', 3, 'Soprano I, Soprano II, Alto'),
('SAT', 3, 'Soprano, Alto, Tenor'),
('ATB', 3, 'Alto, Tenor, Bass'),
('SSATB', 5, 'Soprano I, Soprano II, Alto, Tenor, Bass'),
('SAATB', 5, 'Soprano, Alto I, Alto II, Tenor, Bass'),
('SATTB', 5, 'Soprano, Alto, Tenor I, Tenor II, Bass'),
('SATBB', 5, 'Soprano, Alto, Tenor, Bass I, Bass II'),
('SSAATB', 6, 'Soprano I, Soprano II, Alto I, Alto II, Tenor, Bass'),
('SSATTB', 6, 'Soprano I, Soprano II, Alto, Tenor I, Tenor II, Bass'),
('SSATBB', 6, 'Soprano I, Soprano II, Alto, Tenor, Bass I, Bass II'),
('SAATTB', 6, 'Soprano, Alto I, Alto II, Tenor I, Tenor II, Bass'),
('SATTBB', 6, 'Soprano, Alto, Tenor I, Tenor II, Bass I, Bass II'),
('SAATBB', 6, 'Soprano, Alto I, Alto II, Tenor, Bass I, Bass II');

-- Insert some common clef combinations (extracted from existing database)
-- These would typically be populated by analyzing existing inclusions
INSERT INTO clef_combinations (name, clefs, voice_count, description) VALUES
('g2c2c3f3', '[{"clef": "g2"}, {"clef": "c2"}, {"clef": "c3"}, {"clef": "f3"}]', 4, 'Standard 4-voice combination'),
('c1c3c4f4', '[{"clef": "c1"}, {"clef": "c3"}, {"clef": "c4"}, {"clef": "f4"}]', 4, 'High 4-voice combination'),
('g2c1c3f3', '[{"clef": "g2"}, {"clef": "c1"}, {"clef": "c3"}, {"clef": "f3"}]', 4, 'Mixed 4-voice combination'),
('g2g2c2c3f3', '[{"clef": "g2"}, {"clef": "g2"}, {"clef": "c2"}, {"clef": "c3"}, {"clef": "f3"}]', 5, '5-voice with double soprano'),
('g2c2c2c3f3', '[{"clef": "g2"}, {"clef": "c2"}, {"clef": "c2"}, {"clef": "c3"}, {"clef": "f3"}]', 5, '5-voice with double alto'),
('g2c2c3c4f3', '[{"clef": "g2"}, {"clef": "c2"}, {"clef": "c3"}, {"clef": "c4"}, {"clef": "f3"}]', 5, '5-voice with double tenor'),
('g2c2c3f3f3', '[{"clef": "g2"}, {"clef": "c2"}, {"clef": "c3"}, {"clef": "f3"}, {"clef": "f3"}]', 5, '5-voice with double bass');

-- Create some common mappings between voicings and clef combinations
INSERT INTO voicing_clef_combinations (voicing_id, clef_combination_id) VALUES
-- SATB mappings
((SELECT id FROM voicings WHERE name = 'SATB'), (SELECT id FROM clef_combinations WHERE name = 'g2c2c3f3')),
((SELECT id FROM voicings WHERE name = 'SATB'), (SELECT id FROM clef_combinations WHERE name = 'c1c3c4f4')),
((SELECT id FROM voicings WHERE name = 'SATB'), (SELECT id FROM clef_combinations WHERE name = 'g2c1c3f3')),

-- 5-voice mappings
((SELECT id FROM voicings WHERE name = 'SSATB'), (SELECT id FROM clef_combinations WHERE name = 'g2g2c2c3f3')),
((SELECT id FROM voicings WHERE name = 'SAATB'), (SELECT id FROM clef_combinations WHERE name = 'g2c2c2c3f3')),
((SELECT id FROM voicings WHERE name = 'SATTB'), (SELECT id FROM clef_combinations WHERE name = 'g2c2c3c4f3')),
((SELECT id FROM voicings WHERE name = 'SATBB'), (SELECT id FROM clef_combinations WHERE name = 'g2c2c3f3f3'));

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