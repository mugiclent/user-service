import { prisma } from '../models/index.js';
import type { Prisma, UserWithRoles, AuthenticatedUser } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { getRedisClient } from '../loaders/redis.js';
import { serializeUserMe, serializeUserForList, serializeUserFullProfile } from '../models/serializers.js';
import { buildRulesForUser, buildAbilityFromRules, collectPermissions } from '../utils/ability.js';
import { generateRawToken, hashToken, hashPassword, verifyPassword } from '../utils/crypto.js';
import { publishAudit, publishSms, publishMail, notifyUser } from '../utils/publishers.js';
import { config } from '../config/index.js';
import { deleteFromS3 } from '../utils/s3.js';

const withRoles = {
  include: {
    user_roles: {
      include: {
        role: {
          include: {
            role_permissions: { include: { permission: true } },
          },
        },
      },
    },
    user_permissions: { include: { permission: true } },
  },
} as const;

// 15-minute blacklist window (matches access token TTL)
const BLACKLIST_TTL_SECONDS = 900;

// ---------------------------------------------------------------------------
// GET /users/me
// ---------------------------------------------------------------------------

export const UserService = {
  async getMe(requestingUser: AuthenticatedUser): Promise<Record<string, unknown>> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: requestingUser.id }, ...withRoles });
    // Rules come from the JWT (already validated by the gateway) — no need to rebuild from DB
    return serializeUserMe(user, requestingUser.rules) as unknown as Record<string, unknown>;
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/me
  // ---------------------------------------------------------------------------

  async updateMe(
    requestingUser: AuthenticatedUser,
    data: { first_name?: string; last_name?: string; email?: string; avatar_path?: string | null; notif_channel?: string },
  ): Promise<Record<string, unknown>> {
    // Passengers cannot have email — only staff can
    if (data.email !== undefined && requestingUser.user_type === 'passenger') {
      throw new AppError('PASSENGERS_CANNOT_HAVE_EMAIL', 422);
    }

    // Fetch old avatar_path before overwriting so we can delete it from S3
    const existing = 'avatar_path' in data
      ? await prisma.user.findUnique({ where: { id: requestingUser.id }, select: { avatar_path: true } })
      : null;

    const user = await prisma.user.update({
      where: { id: requestingUser.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any,
      ...withRoles,
    });

    if (existing?.avatar_path) deleteFromS3(existing.avatar_path);

    const entries = collectPermissions(user);
    const rules = buildRulesForUser(user.id, user.org_id, entries);
    return serializeUserMe(user, rules) as unknown as Record<string, unknown>;
  },

  // ---------------------------------------------------------------------------
  // GET /users — list (admin / org_admin)
  // ---------------------------------------------------------------------------

  async listUsers(
    requestingUser: AuthenticatedUser,
    query: { page?: number; limit?: number; status?: string; user_type?: string; org_id?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const isAdmin = requestingUser.role_slugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { deleted_at: null };

    if (!isAdmin) {
      if (requestingUser.org_id) {
        // org-scoped staff: see only their org's users
        where['org_id'] = requestingUser.org_id;
      } else {
        // self-scoped (passenger/driver): see only themselves
        where['id'] = requestingUser.id;
      }
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
    requestingUser: AuthenticatedUser,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    const isAdmin = requestingUser.role_slugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));

    const user = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    if (!isAdmin) {
      // Object-level scope enforcement (conditions expressed in DB query scoping)
      if (requestingUser.org_id) {
        // org-scoped roles (org_admin, dispatcher): users in same org only
        if (user.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);
      } else {
        // self-scoped roles (passenger, driver): own profile only
        if (requestingUser.id !== targetId) throw new AppError('FORBIDDEN', 403);
      }
    }

    return serializeUserFullProfile(user, isAdmin);
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/:id
  // ---------------------------------------------------------------------------

  async updateUser(
    requestingUser: AuthenticatedUser,
    targetId: string,
    data: { first_name?: string; last_name?: string; status?: string; org_id?: string; role_slugs?: string[] },
  ): Promise<Record<string, unknown>> {
    const isAdmin = requestingUser.role_slugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    const ability = buildAbilityFromRules(requestingUser.rules);
    // Role assignment requires unconditioned manage:User (platform admins only)

    const target = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!target) throw new AppError('USER_NOT_FOUND', 404);

    if (!isAdmin) {
      // Object-level scope enforcement
      if (requestingUser.org_id) {
        // org-scoped roles: target must be in same org
        if (target.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);
      } else {
        // self-scoped roles (passenger, driver): own profile only
        if (requestingUser.id !== targetId) throw new AppError('FORBIDDEN', 403);
      }
    }

    const { role_slugs, first_name, last_name, status, org_id } = data;

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (status !== undefined) updateData.status = status as Prisma.EnumUserStatusFieldUpdateOperationsInput['set'];
    if (org_id !== undefined) updateData.org_id = org_id;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetId },
        data: updateData,
        ...withRoles,
      });

      if (role_slugs && ability.can('manage', 'User') && isAdmin) {
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

    // Notify the target user if their account was suspended
    if (data.status === 'suspended') {
      notifyUser(updated, {
        sms: { type: 'security.account_suspended', phone_number: updated.phone_number, first_name: updated.first_name },
        mail: updated.email ? { type: 'security.account_suspended', email: updated.email, first_name: updated.first_name } : undefined,
        push: { type: 'security.account_suspended' },
      });
    }

    // Fire audit after response is queued — delta captures what actually changed
    setImmediate(() => {
      const delta: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of ['first_name', 'last_name', 'status', 'org_id'] as const) {
        if (target[f] !== updated[f]) delta[f] = { from: target[f], to: updated[f] };
      }
      const beforeRoles = target.user_roles.map((ur) => ur.role.slug).sort();
      const afterRoles  = updated.user_roles.map((ur) => ur.role.slug).sort();
      if (JSON.stringify(beforeRoles) !== JSON.stringify(afterRoles)) {
        delta['roles'] = { from: beforeRoles, to: afterRoles };
      }
      publishAudit({
        actor_id: requestingUser.id,
        action: 'update',
        resource: 'User',
        resource_id: targetId,
        ...(Object.keys(delta).length > 0 ? { delta } : {}),
      });
    });

    return serializeUserFullProfile(updated, isAdmin);
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/:id — soft delete + blacklist
  // ---------------------------------------------------------------------------

  async deleteUser(requestingUser: AuthenticatedUser, targetId: string): Promise<void> {
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target || target.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    // Org-scoped admins (org_admin) may only delete users within their own org
    const isAdmin = requestingUser.role_slugs.some((r) => ['katisha_super_admin', 'katisha_admin'].includes(r));
    if (!isAdmin && requestingUser.org_id && target.org_id !== requestingUser.org_id) {
      throw new AppError('FORBIDDEN', 403);
    }

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

    publishAudit({ actor_id: requestingUser.id, action: 'delete', resource: 'User', resource_id: targetId });
  },

  // ---------------------------------------------------------------------------
  // POST /users/invite
  // ---------------------------------------------------------------------------

  async inviteUser(
    requestingUser: AuthenticatedUser,
    data: { email?: string; phone_number?: string; first_name: string; last_name: string; role_slug: string; org_id?: string },
  ): Promise<{ invite_token: string; expires_at: Date }> {
    const isOrgAdmin = requestingUser.role_slugs.includes('org_admin');

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

    const inviteLink = `${config.appUrl}/accept-invite?token=${rawToken}`;
    const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (data.phone_number) {
      publishSms({
        type: 'invite.sms',
        phone_number: data.phone_number,
        first_name: data.first_name,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
      });
    }
    if (data.email) {
      publishMail({
        type: 'invite.mail',
        email: data.email,
        first_name: data.first_name,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
      });
    }
    publishAudit({ actor_id: requestingUser.id, action: 'invite', resource: 'User', resource_id: requestingUser.id });

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
          phone_number: invitation.phone_number!,
          password_hash,
          user_type: 'staff',
          status: 'active',
          org_id: invitation.org_id ?? null,
          notif_channel: 'all',  // staff receive on all channels by default
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

    // Welcome notifications for the newly created staff user
    publishSms({ type: 'welcome.sms', phone_number: user.phone_number, first_name: user.first_name });
    if (user.email) {
      publishMail({ type: 'welcome.mail', email: user.email, first_name: user.first_name });
    }
    publishAudit({ actor_id: user.id, action: 'accept_invite', resource: 'User', resource_id: user.id });

    return { user };
  },

  // ---------------------------------------------------------------------------
  // POST /users/me/validate-password
  // Verifies the user's current password — used as a gate before changing it.
  // ---------------------------------------------------------------------------

  async validatePassword(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password_hash) throw new AppError('INVALID_CREDENTIALS', 401);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) throw new AppError('INVALID_CREDENTIALS', 401);
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/me/2fa — enable or disable two-factor authentication
  // ---------------------------------------------------------------------------

  async toggle2fa(userId: string, enabled: boolean): Promise<{ two_factor_enabled: boolean }> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { two_factor_enabled: enabled },
    });

    const eventType = enabled ? 'security.2fa_enabled' : 'security.2fa_disabled';
    notifyUser(user, {
      sms: { type: eventType, phone_number: user.phone_number, first_name: user.first_name },
      mail: user.email ? { type: eventType, email: user.email, first_name: user.first_name } : undefined,
      push: { type: eventType },
    });

    setImmediate(() => publishAudit({
      actor_id: userId,
      action: enabled ? '2fa_enabled' : '2fa_disabled',
      resource: 'User',
      resource_id: userId,
      delta: { two_factor_enabled: { from: !enabled, to: enabled } },
    }));
    return { two_factor_enabled: user.two_factor_enabled };
  },
};
