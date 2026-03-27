import { PrismaClient } from '@prisma/client';
import type { PermissionLevel, PermissionSubject } from '@prisma/client';
import { hashPassword } from '../src/utils/crypto.js';

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
// Seed users (dev/test only — change credentials before any production use)
// ---------------------------------------------------------------------------

const SEED_USERS = [
  {
    first_name:      'Amani',
    last_name:       'Uwimana',
    phone_number:    '+250788000001',
    email:           'amani.uwimana@katisha.rw',
    password:        'KatishaAdmin@2025',
    user_type:       'staff'  as const,
    status:          'active' as const,
    phone_verified:  true,
    email_verified:  true,
    role_slug:       'katisha_admin',
  },
  {
    first_name:      'Claudine',
    last_name:       'Mutesi',
    phone_number:    '+250788000099',
    email:           null,
    password:        'Passenger@2025',
    user_type:       'passenger' as const,
    status:          'active'    as const,
    phone_verified:  true,
    email_verified:  false,
    role_slug:       'passenger',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upsert a platform-level role (org_id = null).
 *  Prisma upsert doesn't accept null in compound unique keys, so we use findFirst + create/update. */
async function upsertPlatformRole(slug: string, name: string): Promise<string> {
  const existing = await prisma.role.findFirst({ where: { slug, org_id: null } });
  if (existing) {
    await prisma.role.update({ where: { id: existing.id }, data: { name } });
    return existing.id;
  }
  const created = await prisma.role.create({ data: { name, slug, org_id: null } });
  return created.id;
}

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
    roleMap[def.slug] = await upsertPlatformRole(def.slug, def.name);
  }
  console.log(`  ${ROLES.length} roles upserted`);

  // 3. Upsert role-permission assignments
  let assignCount = 0;
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
      assignCount++;
    }
  }
  console.log(`  ${assignCount} role-permission assignments upserted`);

  // 4. Seed users
  console.log('\nSeeding users...');
  for (const u of SEED_USERS) {
    const now = new Date();
    const password_hash = await hashPassword(u.password);

    const existing = await prisma.user.findUnique({ where: { phone_number: u.phone_number } });
    if (existing) {
      console.log(`  Skipping ${u.first_name} ${u.last_name} — already exists`);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        first_name:           u.first_name,
        last_name:            u.last_name,
        phone_number:         u.phone_number,
        email:                u.email,
        password_hash,
        user_type:            u.user_type,
        status:               u.status,
        phone_verified_at:    u.phone_verified  ? now : null,
        email_verified_at:    u.email_verified  ? now : null,
      },
    });

    const roleId = roleMap[u.role_slug];
    if (roleId) {
      await prisma.userRole.create({ data: { user_id: user.id, role_id: roleId } });
    }

    console.log(`  Created ${u.first_name} ${u.last_name} (${u.role_slug})`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
