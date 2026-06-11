/**
 * Idempotently seeds all canonical permissions and managed roles on every startup.
 *
 * Permission  = action × subject — the catalog of what can be done on what.
 * RoleGrant   = pattern string assigned to a role, e.g. "*:*:platform", "user:*:own"
 *
 * Pattern format: "{subject|*}:{action|*}:{scope}"
 *   - subject uses snake_case matching the permission code  (e.g. audit_log, org_document)
 *   - scope must always be explicit: own | org | platform   (no wildcard on scope)
 *   - *:*:platform → can('manage', 'all')                  — 1 CASL rule in the JWT
 *   - user:*:org   → can('manage', 'User', { org_id })     — 1 CASL rule in the JWT
 *
 * Policies are no longer pre-seeded. They are created on demand when a role is
 * created via the API (is_managed=false) or here at startup (is_managed=true).
 */
import { prisma } from '../models/index.js';
import { config } from '../config/index.js';
import { hashPassword } from '../utils/crypto.js';
import type { PermissionAction, PermissionSubject } from '@prisma/client';
import { PERMISSIONS } from '../utils/catalog.js';
import { assertCatalogCoversAllSubjects } from '../utils/ability.js';
// ---------------------------------------------------------------------------
// Managed roles  (org_id = null — global templates)
// ---------------------------------------------------------------------------

interface RoleSeed {
  name: string;
  slug: string;
  /** Wildcard patterns: "{subject|*}:{action|*}:{scope}" */
  patterns: string[];
}

