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
import type { PermissionScope } from '../utils/ability.js';

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

interface PermissionSeed {
  action: PermissionAction;
  subject: PermissionSubject;
  display_name: string;
  description: string;
  group: string;
  /** Valid scopes for this permission — used for pattern validation. */
  scopes: PermissionScope[];
}

const PERMISSIONS: PermissionSeed[] = [
  // ── User ──────────────────────────────────────────────────────────────────
  { action: 'read',        subject: 'User', display_name: 'View users',        description: 'Read user profile information',                       group: 'User management',         scopes: ['own', 'org', 'platform'] },
  { action: 'create',      subject: 'User', display_name: 'Create users',       description: 'Direct account creation (staff provisioning)',         group: 'User management',         scopes: ['org', 'platform'] },
  { action: 'update',      subject: 'User', display_name: 'Edit users',         description: 'Update user profile fields',                          group: 'User management',         scopes: ['own', 'org', 'platform'] },
  { action: 'delete',      subject: 'User', display_name: 'Delete users',       description: 'Soft-delete a user account',                          group: 'User management',         scopes: ['own', 'org', 'platform'] },
  { action: 'invite',      subject: 'User', display_name: 'Invite users',       description: 'Send staff invitations',                              group: 'User management',         scopes: ['org', 'platform'] },
  { action: 'suspend',     subject: 'User', display_name: 'Suspend users',      description: 'Suspend or reactivate a user account',                group: 'User management',         scopes: ['org', 'platform'] },
  { action: 'assign_role', subject: 'User', display_name: 'Assign roles',       description: 'Replace a user\'s roles',                             group: 'User management',         scopes: ['org', 'platform'] },

  // ── Org ───────────────────────────────────────────────────────────────────
  { action: 'read',    subject: 'Org', display_name: 'View organisations',    description: 'View organization profiles',                           group: 'Organisation management', scopes: ['own', 'org', 'platform'] },
  { action: 'create',  subject: 'Org', display_name: 'Create organisations',  description: 'Create organizations directly',                        group: 'Organisation management', scopes: ['platform'] },
  { action: 'update',  subject: 'Org', display_name: 'Edit organisations',    description: 'Edit organization fields',                             group: 'Organisation management', scopes: ['org', 'platform'] },
  { action: 'delete',  subject: 'Org', display_name: 'Delete organisations',  description: 'Delete an organization',                               group: 'Organisation management', scopes: ['platform'] },
  { action: 'suspend', subject: 'Org', display_name: 'Suspend organisations', description: 'Suspend an organization and block all its users',       group: 'Organisation management', scopes: ['platform'] },
  { action: 'approve', subject: 'Org', display_name: 'Approve organisations', description: 'Approve coop member applications (org) or all orgs (platform)', group: 'Organisation management', scopes: ['org', 'platform'] },

  // ── Role ──────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Role', display_name: 'View roles',   description: 'View roles and their grants',       group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Role', display_name: 'Create roles', description: 'Create custom roles',               group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Role', display_name: 'Edit roles',   description: 'Edit role name and grants',          group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Role', display_name: 'Delete roles', description: 'Delete custom roles',               group: 'Role management', scopes: ['org', 'platform'] },

  // ── Invitation ────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Invitation', display_name: 'View invitations',   description: 'View pending invitations',   group: 'Invitation management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Invitation', display_name: 'Modify invitations', description: 'Edit a pending invitation',  group: 'Invitation management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Invitation', display_name: 'Revoke invitations', description: 'Revoke an invitation',       group: 'Invitation management', scopes: ['org', 'platform'] },

  // ── Permission ────────────────────────────────────────────────────────────
  { action: 'read', subject: 'Permission', display_name: 'View permission catalog', description: 'View the permission catalog (for role builder UI)', group: 'Role management', scopes: ['org', 'platform'] },

  // ── OrgDocument ───────────────────────────────────────────────────────────
  { action: 'read',   subject: 'OrgDocument', display_name: 'Read org documents',   description: 'View application documents',                           group: 'Org documents', scopes: ['org', 'platform'] },
  { action: 'upload', subject: 'OrgDocument', display_name: 'Upload org documents', description: 'Upload documents',                                     group: 'Org documents', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'OrgDocument', display_name: 'Delete org documents', description: 'Delete documents',                                     group: 'Org documents', scopes: ['platform'] },

  // ── AuditLog ──────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'AuditLog', display_name: 'View audit logs',   description: 'View audit logs',          group: 'Audit', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'AuditLog', display_name: 'Export audit logs', description: 'Export audit logs',        group: 'Audit', scopes: ['org', 'platform'] },

  // ── Notification ──────────────────────────────────────────────────────────
  { action: 'receive', subject: 'Notification', display_name: 'Receive notifications', description: 'Receive system and lifecycle notifications',              group: 'Notifications', scopes: ['own', 'org', 'platform'] },
  { action: 'manage',  subject: 'Notification', display_name: 'Manage notifications',  description: 'Configure personal or org notification preferences',      group: 'Notifications', scopes: ['own', 'org'] },

  // ── Trip ──────────────────────────────────────────────────────────────────
  { action: 'read',          subject: 'Trip', display_name: 'View trips',          description: 'View trips. own for drivers seeing only their assigned trips',    group: 'Trip management', scopes: ['own', 'org', 'platform'] },
  { action: 'create',        subject: 'Trip', display_name: 'Create trips',        description: 'Create trips and series',                                        group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'update',        subject: 'Trip', display_name: 'Edit trips',          description: 'Edit trip fields, bus, driver, seat',                            group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'delete',        subject: 'Trip', display_name: 'Delete trips',        description: 'Delete trips and series',                                        group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'read_manifest', subject: 'Trip', display_name: 'View trip manifest',  description: 'View the passenger manifest for a trip. own for drivers',        group: 'Trip management', scopes: ['own', 'org', 'platform'] },

  // ── Route ─────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Route', display_name: 'View routes',   description: 'View routes and their stops',      group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Route', display_name: 'Create routes', description: 'Create routes',                    group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Route', display_name: 'Edit routes',   description: 'Edit routes and stop sequences',   group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Route', display_name: 'Delete routes', description: 'Delete routes',                    group: 'Route management', scopes: ['org', 'platform'] },

  // ── Location ──────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Location', display_name: 'View stop locations',   description: 'View stop locations',   group: 'Location management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Location', display_name: 'Create stop locations', description: 'Create stop locations', group: 'Location management', scopes: ['platform'] },
  { action: 'update', subject: 'Location', display_name: 'Edit stop locations',   description: 'Edit stop locations',   group: 'Location management', scopes: ['platform'] },
  { action: 'delete', subject: 'Location', display_name: 'Delete stop locations', description: 'Delete stop locations', group: 'Location management', scopes: ['platform'] },

  // ── Bus ───────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Bus', display_name: 'View buses',   description: 'View buses',                      group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Bus', display_name: 'Add a bus',    description: 'Add a bus to the fleet',          group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Bus', display_name: 'Edit a bus',   description: 'Edit bus details and assign driver', group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Bus', display_name: 'Delete a bus', description: 'Delete a bus',                    group: 'Fleet management', scopes: ['org', 'platform'] },

  // ── Ticket ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Ticket', display_name: 'View tickets',   description: 'View tickets. own for passengers seeing their own',   group: 'Ticketing', scopes: ['own', 'org', 'platform'] },
  { action: 'create', subject: 'Ticket', display_name: 'Create tickets', description: 'Create cash tickets on behalf of passengers',        group: 'Ticketing', scopes: ['org', 'platform'] },
  { action: 'cancel', subject: 'Ticket', display_name: 'Cancel tickets', description: 'Cancel a ticket',                                    group: 'Ticketing', scopes: ['own', 'org', 'platform'] },
  { action: 'refund', subject: 'Ticket', display_name: 'Refund tickets', description: 'Issue a refund on a cancelled ticket',               group: 'Ticketing', scopes: ['org', 'platform'] },

  // ── Price ─────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Price', display_name: 'View prices',   description: 'View stop pair prices',          group: 'Pricing', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Price', display_name: 'Create prices', description: 'Create a price for a stop pair', group: 'Pricing', scopes: ['platform'] },
  { action: 'update', subject: 'Price', display_name: 'Edit prices',   description: 'Update an existing price',       group: 'Pricing', scopes: ['platform'] },
  { action: 'delete', subject: 'Price', display_name: 'Delete prices', description: 'Delete a price',                 group: 'Pricing', scopes: ['platform'] },

  // ── Wallet ────────────────────────────────────────────────────────────────
  { action: 'read',  subject: 'Wallet', display_name: 'View wallet',    description: 'View own wallet balance and transaction history', group: 'Payments', scopes: ['own'] },
  { action: 'topup', subject: 'Wallet', display_name: 'Top up wallet',  description: 'Initiate a wallet top-up',                       group: 'Payments', scopes: ['own'] },

  // ── Payment ───────────────────────────────────────────────────────────────
  { action: 'read', subject: 'Payment', display_name: 'View payments', description: 'View payment transaction records', group: 'Payments', scopes: ['own', 'org', 'platform'] },

  // ── Refund ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Refund', display_name: 'View refunds',   description: 'View refund records',            group: 'Payments', scopes: ['own', 'org', 'platform'] },
  { action: 'create', subject: 'Refund', display_name: 'Create refunds', description: 'Manually trigger a refund',      group: 'Payments', scopes: ['platform'] },

  // ── Payout ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Payout', display_name: 'View payouts',   description: 'View payout history',                       group: 'Payments', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Payout', display_name: 'Trigger payout', description: 'Trigger a payout transfer to an org',       group: 'Payments', scopes: ['platform'] },

  // ── Finance ───────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Finance', display_name: 'View financials',   description: 'View revenue overview. Org scope sees net figures; platform sees gross and commission breakdown', group: 'Finance', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'Finance', display_name: 'Export financials', description: 'Export financial reports as PDF or CSV',                                                          group: 'Finance', scopes: ['org', 'platform'] },

  // ── Billing ───────────────────────────────────────────────────────────────
  { action: 'read',     subject: 'Billing', display_name: 'View billing',     description: 'View invoices and billing history',                           group: 'Finance', scopes: ['org', 'platform'] },
  { action: 'pay',      subject: 'Billing', display_name: 'Pay invoices',     description: 'Pay an outstanding invoice',                                  group: 'Finance', scopes: ['org'] },
  { action: 'override', subject: 'Billing', display_name: 'Override billing', description: 'Manually mark an invoice paid, extend a trial, or lift a block', group: 'Finance', scopes: ['platform'] },

  // ── Commission ────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Commission', display_name: 'View commission tiers',   description: 'View commission tier tables',      group: 'Finance', scopes: ['platform'] },
  { action: 'update', subject: 'Commission', display_name: 'Edit commission tiers',   description: 'Edit commission tier brackets',    group: 'Finance', scopes: ['platform'] },

  // ── TaxReceipt ────────────────────────────────────────────────────────────
  { action: 'read', subject: 'TaxReceipt', display_name: 'View tax receipts', description: 'View tax receipts on tickets. own for passengers', group: 'Tax', scopes: ['own', 'org', 'platform'] },

  // ── Vsdc ──────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Vsdc', display_name: 'View VSDC status', description: 'View VSDC provisioning status and health for the org',              group: 'Tax', scopes: ['org', 'platform'] },
  { action: 'manage', subject: 'Vsdc', display_name: 'Manage VSDC',      description: 'Provision, reprovision, or deactivate a VSDC instance for any org', group: 'Tax', scopes: ['platform'] },

  // ── Report ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Report', display_name: 'View reports',   description: 'View trip, passenger, and revenue reports', group: 'Reports', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'Report', display_name: 'Export reports', description: 'Export reports',                            group: 'Reports', scopes: ['org', 'platform'] },
];

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
      'notification:manage:own',
    ],
  },
  {
    name: 'Driver',
    slug: 'driver',
    patterns: [
      'trip:read:own',
      'trip:read_manifest:own',
      'ticket:read:own',
      'user:read:own',
      'user:update:own',
      'org:read:own',
      'notification:receive:own',
    ],
  },
  {
    name: 'Dispatcher',
    slug: 'dispatcher',
    patterns: [
      'user:read:org',
      'user:invite:org',
      'user:suspend:org',
      'trip:read:org',
      'trip:create:org',
      'trip:update:org',
      'trip:read_manifest:org',
      'ticket:read:org',
      'ticket:create:org',
      'ticket:cancel:org',
      'bus:read:org',
      'route:read:org',
      'price:read:org',
      'finance:read:org',
      'invitation:*:org',
      'audit_log:read:org',
      'notification:receive:org',
    ],
  },
  {
    name: 'Org Admin',
    slug: 'org-admin',
    patterns: [
      'user:*:org',
      'org:read:own',
      'org:update:org',
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
      'refund:read:org',
      'tax_receipt:read:org',
      'vsdc:read:org',
      'report:*:org',
      'audit_log:read:org',
      'notification:receive:org',
      'notification:manage:org',
      'org_document:*:org',
    ],
  },
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
// Exported catalog — used by the role service for pattern validation
// ---------------------------------------------------------------------------

export { PERMISSIONS };
export type { PermissionSeed };
