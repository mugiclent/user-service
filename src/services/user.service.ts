import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { getRedisClient } from '../loaders/redis.js';
import { serializeUserMe, serializeUserForList, serializeUserFullProfile } from '../models/serializers.js';
import { buildRulesForUser, buildAbilityFromRules } from '../utils/ability.js';
import type { AppRule } from '../utils/ability.js';
import { generateRawToken, hashToken, hashPassword } from '../utils/crypto.js';
import { publishNotification } from '../utils/publishers.js';

const withRoles = {
  include: { user_roles: { include: { role: true } } },
} as const;

// 15-minute blacklist window (matches access token TTL)
const BLACKLIST_TTL_SECONDS = 900;

// ---------------------------------------------------------------------------
// GET /users/me
// ---------------------------------------------------------------------------

export const UserService = {
  async getMe(requestingUser: UserWithRoles): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const rules = buildRulesForUser(requestingUser.id, requestingUser.org_id, roleSlugs);
    return serializeUserMe(requestingUser, rules) as unknown as Record<string, unknown>;
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/me
  // ---------------------------------------------------------------------------

  async updateMe(
    userId: string,
    data: { first_name?: string; last_name?: string; email?: string; avatar_url?: string },
  ): Promise<Record<string, unknown>> {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      ...withRoles,
    });

    const roleSlugs = user.user_roles.map((ur) => ur.role.slug);
    const rules = buildRulesForUser(user.id, user.org_id, roleSlugs);
    return serializeUserMe(user, rules) as unknown as Record<string, unknown>;
  },

  // ---------------------------------------------------------------------------
  // GET /users — list (admin / org_admin)
  // ---------------------------------------------------------------------------

  async listUsers(
    requestingUser: UserWithRoles,
    query: { page?: number; limit?: number; status?: string; user_type?: string; org_id?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const isAdmin = roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    const isOrgAdmin = roleSlugs.includes('org_admin');

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { deleted_at: null };

    if (!isAdmin) {
      // org_admin can only see their own org
      if (!isOrgAdmin || !requestingUser.org_id) throw new AppError('FORBIDDEN', 403);
      where['org_id'] = requestingUser.org_id;
    } else if (query.org_id) {
      where['org_id'] = query.org_id;
    }

    if (query.status) where['status'] = query.status;
    if (query.user_type) where['user_type'] = query.user_type;

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' }, ...withRoles }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => serializeUserForList(u, isAdmin)),
      total,
      page,
      limit,
    };
  },

  // ---------------------------------------------------------------------------
  // GET /users/:id
  // ---------------------------------------------------------------------------

  async getUserById(
    requestingUser: UserWithRoles,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const isAdmin = roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    const ability = buildAbilityFromRules(requestingUser.rules as AppRule[]);

    const user = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    if (!ability.can('read', 'User')) {
      // Self-access via CASL conditions — do a simpler ownership check
      if (requestingUser.id !== targetId) throw new AppError('FORBIDDEN', 403);
    }

    return serializeUserFullProfile(user, isAdmin);
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/:id
  // ---------------------------------------------------------------------------

  async updateUser(
    requestingUser: UserWithRoles,
    targetId: string,
    data: { first_name?: string; last_name?: string; status?: string; org_id?: string; role_slugs?: string[] },
  ): Promise<Record<string, unknown>> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const isAdmin = roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    const ability = buildAbilityFromRules(requestingUser.rules as AppRule[]);

    const target = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!target) throw new AppError('USER_NOT_FOUND', 404);

    if (!ability.can('update', 'User')) {
      if (requestingUser.id !== targetId) throw new AppError('FORBIDDEN', 403);
    }

    const { role_slugs, ...userFields } = data;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetId },
        data: userFields,
        ...withRoles,
      });

      if (role_slugs && isAdmin) {
        // Replace roles: delete existing, insert new
        const roles = await tx.role.findMany({ where: { slug: { in: role_slugs } } });
        await tx.userRole.deleteMany({ where: { user_id: targetId } });
        await tx.userRole.createMany({
          data: roles.map((r) => ({ user_id: targetId, role_id: r.id })),
        });
        // Re-fetch with updated roles
        return tx.user.findUniqueOrThrow({ where: { id: targetId }, ...withRoles });
      }

      return u;
    });

    return serializeUserFullProfile(updated, isAdmin);
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/:id — soft delete + blacklist
  // ---------------------------------------------------------------------------

  async deleteUser(requestingUser: UserWithRoles, targetId: string): Promise<void> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const isAdmin = roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    if (!isAdmin) throw new AppError('FORBIDDEN', 403);

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target || target.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    await prisma.$transaction([
      prisma.user.update({ where: { id: targetId }, data: { deleted_at: new Date() } }),
      // Revoke all refresh tokens
      prisma.refreshToken.updateMany({
        where: { user_id: targetId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    // Blacklist active access tokens for TTL window
    try {
      await getRedisClient().set(`blacklist:user:${targetId}`, '1', 'EX', BLACKLIST_TTL_SECONDS);
    } catch (err) {
      console.error('[user] Failed to set blacklist entry', err);
    }
  },

  // ---------------------------------------------------------------------------
  // POST /users/invite
  // ---------------------------------------------------------------------------

  async inviteUser(
    requestingUser: UserWithRoles,
    data: { email?: string; phone_number?: string; first_name: string; last_name: string; role_slug: string; org_id?: string },
  ): Promise<{ invite_token: string; expires_at: Date }> {
    const roleSlugs = requestingUser.user_roles.map((ur) => ur.role.slug);
    const isAdmin = roleSlugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    const isOrgAdmin = roleSlugs.includes('org_admin');

    if (!isAdmin && !isOrgAdmin) throw new AppError('FORBIDDEN', 403);

    const org_id = isOrgAdmin ? requestingUser.org_id! : (data.org_id ?? null);

    if (!data.email && !data.phone_number) throw new AppError('VALIDATION_ERROR', 422);

    const role = await prisma.role.findFirst({ where: { slug: data.role_slug, org_id: org_id ?? null } });
    if (!role) throw new AppError('ROLE_NOT_FOUND', 404);

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.invitation.create({
      data: {
        email: data.email ?? null,
        phone_number: data.phone_number ?? null,
        first_name: data.first_name,
        last_name: data.last_name,
        role_id: role.id,
        org_id,
        invited_by: requestingUser.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    return { invite_token: rawToken, expires_at: expiresAt };
  },

  // ---------------------------------------------------------------------------
  // POST /users/accept-invite
  // ---------------------------------------------------------------------------

  async acceptInvite(
    token: string,
    password: string,
  ): Promise<{ user: UserWithRoles }> {
    const tokenHash = hashToken(token);

    const invitation = await prisma.invitation.findUnique({ where: { token_hash: tokenHash } });
    if (!invitation || invitation.accepted_at) throw new AppError('INVALID_TOKEN', 400);
    if (invitation.expires_at < new Date()) throw new AppError('TOKEN_EXPIRED', 410);

    const password_hash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          first_name: invitation.first_name,
          last_name: invitation.last_name,
          email: invitation.email ?? null,
          phone_number: invitation.phone_number ?? null,
          password_hash,
          user_type: 'staff',
          status: 'active',
          org_id: invitation.org_id ?? null,
          phone_verified_at: invitation.phone_number ? new Date() : null,
          email_verified_at: invitation.email ? new Date() : null,
        },
      });
      await tx.userRole.create({ data: { user_id: created.id, role_id: invitation.role_id } });
      await tx.invitation.update({
        where: { token_hash: tokenHash },
        data: { accepted_at: new Date() },
      });
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, ...withRoles });
    });

    return { user };
  },
};
