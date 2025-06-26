-- Simple script to fix users table for authentication
-- Run this if the main migration didn't work properly

-- First, backup any existing users
CREATE TABLE IF NOT EXISTS users_backup AS 
SELECT * FROM users WHERE EXISTS (SELECT 1 FROM users LIMIT 1);

-- Drop existing users table if it exists (this will cascade)
DROP TABLE IF EXISTS users CASCADE;

-- Create new users table with proper structure
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    reset_token VARCHAR(255) NULL,
    reset_token_expires TIMESTAMP NULL,
    last_login TIMESTAMP NULL,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Insert default admin user
-- Password is 'tempPassword123!' (change immediately after login)
INSERT INTO users (email, password_hash, name, status, role, created_at) VALUES 
('admin@polyphony.local', '$2b$12$LQv3c1yqBw2fonYKz/VBKO6krNqgCGVU3/p8Z/5dJe3MUZ3DHgm3W', 'System Administrator', 'approved', 'admin', CURRENT_TIMESTAMP);

-- Create function for auto-updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Show the created admin user
SELECT 'Admin user created:' as message, email, name, status, role, created_at 
FROM users WHERE email = 'admin@polyphony.local'; 