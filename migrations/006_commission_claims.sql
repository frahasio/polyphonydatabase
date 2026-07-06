-- Commission claiming: a new 'commissions' feature permission controls who
-- may work on commissions, and each commission can be claimed by one user so
-- others cannot edit it until it is released.

ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS commissions BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE commissions ADD COLUMN IF NOT EXISTS claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
