import { prisma, Prisma } from '../models/index.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { getRedisClient } from '../loaders/redis.js';
import { slugify } from '../utils/slugify.js';
import { generateRawToken, hashToken } from '../utils/crypto.js';
import { publishAudit, publishSms, publishMail, notifyUser, publishOrgEvent } from '../utils/publishers.js';
import type { Locale, NotifiableUser } from '../utils/publishers.js';
import { config } from '../config/index.js';
import { deleteFromS3 } from '../utils/s3.js';
import {
  serializeOrgForList,
  serializeOrgCreated,
  serializeOrgFull,
} from '../models/serializers.js';
import { buildAbilityFromRules, getScopeFor } from '../utils/ability.js';

// ---------------------------------------------------------------------------
// Helpers — cooperative notification recipients
// ---------------------------------------------------------------------------

const COOP_NOTIFICATION_PATTERNS = [
  '*:*:org',
  'Notification:*:org',
  '*:receive:org',
  'Notification:receive:org',
];

const getCoopNotificationRecipients = (coopOrgId: string) =>
  prisma.user.findMany({
    where: {
      org_id: coopOrgId,
      status: 'active',
      deleted_at: null,
      OR: [
        {
          user_roles: {
            some: {
              role: {
                role_grants: {
                  some: { pattern: { in: COOP_NOTIFICATION_PATTERNS } },
                },
              },
            },
          },
        },
        {
          user_grants: {
            some: { pattern: { in: COOP_NOTIFICATION_PATTERNS } },
          },
        },
      ],
    },
    select: { email: true, phone_number: true, fcm_token: true, notif_channel: true, locale: true },
  });

const PLATFORM_NOTIFICATION_PATTERNS = [
  '*:*:platform',
  'Notification:*:platform',
  '*:receive:platform',
  'Notification:receive:platform',
];

const getPlatformNotificationRecipients = () =>
  prisma.user.findMany({
    where: {
      status: 'active',
      deleted_at: null,
      OR: [
        {
          user_roles: {
            some: {
              role: {
                role_grants: {
                  some: { pattern: { in: PLATFORM_NOTIFICATION_PATTERNS } },
                },
              },
            },
          },
        },
        {
          user_grants: {
            some: { pattern: { in: PLATFORM_NOTIFICATION_PATTERNS } },
          },
        },
      ],
    },
    select: { email: true, phone_number: true, fcm_token: true, notif_channel: true, locale: true },
  });

// 15-minute blacklist window (matches access token TTL)
const BLACKLIST_TTL_SECONDS = 900;

const withRelations = {
  include: {
    parent_org: { select: { id: true, name: true, slug: true, status: true } },
    child_orgs: { select: { id: true, name: true, slug: true, status: true } },
  },
} as const;

