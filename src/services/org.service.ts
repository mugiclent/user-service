import { prisma } from '../models/index.js';
import type { AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { getRedisClient } from '../loaders/redis.js';
import { slugify } from '../utils/slugify.js';
import { generateRawToken, hashToken } from '../utils/crypto.js';
import { publishAudit, publishSms, publishMail } from '../utils/publishers.js';
import { config } from '../config/index.js';
import { deleteFromS3 } from '../utils/s3.js';
import {
  serializeOrgForList,
  serializeOrgCreated,
  serializeOrgFull,
} from '../models/serializers.js';

// 15-minute blacklist window (matches access token TTL)
const BLACKLIST_TTL_SECONDS = 900;

const withRelations = {
  include: {
    parent_org: { select: { id: true, name: true, slug: true, status: true } },
    child_orgs: { select: { id: true, name: true, slug: true, status: true } },
  },
} as const;

const isAdmin = (roleSlugs: string[]): boolean =>
  roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));

export const OrgService = {
  // ---------------------------------------------------------------------------
  // POST /organizations — create a new org (admin only)
  // ---------------------------------------------------------------------------

  async createOrg(
    requestingUser: AuthenticatedUser,
    data: {
      name: string;
      org_type: string;
      contact_email: string;
      contact_phone: string;
      address?: string;
      tin?: string;
      license_number?: string;
      parent_org_id?: string;
    },
  ): Promise<Record<string, unknown>> {
    const slug = slugify(data.name);
    const existing = await prisma.org.findFirst({ where: { OR: [{ name: data.name }, { slug }] } });
    if (existing) throw new AppError('ORG_ALREADY_EXISTS', 409);

    const org = await prisma.org.create({
      data: {
        name: data.name,
        slug,
        org_type: data.org_type as 'company' | 'cooperative',
        contact_email: data.contact_email,
        contact_phone: data.contact_phone,
        address: data.address ?? null,
        tin: data.tin ?? null,
        license_number: data.license_number ?? null,
        parent_org_id: data.parent_org_id ?? null,
      },
    });

    publishAudit({ actor_id: requestingUser.id, action: 'create', resource: 'Org', resource_id: org.id });
    return serializeOrgCreated(org);
  },

  // ---------------------------------------------------------------------------
  // GET /organizations — list
  // ---------------------------------------------------------------------------

  async listOrgs(
    requestingUser: AuthenticatedUser,
    query: { page?: number; limit?: number; status?: string; org_type?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const roleSlugs = requestingUser.role_slugs;
    const admin = isAdmin(roleSlugs);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { deleted_at: null };
    if (!admin) {
      // Non-admin staff can only see their own org (scope by conditions)
      if (requestingUser.org_id) where['id'] = requestingUser.org_id;
    }
    if (query.status) where['status'] = query.status;
    if (query.org_type) where['org_type'] = query.org_type;

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

    const roleSlugs = requestingUser.role_slugs;
    return serializeOrgFull(org, isAdmin(roleSlugs));
  },

  // ---------------------------------------------------------------------------
  // GET /organizations/:id
  // ---------------------------------------------------------------------------

  async getOrgById(
    requestingUser: AuthenticatedUser,
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.role_slugs;
    const admin = isAdmin(roleSlugs);

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
      contact_email?: string;
      contact_phone?: string;
      address?: string;
      logo_path?: string | null;
      status?: string;
      rejection_reason?: string;
    },
  ): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.role_slugs;
    const admin = isAdmin(roleSlugs);
    const orgAdmin = roleSlugs.includes('org_admin');

    if (!admin && !orgAdmin) throw new AppError('FORBIDDEN', 403);
    if (orgAdmin && !admin && requestingUser.org_id !== orgId) throw new AppError('FORBIDDEN', 403);

    // org_admin cannot change status — only katisha_admin can
    if (!admin && data.status !== undefined) throw new AppError('FORBIDDEN', 403);

    const existing = await prisma.org.findUnique({
      where: { id: orgId, deleted_at: null },
      select: { id: true, logo_path: true },
    });
    if (!existing) throw new AppError('ORG_NOT_FOUND', 404);
    const oldLogoPath = existing.logo_path;

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) {
      updateData['name'] = data.name;
      updateData['slug'] = slugify(data.name);
    }
    if (data.contact_email !== undefined) updateData['contact_email'] = data.contact_email;
    if (data.contact_phone !== undefined) updateData['contact_phone'] = data.contact_phone;
    if (data.address !== undefined) updateData['address'] = data.address;
    if (data.logo_path !== undefined) updateData['logo_path'] = data.logo_path;

    if (data.status !== undefined && admin) {
      updateData['status'] = data.status;

      if (data.status === 'active') {
        updateData['approved_by'] = requestingUser.id;
        updateData['approved_at'] = new Date();
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
      publishSms({ type: 'org.suspended', phone_number: org.contact_phone, org_name: org.name });
      if (org.contact_email) {
        publishMail({ type: 'org.suspended', email: org.contact_email, org_name: org.name });
      }
    }

    if (data.status === 'rejected') {
      publishSms({ type: 'org.rejected', phone_number: org.contact_phone, org_name: org.name, reason: data.rejection_reason });
      if (org.contact_email) {
        publishMail({ type: 'org.rejected', email: org.contact_email, org_name: org.name, reason: data.rejection_reason });
      }
    }

    publishAudit({ actor_id: requestingUser.id, action: 'update', resource: 'Org', resource_id: orgId });
    return serializeOrgFull(org, admin);
  },

  // ---------------------------------------------------------------------------
  // POST /organizations/:id/approve — two-step cooperative approval
  // ---------------------------------------------------------------------------

  async approveChildOrg(
    requestingUser: AuthenticatedUser,
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.role_slugs;
    const admin = isAdmin(roleSlugs);
    const orgAdmin = roleSlugs.includes('org_admin');

    const org = await prisma.org.findUnique({ where: { id: orgId, deleted_at: null } });
    if (!org) throw new AppError('ORG_NOT_FOUND', 404);

    if (org.status !== 'pending') throw new AppError('ORG_NOT_PENDING', 400);

    // Step 1: parent cooperative org_admin stamps cooperative_approved_at
    if (orgAdmin && !admin) {
      if (!requestingUser.org_id || org.parent_org_id !== requestingUser.org_id) {
        throw new AppError('FORBIDDEN', 403);
      }
      const updated = await prisma.org.update({
        where: { id: orgId },
        data: { cooperative_approved_at: new Date() },
        ...withRelations,
      });

      // Notify the child org's contact that step 1 of approval is done
      publishSms({ type: 'org.cooperative_approved', phone_number: updated.contact_phone, org_name: updated.name });

      return serializeOrgFull(updated, false);
    }

    // Step 2: katisha_admin fully approves (requires step 1 for cooperatives)
    if (org.org_type === 'cooperative' && !org.cooperative_approved_at) {
      throw new AppError('COOPERATIVE_APPROVAL_REQUIRED', 400);
    }

    const updated = await prisma.org.update({
      where: { id: orgId },
      data: { status: 'active', approved_by: requestingUser.id, approved_at: new Date() },
      ...withRelations,
    });

    // Create an invitation for the org admin account using the org contact details.
    // The contact email/phone belongs to the person who will manage this org.
    const orgAdminRole = await prisma.role.findFirst({ where: { slug: 'org_admin', org_id: null } });
    if (orgAdminRole) {
      const rawToken = generateRawToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await prisma.invitation.create({
        data: {
          email: updated.contact_email,
          phone_number: updated.contact_phone,
          first_name: updated.name,
          last_name: 'Admin',
          role_id: orgAdminRole.id,
          org_id: updated.id,
          invited_by: requestingUser.id,
          token_hash: hashToken(rawToken),
          expires_at: expiresAt,
        },
      });

      const inviteLink = `${config.appUrl}/accept-invite?token=${rawToken}`;
      const expiresInSeconds = 7 * 24 * 60 * 60;
      publishSms({
        type: 'org_approved.sms',
        phone_number: updated.contact_phone,
        org_name: updated.name,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
      });
      publishMail({
        type: 'org_approved.mail',
        email: updated.contact_email,
        org_name: updated.name,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
      });
    }

    publishAudit({ actor_id: requestingUser.id, action: 'approve', resource: 'Org', resource_id: orgId });
    return serializeOrgFull(updated, true);
  },
};