const MANAGED_ROLES: RoleSeed[] = [
  // Passenger — self-service account (own scope only). Assigned automatically at
  // signup; never assignable by an org admin (they lack wallet/own-ticket grants).
  {
    name: 'Passenger',
    slug: 'passenger',
    patterns: [
      'ticket:read:own',
      'ticket:cancel:own',
      'wallet:read:own',
      'wallet:topup:own',
      'payment:read:own',
      'refund:read:own',
      'tax_receipt:read:own',
      'user:read:own',
      'user:update:own',
      'notification:receive:own',
      'notification:configure:own',
    ],
  },
  // Driver — sees only their assigned trips/manifests and validates boarding tickets.
  {
    name: 'Driver',
    slug: 'driver',
    patterns: [
      'trip:read:own',
      'trip:read_manifest:own',
      'ticket:read:own',
      'ticket:validate:own',
      'user:read:own',
      'user:update:own',
      'org:read:org',
      'notification:receive:own',
    ],
  },
  // Cashier — counter sales agent: sells, cancels and refunds tickets.
  {
    name: 'Cashier',
    slug: 'cashier',
    patterns: [
      'ticket:read:org',
      'ticket:create:org',
      'ticket:cancel:org',
      'ticket:refund:org',
      'ticket:validate:org',
      'trip:read:org',
      'route:read:org',
      'price:read:org',
      'payment:read:org',
      'user:read:own',
      'user:update:own',
      'org:read:org',
      'notification:receive:org',
    ],
  },
  // Station Manager — operations lead for an operator (formerly "Dispatcher"):
  // runs trips, fleet, ticketing and front-line staff for the org.
  {
    name: 'Station Manager',
    slug: 'station-manager',
    patterns: [
      'user:read:org',
      'user:invite:org',
      'user:suspend:org',
      'trip:read:org',
      'trip:create:org',
      'trip:update:org',
      'trip:delete:org',
      'trip:read_manifest:org',
      'ticket:read:org',
      'ticket:create:org',
      'ticket:cancel:org',
      'ticket:refund:org',
      'ticket:validate:org',
      'bus:read:org',
      'bus:create:org',
      'bus:update:org',
      'route:read:org',
      'price:read:org',
      'finance:read:org',
      'report:read:org',
      'report:export:org',
      'invitation:read:org',
      'invitation:update:org',
      'invitation:delete:org',
      'audit_log:read:org',
      'org:read:org',
      'notification:receive:org',
    ],
  },
  // Org Admin — full control of one operator: staff, roles, billing, settings.
  {
    name: 'Org Admin',
    slug: 'org-admin',
    patterns: [
      'user:*:org',
      'org:read:org',
      'org:update:org',
      'org:approve:org',
      'role:*:org',
      'invitation:*:org',
      'trip:*:org',
      'route:*:org',
      'bus:*:org',
      'ticket:*:org',
      'price:read:org',
      'finance:read:org',
      'finance:export:org',
      'billing:read:org',
      'billing:pay:org',
      'payout:read:org',
      'payment:read:org',
      'wallet:read:org',
      'refund:read:org',
      'tax_receipt:read:org',
      'vsdc:read:org',
      'report:*:org',
      'audit_log:read:org',
      'audit_log:export:org',
      'notification:receive:org',
      'notification:configure:org',
      'org_document:*:org',
    ],
  },
  // Platform Admin — god mode across the whole platform.
  {
    name: 'Platform Admin',
    slug: 'platform-admin',
    patterns: ['*:*:platform'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toPermissionCode = (action: PermissionAction, subject: PermissionSubject): string =>
  `${subject.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}:${action}`;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export const bootstrap = async (): Promise<void> => {
  // ── 0. Catalog integrity — fail fast if any Prisma subject is unmapped ────
  assertCatalogCoversAllSubjects(PERMISSIONS);

  // ── 1. Permissions ──────────────────────────────────────────────────────
  let permCount = 0;

  for (const seed of PERMISSIONS) {
    const code = toPermissionCode(seed.action, seed.subject);
    await prisma.permission.upsert({
      where: { action_subject: { action: seed.action, subject: seed.subject } },
      update: { code, display_name: seed.display_name, description: seed.description, group: seed.group, scopes: seed.scopes },
      create: { code, action: seed.action, subject: seed.subject, display_name: seed.display_name, description: seed.description, group: seed.group, scopes: seed.scopes },
    });
    permCount++;
  }

  // ── 2. Managed roles + grants ────────────────────────────────────────────
  let roleCount = 0;
  let grantCount = 0;

  // Drop obsolete managed global templates (e.g. renamed "dispatcher").
  // Only touches platform-seeded global roles — never org-scoped custom roles.
  const seededSlugs = MANAGED_ROLES.map((r) => r.slug);
  await prisma.role.deleteMany({
    where: { org_id: null, is_managed: true, slug: { notIn: seededSlugs } },
  });

  for (const seed of MANAGED_ROLES) {
    let role = await prisma.role.findFirst({ where: { slug: seed.slug, org_id: null } });
    if (role) {
      role = await prisma.role.update({ where: { id: role.id }, data: { name: seed.name, is_managed: true } });
    } else {
      role = await prisma.role.create({ data: { name: seed.name, slug: seed.slug, is_managed: true } });
    }
    roleCount++;

    // Remove managed grants that are no longer in the seed (pattern was renamed or dropped)
    await prisma.roleGrant.deleteMany({
      where: { role_id: role.id, is_managed: true, pattern: { notIn: seed.patterns } },
    });

    for (const pattern of seed.patterns) {
      await prisma.roleGrant.upsert({
        where: { role_id_pattern: { role_id: role.id, pattern } },
        update: { is_managed: true },
        create: { role_id: role.id, pattern, is_managed: true },
      });
      grantCount++;
    }
  }

  console.warn(`[bootstrap] ${permCount} permissions, ${roleCount} managed roles, ${grantCount} managed grants synced`);

  // ── 3. Default platform-admin user ──────────────────────────────────────
  const platformAdminRole = await prisma.role.findFirst({
    where: { slug: 'platform-admin', org_id: null },
  });

  if (!platformAdminRole) {
    console.warn('[bootstrap] platform-admin role missing — skipping admin user seed');
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { user_roles: { some: { role: { slug: 'platform-admin' } } } },
  });

  if (!existing) {
    const hashed = await hashPassword(config.admin.password);
    await prisma.user.create({
      data: {
        first_name:        'Platform',
        last_name:         'Admin',
        email:             config.admin.email,
        phone_number:      config.admin.phone,
        password_hash:     hashed,
        user_type:         'staff',
        status:            'active',
        email_verified_at: new Date(),
        notif_channel:     ['sms', 'email'],
        user_roles: {
          create: { role_id: platformAdminRole.id },
        },
      },
    });
    console.warn(`[bootstrap] default platform-admin created: ${config.admin.email}`);
  }
};

// ---------------------------------------------------------------------------
// Re-export the catalog for back-compat (canonical source: utils/catalog.ts)
// ---------------------------------------------------------------------------

export { PERMISSIONS } from '../utils/catalog.js';
export type { PermissionSeed } from '../utils/catalog.js';
