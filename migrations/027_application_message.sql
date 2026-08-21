-- Optional message left by a user at registration explaining what access
-- they are hoping for (e.g. booklet creator only, or help cataloguing).
-- Shown in the admin notification email and on the user management page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS application_message TEXT;
