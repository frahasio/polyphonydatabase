-- Granular catalogue permissions: per-entity write access with two levels.
--   'write' = add + edit;  'full' = add + edit + delete (and merge).
-- No row for a (user, entity) pair means no write access to that entity.
-- The existing user_permissions.catalogue boolean becomes VIEW-only access
-- to the admin cataloguing pages. Admins bypass all checks in middleware.
--
-- Entities:
--   sources     (includes inclusions, edited via the source editor)
--   composers
--   titles      (the /titles/* endpoints of the functions router)
--   functions   (incl. the feast dictionary)
--   groups      (incl. editions and recordings)
--   people      (editors, scribes, publishers, performers)
--   suggestions (the review queue; accepting suggestions writes real rows)

CREATE TABLE IF NOT EXISTS user_entity_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN
    ('sources','composers','titles','functions','groups','people','suggestions')),
  level TEXT NOT NULL CHECK (level IN ('write','full')),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (user_id, entity)
);

-- Backfill: under the old scheme, catalogue = true granted unrestricted
-- add/edit/delete everywhere, so existing catalogue users keep 'full' on
-- every entity. Admins bypass permission checks and need no rows.
INSERT INTO user_entity_permissions (user_id, entity, level)
SELECT p.user_id, e.entity, 'full'
FROM user_permissions p
JOIN users u ON u.id = p.user_id
CROSS JOIN (VALUES
  ('sources'),('composers'),('titles'),('functions'),
  ('groups'),('people'),('suggestions')
) AS e(entity)
WHERE p.catalogue = true AND u.role <> 'admin'
ON CONFLICT (user_id, entity) DO NOTHING;
