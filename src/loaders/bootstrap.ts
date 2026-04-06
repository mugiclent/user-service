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
  {
    action: 'read',
    subject: 'User',
    display_name: 'View users',
    description: 'Read user profile information',
    group: 'User management',
    scopes: ['own', 'org', 'platform'],
  },
  {
    action: 'update',
    subject: 'User',
    display_name: 'Edit users',
    description: 'Update user profile fields',
    group: 'User management',
    scopes: ['own', 'org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'User',
    display_name: 'Delete users',
    description: 'Soft-delete a user account',
    group: 'User management',
    scopes: ['own', 'org', 'platform'],
  },
  {
    action: 'invite',
    subject: 'User',
    display_name: 'Invite users',
    description: 'Send invitations to new users',
    group: 'User management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'suspend',
    subject: 'User',
    display_name: 'Suspend users',
    description: 'Suspend or reactivate a user account',
    group: 'User management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'assign_role',
    subject: 'User',
    display_name: 'Assign roles',
    description: 'Assign or revoke roles and grants for a user',
    group: 'User management',
    scopes: ['org', 'platform'],
  },

  // ── Org ───────────────────────────────────────────────────────────────────
  {
    action: 'read',
    subject: 'Org',
    display_name: 'View organisations',
    description: 'Read organisation profile information',
    group: 'Organisation management',
    scopes: ['own', 'org', 'platform'],
  },
  {
    action: 'create',
    subject: 'Org',
    display_name: 'Create organisations',
    description: 'Register a new organisation',
    group: 'Organisation management',
    scopes: ['platform'],
  },
  {
    action: 'update',
    subject: 'Org',
    display_name: 'Edit organisations',
    description: 'Update organisation details',
    group: 'Organisation management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'Org',
    display_name: 'Delete organisations',
    description: 'Soft-delete an organisation',
    group: 'Organisation management',
    scopes: ['platform'],
  },
  {
    action: 'approve',
    subject: 'Org',
    display_name: 'Approve organisations',
    description: 'Approve or reject an organisation application',
    group: 'Organisation management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'suspend',
    subject: 'Org',
    display_name: 'Suspend organisations',
    description: 'Suspend or reactivate an organisation',
    group: 'Organisation management',
    scopes: ['org', 'platform'],
  },

  // ── Role ──────────────────────────────────────────────────────────────────
  {
    action: 'read',
    subject: 'Role',
    display_name: 'View roles',
    description: 'List and inspect roles and their grants',
    group: 'Role management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'create',
    subject: 'Role',
    display_name: 'Create roles',
    description: 'Define new roles',
    group: 'Role management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'update',
    subject: 'Role',
    display_name: 'Edit roles',
    description: 'Modify role name or grant assignments',
    group: 'Role management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'Role',
    display_name: 'Delete roles',
    description: 'Remove a role definition',
    group: 'Role management',
    scopes: ['org', 'platform'],
  },

  // ── Invitation ────────────────────────────────────────────────────────────
  {
    action: 'read',
    subject: 'Invitation',
    display_name: 'View invitations',
    description: 'List pending and accepted invitations',
    group: 'Invitation management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'update',
    subject: 'Invitation',
    display_name: 'Modify invitations',
    description: 'Resend or change the role on a pending invitation',
    group: 'Invitation management',
    scopes: ['org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'Invitation',
    display_name: 'Revoke invitations',
    description: 'Cancel a pending invitation',
    group: 'Invitation management',
    scopes: ['org', 'platform'],
  },

  // ── MediaAsset ────────────────────────────────────────────────────────────
  {
    action: 'upload',
    subject: 'MediaAsset',
    display_name: 'Upload media',
    description: 'Obtain a presigned URL to upload images or files',
    group: 'Media',
    scopes: ['own', 'org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'MediaAsset',
    display_name: 'Delete media',
    description: 'Remove a media asset',
    group: 'Media',
    scopes: ['own', 'org', 'platform'],
  },

  // ── OrgDocument ───────────────────────────────────────────────────────────
  {
    action: 'read',
    subject: 'OrgDocument',
    display_name: 'Read org documents',
    description: 'Obtain a presigned URL to download a sensitive org document',
    group: 'Org documents',
    scopes: ['org', 'platform'],
  },
  {
    action: 'upload',
    subject: 'OrgDocument',
    display_name: 'Upload org documents',
    description: 'Obtain a presigned URL to upload an org document',
    group: 'Org documents',
    scopes: ['org', 'platform'],
  },
  {
    action: 'delete',
    subject: 'OrgDocument',
    display_name: 'Delete org documents',
    description: 'Remove an org document record',
    group: 'Org documents',
    scopes: ['org', 'platform'],
  },

  // ── AuditLog ──────────────────────────────────────────────────────────────
  {
    action: 'read',
    subject: 'AuditLog',
    display_name: 'View audit logs',
    description: 'Query the audit trail',
    group: 'Audit',
    scopes: ['org', 'platform'],
  },
  {
    action: 'export',
    subject: 'AuditLog',
    display_name: 'Export audit logs',
    description: 'Download audit log data as CSV or JSON',
    group: 'Audit',
    scopes: ['org', 'platform'],
  },
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
    patterns: ['user:*:own', 'media_asset:*:own'],
  },
  {
    name: 'Driver',
    slug: 'driver',
    patterns: ['user:*:own', 'media_asset:*:own', 'org:read:own'],
  },
  {
    name: 'Dispatcher',
    slug: 'dispatcher',
    patterns: [
      'user:read:org',
      'user:invite:org',
      'user:suspend:org',
      'invitation:*:org',
      'audit_log:read:org',
    ],
  },
  {
    name: 'Org Admin',
    slug: 'org-admin',
    patterns: ['*:*:org', 'org:read:own'],
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
      update: { code, display_name: seed.display_name, description: seed.description, group: seed.group },
      create: { code, action: seed.action, subject: seed.subject, display_name: seed.display_name, description: seed.description, group: seed.group },
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
};

// ---------------------------------------------------------------------------
// Exported catalog — used by the role service for pattern validation
// ---------------------------------------------------------------------------

export { PERMISSIONS };
export type { PermissionSeed };