export const OrgService = {
  // ---------------------------------------------------------------------------
  // POST /organizations — create a new org (admin only)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // GET /organizations/public — no auth, passengers use for trip search filter
  // ---------------------------------------------------------------------------

  async listPublicOrgs(query: {
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: { id: string; name: string; slug: string; org_type: string; logo_path: string | null }[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { status: 'active', deleted_at: null };
    if (query.q) {
      where['name'] = { contains: query.q, mode: 'insensitive' };
    }

    const [orgs, total] = await Promise.all([
      prisma.org.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, org_type: true, logo_path: true },
      }),
      prisma.org.count({ where }),
    ]);

    return { data: orgs, total, page, limit };
  },

  async createOrg(
    requestingUser: AuthenticatedUser,
    data: {
      name: string;
      org_type: string;
      contact_first_name: string;
      contact_last_name: string;
      contact_email: string;
      contact_phone: string;
      address?: string;
      tin: string;
      license_number?: string;
      parent_org_id?: string;
      story?: string;
      status?: string;
    },
  ): Promise<Record<string, unknown>> {
    const slug = slugify(data.name);
    const [existing, phoneConflict, emailConflict] = await Promise.all([
      prisma.org.findFirst({ where: { OR: [{ name: data.name }, { slug }] }, select: { id: true } }),
      prisma.user.findUnique({ where: { phone_number_user_type: { phone_number: data.contact_phone, user_type: 'staff' } }, select: { id: true } }),
      data.contact_email
        ? prisma.user.findUnique({ where: { email_user_type: { email: data.contact_email, user_type: 'staff' } }, select: { id: true } })
        : null,
    ]);
    if (existing) throw new AppError('ORG_ALREADY_EXISTS', 409);
    if (phoneConflict) throw new AppError('CONTACT_PHONE_ALREADY_REGISTERED', 409);
    if (emailConflict) throw new AppError('CONTACT_EMAIL_ALREADY_REGISTERED', 409);

    let org;
    try {
      org = await prisma.org.create({
        data: {
          name: data.name,
          slug,
          org_type: data.org_type as 'company' | 'cooperative' | 'coop_member',
          contact_first_name: data.contact_first_name,
          contact_last_name: data.contact_last_name,
          contact_email: data.contact_email,
          contact_phone: data.contact_phone,
          address: data.address ?? null,
          tin: data.tin,
          license_number: data.license_number ?? null,
          parent_org_id: data.parent_org_id ?? null,
          story: data.story ?? null,
          ...(data.status ? { status: data.status as 'active' | 'pending' | 'suspended' } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003') throw new AppError('PARENT_ORG_NOT_FOUND', 404);
        if (err.code === 'P2002') throw new AppError('TIN_ALREADY_EXISTS', 409);
      }
      throw err;
    }

    publishAudit({ actor_id: requestingUser.id, action: 'create', resource: 'Org', resource_id: org.id });
    return serializeOrgCreated(org);
  },

  // ---------------------------------------------------------------------------
  // GET /organizations — list
  // ---------------------------------------------------------------------------

  async listOrgs(
    requestingUser: AuthenticatedUser,
    query: { page?: number; limit?: number; status?: string; org_type?: string; q?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const admin = getScopeFor(ability, 'read', 'Org') === 'platform';

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { deleted_at: null };
    if (!admin) {
      if (requestingUser.org_id) {
        const canApprove = ability.can('approve', 'Org');
        if (canApprove) {
          // Cooperative admins can see their own org + their coop_members
          where['OR'] = [
            { id: requestingUser.org_id },
            { parent_org_id: requestingUser.org_id },
          ];
        } else {
          where['id'] = requestingUser.org_id;
        }
      }
    }
    if (query.status) where['status'] = query.status;
    if (query.org_type) where['org_type'] = query.org_type;
    if (query.q) {
      const q = query.q;
      if (!where['AND']) where['AND'] = [];
      where['AND'].push({ OR: [
        { name:               { contains: q, mode: 'insensitive' } },
        { contact_first_name: { contains: q, mode: 'insensitive' } },
        { contact_last_name:  { contains: q, mode: 'insensitive' } },
        { contact_email:      { contains: q, mode: 'insensitive' } },
        { contact_phone:      { contains: q, mode: 'insensitive' } },
      ]});
    }

    const [orgs, total] = await Promise.all([
      prisma.org.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' } }),
      prisma.org.count({ where }),
    ]);

    return {
      data: orgs.map((o) => serializeOrgForList(o) as unknown as Record<string, unknown>),
      total,
      page,
      limit,
    };
  },

  // ---------------------------------------------------------------------------
  // GET /organizations/me — own org (for org staff)
  // ---------------------------------------------------------------------------

  async getMyOrg(requestingUser: AuthenticatedUser): Promise<Record<string, unknown>> {
    if (!requestingUser.org_id) throw new AppError('ORG_NOT_FOUND', 404);

    const org = await prisma.org.findUnique({
      where: { id: requestingUser.org_id, deleted_at: null },
      ...withRelations,
    });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);

    const ability = buildAbilityFromRules(requestingUser.rules);
    return serializeOrgFull(org, getScopeFor(ability, 'read', 'Org') === 'platform');
  },

  // ---------------------------------------------------------------------------
  // GET /organizations/:id
  // ---------------------------------------------------------------------------

  async getOrgById(
    requestingUser: AuthenticatedUser,
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const admin = getScopeFor(ability, 'read', 'Org') === 'platform';

    const org = await prisma.org.findUnique({
      where: { id: orgId, deleted_at: null },
      ...withRelations,
    });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);

    // Non-admin can only view their own org
    if (!admin && requestingUser.org_id !== orgId) throw new AppError('FORBIDDEN', 403);

    return serializeOrgFull(org, admin);
  },

  // ---------------------------------------------------------------------------
  // PATCH /organizations/:id
  // ---------------------------------------------------------------------------

  async updateOrg(
    requestingUser: AuthenticatedUser,
    orgId: string,
    data: {
      name?: string;
      contact_first_name?: string;
      contact_last_name?: string;
      contact_email?: string;
      contact_phone?: string;
      address?: string;
      logo_path?: string | null;
      story?: string | null;
      cancellations_allowed?: boolean;
      status?: string;
      rejection_reason?: string;
      parent_org_id?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const admin = getScopeFor(ability, 'update', 'Org') === 'platform';
    const orgAdmin = !admin && ability.can('update', 'Org') && !!requestingUser.org_id;

    if (!admin && !orgAdmin) throw new AppError('FORBIDDEN', 403);
    if (orgAdmin && requestingUser.org_id !== orgId) throw new AppError('FORBIDDEN', 403);

    // org_admin cannot change status — only katisha_admin can
    if (!admin && data.status !== undefined) throw new AppError('FORBIDDEN', 403);

    const existing = await prisma.org.findUnique({
      where: { id: orgId, deleted_at: null },
      select: { id: true, logo_path: true, name: true, contact_email: true, contact_phone: true, address: true, status: true, rejection_reason: true, org_type: true, cooperative_approved_at: true, parent_org_id: true, story: true, cancellations_allowed: true, tin: true },
    });
    if (!existing) throw new AppError('ORG_NOT_FOUND', 404);
    const oldLogoPath = existing.logo_path;

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) {
      updateData['name'] = data.name;
      updateData['slug'] = slugify(data.name);
    }
    if (data.contact_first_name !== undefined) updateData['contact_first_name'] = data.contact_first_name;
    if (data.contact_last_name !== undefined) updateData['contact_last_name'] = data.contact_last_name;
    if (data.contact_email !== undefined) updateData['contact_email'] = data.contact_email;
    if (data.contact_phone !== undefined) updateData['contact_phone'] = data.contact_phone;
    if (data.address !== undefined) updateData['address'] = data.address;
    if (data.logo_path !== undefined) updateData['logo_path'] = data.logo_path;
    if (data.story !== undefined) updateData['story'] = data.story;
    if (data.cancellations_allowed !== undefined) updateData['cancellations_allowed'] = data.cancellations_allowed;
    if (data.parent_org_id !== undefined && admin) {
      if (data.parent_org_id === null && existing.org_type === 'coop_member') throw new AppError('COOP_MEMBER_REQUIRES_PARENT', 400);
      updateData['parent_org_id'] = data.parent_org_id;
    }

    if (data.status !== undefined && admin) {
      // coop_member requires cooperative sign-off before admin can activate
      if (data.status === 'active' && existing.org_type === 'coop_member' && !existing.cooperative_approved_at) {
        throw new AppError('COOPERATIVE_APPROVAL_REQUIRED', 400);
      }

      updateData['status'] = data.status;

      if (data.status === 'active') {
        const approvedAt = new Date();
        updateData['approved_by'] = requestingUser.id;
        updateData['approved_at'] = approvedAt;
        updateData['billing_day'] = Math.min(28, approvedAt.getUTCDate());
      }
      if (data.status === 'rejected' && data.rejection_reason) {
        updateData['rejection_reason'] = data.rejection_reason;
      }
    }

    const org = await prisma.org.update({
      where: { id: orgId },
      data: updateData,
      ...withRelations,
    });

    // On activation: create org-admin invitation and send approval notification
    if (data.status === 'active' && admin) {
      const orgAdminRole = await prisma.role.findFirst({ where: { slug: 'org-admin', org_id: null } });
      if (orgAdminRole) {
        const rawToken = generateRawToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await prisma.invitation.create({
          data: {
            email: org.contact_email,
            phone_number: org.contact_phone,
            first_name: org.contact_first_name,
            last_name: org.contact_last_name,
            invitation_roles: { create: [{ role_id: orgAdminRole.id }] },
            org_id: org.id,
            invited_by: requestingUser.id,
            token_hash: hashToken(rawToken),
            expires_at: expiresAt,
          },
        });

        const inviteLink = `${config.staffAppUrl}/i?t=${rawToken}`;
        const expiresInSeconds = 7 * 24 * 60 * 60;

        if (org.org_type === 'coop_member') {
          // Notify the member contact
          publishSms({ type: 'org.member_approved', phone_number: org.contact_phone, org_name: org.name, invite_link: inviteLink, expires_in_seconds: expiresInSeconds });
          publishMail({ type: 'org.member_approved', email: org.contact_email, first_name: org.contact_first_name, org_name: org.name, invite_link: inviteLink, expires_in_seconds: expiresInSeconds });

          // Notify cooperative admins
          if (org.parent_org_id) {
            const coopRecipients = await getCoopNotificationRecipients(org.parent_org_id);
            for (const r of coopRecipients) {
              notifyUser(r as NotifiableUser, {
                sms:  r.phone_number ? { type: 'org.member_approved_notify_coop', phone_number: r.phone_number, org_name: org.name, locale: r.locale as Locale } : undefined,
                mail: r.email ? { type: 'org.member_approved_notify_coop', email: r.email, org_name: org.name, locale: r.locale as Locale } : undefined,
              });
            }
          }
        } else {
          publishSms({ type: 'org_approved.sms', phone_number: org.contact_phone, org_name: org.name, invite_link: inviteLink, expires_in_seconds: expiresInSeconds });
          publishMail({ type: 'org_approved.mail', email: org.contact_email, org_name: org.name, invite_link: inviteLink, expires_in_seconds: expiresInSeconds });
        }
      }
    }

    // After DB commit: delete old logo from S3 if logo_path changed
    if ('logo_path' in data && oldLogoPath) {
      deleteFromS3(oldLogoPath);
    }

    // Blacklist all active tokens for this org's users when suspended
    if (data.status === 'suspended') {
      try {
        await getRedisClient().set(`blacklist:org:${orgId}`, '1', 'EX', BLACKLIST_TTL_SECONDS);
      } catch (err) {
        console.error('[org] Failed to set blacklist entry', err);
      }

      // Notify the org contact directly (covers the principal contact even if they
      // have no user account yet, e.g. during early org setup)
      publishSms({ type: 'org.suspended', phone_number: org.contact_phone, org_name: org.name });
      if (org.contact_email) {
        publishMail({ type: 'org.suspended', email: org.contact_email, org_name: org.name });
      }

      // Also fan out to all active org users through their own notif_channel preferences
      // (covers push for users who have the app installed)
      prisma.user.findMany({
        where: { org_id: orgId, deleted_at: null, status: 'active' },
      }).then((users) => {
        for (const u of users) {
          notifyUser(u, {
            sms:  u.phone_number ? { type: 'org.suspended', phone_number: u.phone_number, org_name: org.name } : undefined,
            mail: u.email ? { type: 'org.suspended', email: u.email, org_name: org.name } : undefined,
            push: { type: 'org.suspended', data: { org_name: org.name } },
          });
        }
      }).catch((err) => console.error('[org] Failed to notify users on suspension', err));
    }

    if (data.status === 'rejected') {
      publishSms({ type: 'org.rejected', phone_number: org.contact_phone, org_name: org.name, reason: data.rejection_reason });
      if (org.contact_email) {
        publishMail({ type: 'org.rejected', email: org.contact_email, org_name: org.name, reason: data.rejection_reason });
      }
    }

    // Publish org domain events — fire-and-forget alongside the audit
    setImmediate(() => {
      const delta: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of ['name', 'contact_email', 'contact_phone', 'address', 'status', 'rejection_reason', 'cancellations_allowed'] as const) {
        if (existing[f] !== org[f]) delta[f] = { from: existing[f], to: org[f] };
      }
      publishAudit({
        actor_id: requestingUser.id,
        action: 'update',
        resource: 'Org',
        resource_id: orgId,
        ...(Object.keys(delta).length > 0 ? { delta } : {}),
      });

      if (data.status === 'active') {
        publishOrgEvent({
          type: 'org.activated',
          id: org.id,
          name: org.name,
          slug: org.slug,
          org_type: org.org_type,
          status: 'active',
          tin: org.tin,
          billing_day: org.billing_day!,
          logo_path: org.logo_path,
          parent_org_id: org.parent_org_id,
          story: org.story,
          cancellations_allowed: org.cancellations_allowed,
        });
      }

      if (data.status === 'suspended') {
        publishOrgEvent({ type: 'org.suspended', id: org.id, status: 'suspended', reason: data.rejection_reason });
      }

      const nameChanged = data.name !== undefined && existing.name !== org.name;
      const logoChanged = data.logo_path !== undefined && existing.logo_path !== org.logo_path;
      const parentChanged = data.parent_org_id !== undefined && existing.parent_org_id !== org.parent_org_id;
      const storyChanged = data.story !== undefined && existing.story !== org.story;
      const cancellationsChanged = data.cancellations_allowed !== undefined && existing.cancellations_allowed !== org.cancellations_allowed;
      if (nameChanged || logoChanged || parentChanged || storyChanged || cancellationsChanged) {
        publishOrgEvent({
          type: 'org.updated',
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo_path: org.logo_path,
          parent_org_id: org.parent_org_id,
          story: org.story,
          cancellations_allowed: org.cancellations_allowed,
          updated_at: org.updated_at.toISOString(),
        });
      }
    });
    return serializeOrgFull(org, admin);
  },

  // ---------------------------------------------------------------------------
  // POST /organizations/:id/cooperative-approve
  // Cooperative staff approves a pending coop_member application (step 1 of 2)
  // ---------------------------------------------------------------------------

  async cooperativeApprove(
    requestingUser: AuthenticatedUser,
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('approve', 'Org') || !requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    const org = await prisma.org.findUnique({ where: { id: orgId, deleted_at: null } });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);
    if (org.org_type !== 'coop_member') throw new AppError('NOT_COOP_MEMBER', 400);
    if (org.parent_org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);
    if (org.status !== 'pending') throw new AppError('ORG_NOT_PENDING', 400);
    if (org.cooperative_approved_at) throw new AppError('ALREADY_COOP_APPROVED', 409);

    const updated = await prisma.org.update({
      where: { id: orgId },
      data: { cooperative_approved_at: new Date(), cooperative_approved_by: requestingUser.id },
      ...withRelations,
    });

    // Notify Katisha platform admins that this member is ready for final review
    const parentCoop = await prisma.org.findUnique({ where: { id: requestingUser.org_id }, select: { name: true } });
    const coopName = parentCoop?.name ?? '';
    const platformRecipients = await getPlatformNotificationRecipients();
    for (const r of platformRecipients) {
      notifyUser(r as NotifiableUser, {
        sms:  r.phone_number ? { type: 'org.member_coop_approved', phone_number: r.phone_number, org_name: org.name, coop_name: coopName, locale: r.locale as Locale } : undefined,
        mail: r.email ? { type: 'org.member_coop_approved', email: r.email, org_name: org.name, coop_name: coopName, contact_email: org.contact_email, locale: r.locale as Locale } : undefined,
      });
    }

    publishAudit({ actor_id: requestingUser.id, action: 'cooperative_approve', resource: 'Org', resource_id: orgId });
    return serializeOrgFull(updated, false);
  },

  // ---------------------------------------------------------------------------
  // POST /organizations/:id/cooperative-reject
  // Cooperative staff rejects a pending coop_member application
  // ---------------------------------------------------------------------------

  async cooperativeReject(
    requestingUser: AuthenticatedUser,
    orgId: string,
    reason?: string,
  ): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('approve', 'Org') || !requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    const org = await prisma.org.findUnique({ where: { id: orgId, deleted_at: null } });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);
    if (org.org_type !== 'coop_member') throw new AppError('NOT_COOP_MEMBER', 400);
    if (org.parent_org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);
    if (org.status !== 'pending') throw new AppError('ORG_NOT_PENDING', 400);

    const parentCoop = await prisma.org.findUnique({ where: { id: requestingUser.org_id }, select: { name: true } });
    const coopName = parentCoop?.name ?? '';

    await prisma.org.update({
      where: { id: orgId },
      data: { status: 'rejected', rejection_reason: reason ?? null },
    });

    // Notify the coop_member contact
    publishSms({ type: 'org.member_coop_rejected', phone_number: org.contact_phone, org_name: org.name, coop_name: coopName, reason });
    publishMail({ type: 'org.member_coop_rejected', email: org.contact_email, first_name: org.contact_first_name, org_name: org.name, coop_name: coopName, reason });

    publishAudit({ actor_id: requestingUser.id, action: 'cooperative_reject', resource: 'Org', resource_id: orgId });
  },
};
