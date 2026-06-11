-- Replace the literal `manage` PermissionAction.
--
-- `manage` collided with CASL's wildcard action. It is removed from the enum
-- and its two literal uses are renamed:
--   notification:manage  → notification:configure
--   vsdc:manage          → vsdc:provision
-- New action `validate` (ticket scanning) is also introduced.
--
-- Runs in a single transaction: rewrite data first, then swap the enum type.

-- 1. Rewrite stored grant pattern strings (role + user grants).
UPDATE "role_grants" SET "pattern" = replace("pattern", 'notification:manage:', 'notification:configure:') WHERE "pattern" LIKE 'notification:manage:%';
UPDATE "role_grants" SET "pattern" = replace("pattern", 'vsdc:manage:',         'vsdc:provision:')         WHERE "pattern" LIKE 'vsdc:manage:%';
UPDATE "user_grants" SET "pattern" = replace("pattern", 'notification:manage:', 'notification:configure:') WHERE "pattern" LIKE 'notification:manage:%';
UPDATE "user_grants" SET "pattern" = replace("pattern", 'vsdc:manage:',         'vsdc:provision:')         WHERE "pattern" LIKE 'vsdc:manage:%';

-- 2. Remove permission catalog rows that used the literal `manage` action.
--    bootstrap.ts re-seeds the replacement rows (configure/provision/validate) on next start.
DELETE FROM "permissions" WHERE "action" = 'manage';

-- 3. Swap the enum type (drop `manage`, add configure/provision/validate).
ALTER TYPE "PermissionAction" RENAME TO "PermissionAction_old";

CREATE TYPE "PermissionAction" AS ENUM (
  'read', 'create', 'update', 'delete', 'invite', 'suspend', 'assign_role',
  'approve', 'upload', 'export', 'receive', 'cancel', 'refund', 'topup', 'pay',
  'override', 'read_manifest', 'configure', 'provision', 'validate'
);

ALTER TABLE "permissions"
  ALTER COLUMN "action" TYPE "PermissionAction"
  USING ("action"::text::"PermissionAction");

DROP TYPE "PermissionAction_old";
