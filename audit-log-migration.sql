-- Comprehensive audit logging system
-- Run this SQL to add detailed activity tracking

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    user_email VARCHAR(255),
    action VARCHAR(50) NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE'
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER,
    record_title VARCHAR(500),
    changes JSONB, -- Store old/new values
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_action ON audit_log(table_name, action);

-- Helper function to extract meaningful title from record
CREATE OR REPLACE FUNCTION get_record_title(table_name TEXT, record_data JSONB) 
RETURNS TEXT AS $$
BEGIN
    CASE table_name
        WHEN 'sources' THEN
            RETURN COALESCE(record_data->>'code', record_data->>'siglum', 'Untitled Source');
        WHEN 'groups' THEN
            RETURN COALESCE(record_data->>'display_title', 'Untitled Group');
        WHEN 'compositions' THEN
            RETURN COALESCE(record_data->>'title_text', 'Untitled Composition');
        WHEN 'editions' THEN
            RETURN COALESCE(record_data->>'editor_name', 'Unknown Editor') || ' Edition';
        WHEN 'recordings' THEN
            RETURN COALESCE(record_data->>'performer_name', 'Unknown Performer') || ' Recording';
        WHEN 'composers' THEN
            RETURN COALESCE(record_data->>'name', 'Unknown Composer');
        WHEN 'functions' THEN
            RETURN COALESCE(record_data->>'name', 'Unknown Function');
        WHEN 'titles' THEN
            RETURN COALESCE(record_data->>'text', 'Untitled');
        WHEN 'users' THEN
            RETURN COALESCE(record_data->>'email', 'Unknown User');
        ELSE
            RETURN 'Record #' || COALESCE(record_data->>'id', '?');
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Helper function to log audit entries
CREATE OR REPLACE FUNCTION log_audit_entry(
    p_user_id INTEGER,
    p_user_email VARCHAR(255),
    p_action VARCHAR(50),
    p_table_name VARCHAR(100),
    p_record_id INTEGER,
    p_old_data JSONB DEFAULT NULL,
    p_new_data JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    audit_id INTEGER;
    record_title TEXT;
    changes_data JSONB;
BEGIN
    -- Determine record title
    record_title := get_record_title(p_table_name, COALESCE(p_new_data, p_old_data));
    
    -- Build changes data
    changes_data := jsonb_build_object(
        'old', p_old_data,
        'new', p_new_data
    );
    
    -- Insert audit log entry
    INSERT INTO audit_log (
        user_id, user_email, action, table_name, record_id, 
        record_title, changes, ip_address, user_agent, created_at
    )
    VALUES (
        p_user_id, p_user_email, p_action, p_table_name, p_record_id,
        record_title, changes_data, p_ip_address, p_user_agent, CURRENT_TIMESTAMP
    )
    RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql;

-- Add email field to users table if it doesn't exist (for audit trail clarity)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'email') THEN
        ALTER TABLE users ADD COLUMN email VARCHAR(255);
    END IF;
END $$;

-- Add admin flag to users table for privilege management
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'is_admin') THEN
        ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Make the existing admin user actually admin
UPDATE users SET is_admin = TRUE WHERE id = 1;

-- Add some indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- Create ignored_alerts table for data quality alert management
CREATE TABLE IF NOT EXISTS ignored_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    ignored_by INTEGER REFERENCES users(id),
    reason TEXT,
    ignored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(alert_type, entity_type, entity_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ignored_alerts_lookup ON ignored_alerts(alert_type, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ignored_alerts_user ON ignored_alerts(ignored_by);

COMMENT ON TABLE audit_log IS 'Comprehensive audit trail for all database changes';
COMMENT ON TABLE ignored_alerts IS 'Tracks ignored data quality alerts to prevent re-showing';
COMMENT ON FUNCTION log_audit_entry IS 'Helper function to create standardized audit log entries';
COMMENT ON FUNCTION get_record_title IS 'Extracts meaningful titles from records for audit display'; 