/**
 * Canonical permission catalog — the single source of truth for the whole
 * authorization system.
 *
 * Everything downstream is derived from this list:
 *   - bootstrap.ts        seeds the `permissions` table from it
 *   - ability.ts          expands/compresses grant patterns against it
 *   - role/user services  validate patterns and authorize grant assignment
 *
 * A permission is one (action × subject) pair plus the scopes at which it is
 * meaningful. Pattern format used everywhere else:  "{subject|*}:{action|*}:{scope}"
 *   - subject is the snake_case form of the Prisma enum (OrgDocument → org_document)
 *   - scope ∈ own | org | platform  (never a wildcard)
 *
 * NOTE on the `manage` action: it is intentionally ABSENT from PermissionAction.
 * `manage` is reserved exclusively for CASL's wildcard ("any action") and is
 * produced only by ability.ts when a principal holds every action of a subject.
 * Literal lifecycle actions use explicit verbs: `configure`, `provision`, etc.
 */
import type { PermissionAction, PermissionSubject } from '@prisma/client';

export type PermissionScope = 'own' | 'org' | 'platform';

export interface PermissionSeed {
  action: PermissionAction;
  subject: PermissionSubject;
  display_name: string;
  description: string;
  group: string;
  /** Scopes at which this permission is valid — used for validation + wildcard expansion. */
  scopes: PermissionScope[];
}

