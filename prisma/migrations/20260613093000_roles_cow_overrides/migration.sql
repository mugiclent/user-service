-- Copy-on-write overrides for roles: is_managed is no longer a freeze. An org edits
-- a default role by forking a deep copy (role + grants, override_of -> default);
-- is_hidden tombstones a default for one org. See src/utils/overrides.ts.

ALTER TABLE "roles" ADD COLUMN "override_of" TEXT;
ALTER TABLE "roles" ADD COLUMN "is_hidden" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "roles_org_id_idx" ON "roles"("org_id");

ALTER TABLE "roles" ADD CONSTRAINT "roles_override_of_fkey"
  FOREIGN KEY ("override_of") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
