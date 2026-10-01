-- Registration email verification (Oct 2026, anti-spam). A new account stays
-- invisible to admins (no notification email, hidden from the default user
-- list) until the applicant clicks the link in the verification email.
-- Tokens are stored hashed like reset tokens. Existing accounts are treated
-- as verified as of their creation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMP;

UPDATE users SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS users_verify_token_idx ON users (verify_token)
WHERE verify_token IS NOT NULL;