export const PERMISSIONS: PermissionSeed[] = [
  // ── User ──────────────────────────────────────────────────────────────────
  { action: 'read',        subject: 'User', display_name: 'View users',   description: 'Read user profile information',                group: 'User management', scopes: ['own', 'org', 'platform'] },
  { action: 'create',      subject: 'User', display_name: 'Create users',  description: 'Direct account creation (staff provisioning)',  group: 'User management', scopes: ['org', 'platform'] },
  { action: 'update',      subject: 'User', display_name: 'Edit users',    description: 'Update user profile fields',                    group: 'User management', scopes: ['own', 'org', 'platform'] },
  { action: 'delete',      subject: 'User', display_name: 'Delete users',  description: 'Soft-delete a user account',                    group: 'User management', scopes: ['own', 'org', 'platform'] },
  { action: 'invite',      subject: 'User', display_name: 'Invite users',  description: 'Send staff invitations',                        group: 'User management', scopes: ['org', 'platform'] },
  { action: 'suspend',     subject: 'User', display_name: 'Suspend users', description: 'Suspend or reactivate a user account',          group: 'User management', scopes: ['org', 'platform'] },
  { action: 'assign_role', subject: 'User', display_name: 'Assign roles',  description: "Replace a user's roles and direct grants",      group: 'User management', scopes: ['org', 'platform'] },

  // ── Org ───────────────────────────────────────────────────────────────────
  { action: 'read',    subject: 'Org', display_name: 'View organisations',    description: 'View organization profiles',                                    group: 'Organisation management', scopes: ['own', 'org', 'platform'] },
  { action: 'create',  subject: 'Org', display_name: 'Create organisations',  description: 'Create organizations directly',                                 group: 'Organisation management', scopes: ['platform'] },
  { action: 'update',  subject: 'Org', display_name: 'Edit organisations',    description: 'Edit organization fields',                                      group: 'Organisation management', scopes: ['org', 'platform'] },
  { action: 'delete',  subject: 'Org', display_name: 'Delete organisations',  description: 'Delete an organization',                                        group: 'Organisation management', scopes: ['platform'] },
  { action: 'suspend', subject: 'Org', display_name: 'Suspend organisations', description: 'Suspend an organization and block all its users',                group: 'Organisation management', scopes: ['platform'] },
  { action: 'approve', subject: 'Org', display_name: 'Approve organisations', description: 'Approve coop member applications (org) or all orgs (platform)',   group: 'Organisation management', scopes: ['org', 'platform'] },

  // ── Role ──────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Role', display_name: 'View roles',   description: 'View roles and their grants', group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Role', display_name: 'Create roles', description: 'Create custom roles',         group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Role', display_name: 'Edit roles',   description: 'Edit role name and grants',   group: 'Role management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Role', display_name: 'Delete roles', description: 'Delete custom roles',         group: 'Role management', scopes: ['org', 'platform'] },

  // ── Invitation ────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Invitation', display_name: 'View invitations',   description: 'View pending invitations',  group: 'Invitation management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Invitation', display_name: 'Modify invitations', description: 'Edit a pending invitation', group: 'Invitation management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Invitation', display_name: 'Revoke invitations', description: 'Revoke an invitation',      group: 'Invitation management', scopes: ['org', 'platform'] },

  // ── Permission ────────────────────────────────────────────────────────────
  { action: 'read', subject: 'Permission', display_name: 'View permission catalog', description: 'View the permission catalog (for role builder UI)', group: 'Role management', scopes: ['org', 'platform'] },

  // ── OrgDocument ───────────────────────────────────────────────────────────
  { action: 'read',   subject: 'OrgDocument', display_name: 'Read org documents',   description: 'View application documents', group: 'Org documents', scopes: ['org', 'platform'] },
  { action: 'upload', subject: 'OrgDocument', display_name: 'Upload org documents', description: 'Upload documents',           group: 'Org documents', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'OrgDocument', display_name: 'Delete org documents', description: 'Delete documents',           group: 'Org documents', scopes: ['platform'] },

  // ── AuditLog ──────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'AuditLog', display_name: 'View audit logs',   description: 'View audit logs',   group: 'Audit', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'AuditLog', display_name: 'Export audit logs', description: 'Export audit logs', group: 'Audit', scopes: ['org', 'platform'] },

  // ── Notification ──────────────────────────────────────────────────────────
  { action: 'receive',   subject: 'Notification', display_name: 'Receive notifications',   description: 'Receive system and lifecycle notifications',         group: 'Notifications', scopes: ['own', 'org', 'platform'] },
  { action: 'configure', subject: 'Notification', display_name: 'Configure notifications', description: 'Configure personal or org notification preferences',  group: 'Notifications', scopes: ['own', 'org'] },

  // ── Trip ──────────────────────────────────────────────────────────────────
  { action: 'read',          subject: 'Trip', display_name: 'View trips',         description: 'View trips. own for drivers seeing only their assigned trips', group: 'Trip management', scopes: ['own', 'org', 'platform'] },
  { action: 'create',        subject: 'Trip', display_name: 'Create trips',       description: 'Create trips and series',                                     group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'update',        subject: 'Trip', display_name: 'Edit trips',         description: 'Edit trip fields, bus, driver, seat',                         group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'delete',        subject: 'Trip', display_name: 'Delete trips',       description: 'Delete trips and series',                                     group: 'Trip management', scopes: ['org', 'platform'] },
  { action: 'read_manifest', subject: 'Trip', display_name: 'View trip manifest', description: 'View the passenger manifest for a trip. own for drivers',      group: 'Trip management', scopes: ['own', 'org', 'platform'] },

  // ── Route ─────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Route', display_name: 'View routes',   description: 'View routes and their stops',    group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Route', display_name: 'Create routes', description: 'Create routes',                  group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Route', display_name: 'Edit routes',   description: 'Edit routes and stop sequences', group: 'Route management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Route', display_name: 'Delete routes', description: 'Delete routes',                  group: 'Route management', scopes: ['org', 'platform'] },

  // ── Location ──────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Location', display_name: 'View stop locations',   description: 'View stop locations',   group: 'Location management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Location', display_name: 'Create stop locations', description: 'Create stop locations', group: 'Location management', scopes: ['platform'] },
  { action: 'update', subject: 'Location', display_name: 'Edit stop locations',   description: 'Edit stop locations',   group: 'Location management', scopes: ['platform'] },
  { action: 'delete', subject: 'Location', display_name: 'Delete stop locations', description: 'Delete stop locations', group: 'Location management', scopes: ['platform'] },

  // ── Bus ───────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Bus', display_name: 'View buses',   description: 'View buses',                         group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Bus', display_name: 'Add a bus',    description: 'Add a bus to the fleet',             group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'update', subject: 'Bus', display_name: 'Edit a bus',   description: 'Edit bus details and assign driver', group: 'Fleet management', scopes: ['org', 'platform'] },
  { action: 'delete', subject: 'Bus', display_name: 'Delete a bus', description: 'Delete a bus',                       group: 'Fleet management', scopes: ['org', 'platform'] },

  // ── Ticket ────────────────────────────────────────────────────────────────
  { action: 'read',     subject: 'Ticket', display_name: 'View tickets',     description: 'View tickets. own for passengers seeing their own',     group: 'Ticketing', scopes: ['own', 'org', 'platform'] },
  { action: 'create',   subject: 'Ticket', display_name: 'Create tickets',   description: 'Create cash tickets on behalf of passengers',           group: 'Ticketing', scopes: ['org', 'platform'] },
  { action: 'cancel',   subject: 'Ticket', display_name: 'Cancel tickets',   description: 'Cancel a ticket',                                       group: 'Ticketing', scopes: ['own', 'org', 'platform'] },
  { action: 'refund',   subject: 'Ticket', display_name: 'Refund tickets',   description: 'Issue a refund on a cancelled ticket',                  group: 'Ticketing', scopes: ['org', 'platform'] },
  { action: 'validate', subject: 'Ticket', display_name: 'Validate tickets', description: 'Scan/validate a ticket at boarding. own for conductors', group: 'Ticketing', scopes: ['own', 'org', 'platform'] },

  // ── Price ─────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Price', display_name: 'View prices',   description: 'View stop pair prices',          group: 'Pricing', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Price', display_name: 'Create prices', description: 'Create a price for a stop pair', group: 'Pricing', scopes: ['platform'] },
  { action: 'update', subject: 'Price', display_name: 'Edit prices',   description: 'Update an existing price',       group: 'Pricing', scopes: ['platform'] },
  { action: 'delete', subject: 'Price', display_name: 'Delete prices', description: 'Delete a price',                 group: 'Pricing', scopes: ['platform'] },

  // ── Wallet ────────────────────────────────────────────────────────────────
  // own = a passenger's personal balance; org = the operator's balance (read-only).
  { action: 'read',  subject: 'Wallet', display_name: 'View wallet',   description: 'View wallet balance and transaction history. own=passenger, org=operator', group: 'Payments', scopes: ['own', 'org'] },
  { action: 'topup', subject: 'Wallet', display_name: 'Top up wallet', description: 'Initiate a wallet top-up',                                                group: 'Payments', scopes: ['own'] },

  // ── Payment ───────────────────────────────────────────────────────────────
  { action: 'read', subject: 'Payment', display_name: 'View payments', description: 'View payment transaction records', group: 'Payments', scopes: ['own', 'org', 'platform'] },

  // ── Refund ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Refund', display_name: 'View refunds',   description: 'View refund records',       group: 'Payments', scopes: ['own', 'org', 'platform'] },
  { action: 'create', subject: 'Refund', display_name: 'Create refunds', description: 'Manually trigger a refund', group: 'Payments', scopes: ['platform'] },

  // ── Payout ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Payout', display_name: 'View payouts',   description: 'View payout history',                 group: 'Payments', scopes: ['org', 'platform'] },
  { action: 'create', subject: 'Payout', display_name: 'Trigger payout', description: 'Trigger a payout transfer to an org', group: 'Payments', scopes: ['platform'] },

  // ── Finance ───────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Finance', display_name: 'View financials',   description: 'View revenue overview. Org sees net; platform sees gross + commission', group: 'Finance', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'Finance', display_name: 'Export financials', description: 'Export financial reports as PDF or CSV',                              group: 'Finance', scopes: ['org', 'platform'] },

  // ── Billing ───────────────────────────────────────────────────────────────
  { action: 'read',     subject: 'Billing', display_name: 'View billing',     description: 'View invoices and billing history',                            group: 'Finance', scopes: ['org', 'platform'] },
  { action: 'pay',      subject: 'Billing', display_name: 'Pay invoices',     description: 'Pay an outstanding invoice',                                   group: 'Finance', scopes: ['org'] },
  { action: 'override', subject: 'Billing', display_name: 'Override billing', description: 'Manually mark an invoice paid, extend a trial, or lift a block', group: 'Finance', scopes: ['platform'] },

  // ── Commission ────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Commission', display_name: 'View commission tiers', description: 'View commission tier tables',   group: 'Finance', scopes: ['platform'] },
  { action: 'update', subject: 'Commission', display_name: 'Edit commission tiers', description: 'Edit commission tier brackets', group: 'Finance', scopes: ['platform'] },

  // ── TaxReceipt ────────────────────────────────────────────────────────────
  { action: 'read', subject: 'TaxReceipt', display_name: 'View tax receipts', description: 'View tax receipts on tickets. own for passengers', group: 'Tax', scopes: ['own', 'org', 'platform'] },

  // ── Vsdc ──────────────────────────────────────────────────────────────────
  { action: 'read',      subject: 'Vsdc', display_name: 'View VSDC status', description: 'View VSDC provisioning status and health for the org',               group: 'Tax', scopes: ['org', 'platform'] },
  { action: 'provision', subject: 'Vsdc', display_name: 'Provision VSDC',   description: 'Provision, reprovision, or deactivate a VSDC instance for any org',  group: 'Tax', scopes: ['platform'] },

  // ── Report ────────────────────────────────────────────────────────────────
  { action: 'read',   subject: 'Report', display_name: 'View reports',   description: 'View trip, passenger, and revenue reports', group: 'Reports', scopes: ['org', 'platform'] },
  { action: 'export', subject: 'Report', display_name: 'Export reports', description: 'Export reports',                            group: 'Reports', scopes: ['org', 'platform'] },
];
