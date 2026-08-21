-- New users should start with NO permissions; access is granted explicitly
-- on the permissions page. Previously the catalogue permission defaulted to
-- true, so newly approved users could edit the catalogue immediately.
--
-- Preserve today's effective access for existing approved users: any of them
-- without a permissions row would have received catalogue=true on their next
-- permission check under the old default, so materialise that row now before
-- flipping the default.

INSERT INTO user_permissions (user_id)
SELECT id FROM users WHERE status = 'approved'
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE user_permissions ALTER COLUMN catalogue SET DEFAULT false;
