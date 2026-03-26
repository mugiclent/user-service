import { PrismaClient } from '@prisma/client';
import type { PermissionLevel, PermissionSubject } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

const PERMISSIONS: Array<{ level: PermissionLevel; subject: PermissionSubject }> = [
  { level: 'manage', subject: 'all'  },
  { level: 'manage', subject: 'User' },
  { level: 'manage', subject: 'Org'  },
  { level: 'manage', subject: 'Role' },
  { level: 'write',  subject: 'User' },
  { level: 'write',  subject: 'Org'  },
  { level: 'read',   subject: 'User' },
  { level: 'read',   subject: 'Org'  },
  { level: 'read',   subject: 'Role' },
];

// ---------------------------------------------------------------------------
// Platform-level roles (org_id = null)
// ---------------------------------------------------------------------------

const ROLES = [
  { name: 'Katisha Super Admin', slug: 'katisha_super_admin' },
  { name: 'Katisha Admin',       slug: 'katisha_admin'       },
  { name: 'Katisha Support',     slug: 'katisha_support'     },
  { name: 'Org Admin',           slug: 'org_admin'           },
  { name: 'Dispatcher',          slug: 'dispatcher'          },
  { name: 'Driver',              slug: 'driver'              },
  { name: 'Passenger',           slug: 'passenger'           },
];

// ---------------------------------------------------------------------------
// Permission assignments per role
//
// Permission hierarchy:
//   manage → delete + update + create + read (CASL 'manage' special)
//   write  → update + create + read          (no delete)
//   read   → read only
//
// Conditions (org/self scoping) are applied at runtime in src/utils/ability.ts.
// ---------------------------------------------------------------------------

const ASSIGNMENTS: Record<string, string[]> = {
  // Platform admins — full access to everything
  katisha_super_admin: ['manage:all'],
  katisha_admin:       ['manage:all'],

  // Support team — read-only across the platform
  katisha_support:     ['read:User', 'read:Org'],

  // Org admin — manage users in their org, write (not delete) their org
  org_admin:           ['manage:User', 'write:Org'],

  // Dispatcher — create/update users in their org, read their org
  dispatcher:          ['write:User', 'read:Org'],

  // Driver — read+update own profile only (create omitted by SELF_ONLY_ROLES in ability.ts)
  driver:              ['write:User'],

  // Passenger — read+update own profile only (create omitted by SELF_ONLY_ROLES in ability.ts)
  passenger:           ['write:User'],
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding permissions...');

  // 1. Upsert permission catalog
  const permMap: Record<string, string> = {};
  for (const def of PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { level_subject: { level: def.level, subject: def.subject } },
      update: {},
      create: def,
    });
    permMap[`${def.level}:${def.subject}`] = p.id;
  }

  console.log(`  ${PERMISSIONS.length} permissions upserted`);

  // 2. Upsert platform roles
  const roleMap: Record<string, string> = {};
  for (const def of ROLES) {
    const r = await prisma.role.upsert({
      where: { slug_org_id: { slug: def.slug, org_id: null } },
      update: { name: def.name },
      create: { name: def.name, slug: def.slug, org_id: null },
    });
    roleMap[def.slug] = r.id;
  }

  console.log(`  ${ROLES.length} roles upserted`);

  // 3. Upsert role-permission assignments
  let count = 0;
  for (const [roleSlug, permKeys] of Object.entries(ASSIGNMENTS)) {
    const roleId = roleMap[roleSlug];
    if (!roleId) throw new Error(`Unknown role slug: ${roleSlug}`);

    for (const key of permKeys) {
      const permId = permMap[key];
      if (!permId) throw new Error(`Unknown permission key: ${key}`);

      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: roleId, permission_id: permId } },
        update: {},
        create: { role_id: roleId, permission_id: permId },
      });
      count++;
    }
  }

  console.log(`  ${count} role-permission assignments upserted`);
  console.log('Seed complete.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
