import { prisma } from '../models/index.js';
import type { Prisma, AuthenticatedUser, UserWithRoles } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { getRedisClient } from '../loaders/redis.js';
import { serializeUserMe, serializeUserForList, serializeUserFullProfile, serializeInvitationFull, maskPhone } from '../models/serializers.js';
import { subject } from '@casl/ability';
import {
  buildRulesFromGrants,
  accessibleWhere,
  buildAbilityFromRules,
  getScopeFor,
  isValidPattern,
  canAssignGrants,
  compressPatterns,
} from '../utils/ability.js';
import type { Subjects } from '../utils/ability.js';
import { PERMISSIONS } from '../utils/catalog.js';
import { generateRawToken, hashToken, hashPassword, verifyPassword } from '../utils/crypto.js';
import { issueSudoToken } from '../utils/sudoToken.js';
import type { SudoAction } from '../utils/sudoToken.js';
import { clearSudoRateLimit } from '../middleware/rateLimiter.js';
import { publishAudit, publishSms, publishMail, notifyUser, publishUserEvent, publishUserDomainEvent, publishInvitationEvent } from '../utils/publishers.js';
import { OtpService } from './otp.service.js';
import { TokenService } from './token.service.js';
import type { ClientType } from './token.service.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';
import { config } from '../config/index.js';
import { deleteFromS3 } from '../utils/s3.js';
import { displayPhone } from '../utils/phone.js';

const withRoles = {
  include: {
    user_roles: { include: { role: { include: { role_grants: true } } } },
    user_grants: true,
  },
} as const;

// 15-minute blacklist window (matches access token TTL)
const BLACKLIST_TTL_SECONDS = 900;

// PII scrub applied on account deletion. email/phone are nullable + unique-per-type,
// so nulling them frees the slots for re-registration. avatar binary is deleted
// separately (deleteFromS3). The row itself is retained for referential integrity.
const anonymizedUserFields = {
  first_name: 'Deleted',
  last_name: 'User',
  email: null,
  phone_number: null,
  avatar_path: null,
  driver_license_number: null,
} as const;

// A grant pattern is org-scoped when its scope segment is `org` (subject:action:org).
// Such grants need an org context, so any invitation that carries one — whether from
// a role or a direct grant — must be tied to an org_id, else it bakes to
// { org_id: null } at accept time and matches nothing.
const hasOrgScopedPattern = (patterns: string[]): boolean => patterns.some((p) => p.endsWith(':org'));

// The grant that marks a platform super-admin. Used to guard against removing
// the last one — identified by the *grant*, never by a role slug/name.
const PLATFORM_ADMIN_PATTERN = '*:*:platform';

const holdsPlatformAdmin = (user: UserWithRoles): boolean =>
  user.user_roles.some((ur) => ur.role.role_grants.some((g) => g.pattern === PLATFORM_ADMIN_PATTERN)) ||
  user.user_grants.some((g) => g.pattern === PLATFORM_ADMIN_PATTERN);

/**
 * Throw LAST_PLATFORM_ADMIN if `target` is a platform admin and no other active
 * platform admin remains. Guards delete / suspend / role-removal so the platform
 * can never be locked out of administration.
 */
const assertNotLastPlatformAdmin = async (target: UserWithRoles): Promise<void> => {
  if (!holdsPlatformAdmin(target)) return;
  const others = await prisma.user.count({
    where: {
      id: { not: target.id },
      deleted_at: null,
      status: 'active',
      OR: [
        { user_roles: { some: { role: { role_grants: { some: { pattern: PLATFORM_ADMIN_PATTERN } } } } } },
        { user_grants: { some: { pattern: PLATFORM_ADMIN_PATTERN } } },
      ],
    },
  });
  if (others === 0) throw new AppError('LAST_PLATFORM_ADMIN', 409);
};

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
    data: {
      first_name?: string;
      last_name?: string;
      phone_number?: string;
      email?: string;
      avatar_path?: string | null;
      notif_channel?: string[];
      locale?: string;
      two_factor_enabled?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    // Fetch current user when we need to compare before/after state
    const needsCurrent =
      data.phone_number !== undefined ||
      data.email !== undefined ||
      data.two_factor_enabled !== undefined ||
      'avatar_path' in data ||
      data.first_name !== undefined ||
      data.last_name !== undefined;
    const current = needsCurrent
      ? await prisma.user.findUniqueOrThrow({
          where: { id: requestingUser.id },
          select: { login_channel: true, two_factor_enabled: true, avatar_path: true, first_name: true, last_name: true },
        })
      : null;

    // Changing phone/email while it is the active login channel must go
    // through the login-channel-change flow — not a simple profile patch.
    if (data.phone_number !== undefined && current!.login_channel === 'phone') {
      throw new AppError('LOGIN_CHANNEL_CHANGE_REQUIRED', 422);
    }
    if (data.email !== undefined && current!.login_channel === 'email') {
      throw new AppError('LOGIN_CHANNEL_CHANGE_REQUIRED', 422);
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (data.first_name !== undefined) updateData.first_name = data.first_name;
    if (data.last_name !== undefined) updateData.last_name = data.last_name;
    if (data.phone_number !== undefined) updateData.phone_number = data.phone_number;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.avatar_path !== undefined) updateData.avatar_path = data.avatar_path;
    if (data.notif_channel !== undefined) updateData.notif_channel = data.notif_channel;
    if (data.locale !== undefined) updateData.locale = data.locale;
    if (data.two_factor_enabled !== undefined) updateData.two_factor_enabled = data.two_factor_enabled;

    const user = await prisma.user.update({
      where: { id: requestingUser.id },
      data: updateData,
      ...withRoles,
    });

    // Notify and audit when 2FA state changes
    if (data.two_factor_enabled !== undefined && current!.two_factor_enabled !== data.two_factor_enabled) {
      const eventType = data.two_factor_enabled ? 'security.2fa_enabled' : 'security.2fa_disabled';
      notifyUser(user, {
        sms: user.phone_number ? { type: eventType, phone_number: user.phone_number, first_name: user.first_name } : undefined,
        mail: user.email ? { type: eventType, email: user.email, first_name: user.first_name } : undefined,
        push: { type: eventType },
      });
      setImmediate(() => publishAudit({
        actor_id: requestingUser.id,
        action: data.two_factor_enabled ? '2fa_enabled' : '2fa_disabled',
        resource: 'User',
        resource_id: requestingUser.id,
        delta: { two_factor_enabled: { from: current!.two_factor_enabled, to: data.two_factor_enabled } },
      }));
    }

    if ('avatar_path' in data && current?.avatar_path) deleteFromS3(current.avatar_path);

    if (user.user_type === 'staff' && current) {
      const nameChanged = (data.first_name !== undefined && current.first_name !== user.first_name) ||
                          (data.last_name !== undefined && current.last_name !== user.last_name);
      const avatarChanged = data.avatar_path !== undefined && current.avatar_path !== user.avatar_path;
      if (nameChanged || avatarChanged) {
        publishUserEvent({
          type: 'staff.updated',
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          avatar_path: user.avatar_path,
          org_id: user.org_id,
          roles: user.user_roles.map((ur) => ur.role.slug),
          status: user.status,
          updated_at: user.updated_at.toISOString(),
        });
      }
    }

    const patterns = [...user.user_roles.flatMap(ur => ur.role.role_grants.map(g => g.pattern)), ...user.user_grants.map(g => g.pattern)];
    const rules = buildRulesFromGrants(patterns, user.id, user.org_id, PERMISSIONS);
    return serializeUserMe(user, rules) as unknown as Record<string, unknown>;
  },

  // ---------------------------------------------------------------------------
  // GET /users — list (admin / org_admin)
  // ---------------------------------------------------------------------------

  async listUsers(
    requestingUser: AuthenticatedUser,
    query: { page?: number; limit?: number; status?: string; user_type?: string; org_id?: string; role?: string[]; q?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const scope = getScopeFor(ability, 'read', 'User');

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));
    const skip = (page - 1) * limit;

    // The own/org/platform boundary is derived straight from the caller's rules
    // (conditions were baked in at login) — no manual org_id/id branching here.
    const filters: Prisma.UserWhereInput[] = [
      accessibleWhere(ability, 'read', 'User'),
      { status: { not: 'deleted' } },
    ];

    if (query.org_id) filters.push({ org_id: query.org_id });
    if (query.status) filters.push({ status: query.status as Prisma.EnumUserStatusFieldUpdateOperationsInput['set'] });
    if (query.user_type) filters.push({ user_type: query.user_type as Prisma.EnumUserTypeFieldUpdateOperationsInput['set'] });
    if (query.role?.length) filters.push({ user_roles: { some: { role: { slug: { in: query.role } } } } });
    if (query.q) {
      const q = query.q;
      filters.push({ OR: [
        { first_name:   { contains: q, mode: 'insensitive' } },
        { last_name:    { contains: q, mode: 'insensitive' } },
        { email:        { contains: q, mode: 'insensitive' } },
        { phone_number: { contains: q, mode: 'insensitive' } },
      ]});
    }

    const where: Prisma.UserWhereInput = { AND: filters };

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' }, ...withRoles }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => serializeUserForList(u, scope)),
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
    const ability = buildAbilityFromRules(requestingUser.rules);

    const user = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    // Object-level scope is enforced by CASL against the record's own fields
    // (id / org_id) using conditions baked into the JWT — no manual org/self branching.
    if (!ability.can('read', subject('User', user) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    return serializeUserFullProfile(user);
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/:id
  // ---------------------------------------------------------------------------

  async updateUser(
    requestingUser: AuthenticatedUser,
    targetId: string,
    data: { first_name?: string; last_name?: string; avatar_path?: string | null; status?: string; org_id?: string; role_slugs?: string[] },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);

    const target = await prisma.user.findUnique({
      where: { id: targetId, deleted_at: null },
      ...withRoles,
    });
    if (!target) throw new AppError('USER_NOT_FOUND', 404);

    // Object-level scope enforced by CASL against the record (id / org_id).
    if (!ability.can('update', subject('User', target) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    // Role assignment lives in its own endpoint (assignRoles) — ignore role_slugs here.
    const { first_name, last_name, status, org_id } = data;

    // Suspending/deactivating must not lock out the last platform admin.
    if (status !== undefined && status !== 'active') {
      await assertNotLastPlatformAdmin(target);
    }

    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (data.avatar_path !== undefined) updateData.avatar_path = data.avatar_path as string | null;
    if (status !== undefined) updateData.status = status as Prisma.EnumUserStatusFieldUpdateOperationsInput['set'];
    if (org_id !== undefined) updateData.org_id = org_id;

    if (data.avatar_path !== undefined && data.avatar_path !== target.avatar_path && target.avatar_path) {
      deleteFromS3(target.avatar_path);
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      ...withRoles,
    });

    // Notify the target user if their account was suspended
    if (data.status === 'suspended') {
      // Kill in-flight access tokens immediately (refresh is already blocked for
      // suspended users at rotation; this closes the 15-min access-token window).
      try {
        await getRedisClient().set(`blacklist:user:${targetId}`, '1', 'EX', BLACKLIST_TTL_SECONDS);
      } catch (err) {
        console.error('[user] Failed to set blacklist entry on suspend', err);
      }

      notifyUser(updated, {
        sms: updated.phone_number ? { type: 'security.account_suspended', phone_number: updated.phone_number, first_name: updated.first_name } : undefined,
        mail: updated.email ? { type: 'security.account_suspended', email: updated.email, first_name: updated.first_name } : undefined,
        push: { type: 'security.account_suspended' },
      });
    }

    // Fire audit and domain events after response is queued
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

      if (updated.user_type === 'staff') {
        if (data.status === 'suspended') {
          publishUserEvent({ type: 'staff.suspended', id: updated.id, org_id: updated.org_id, status: 'suspended' });
        }

        const nameChanged = (data.first_name !== undefined && target.first_name !== updated.first_name) ||
                            (data.last_name !== undefined && target.last_name !== updated.last_name);
        const avatarChanged = data.avatar_path !== undefined && target.avatar_path !== updated.avatar_path;
        const rolesChanged = JSON.stringify(beforeRoles) !== JSON.stringify(afterRoles);
        const statusChanged = data.status !== undefined && target.status !== updated.status;
        if (nameChanged || avatarChanged || rolesChanged || statusChanged) {
          publishUserEvent({
            type: 'staff.updated',
            id: updated.id,
            first_name: updated.first_name,
            last_name: updated.last_name,
            avatar_path: updated.avatar_path,
            org_id: updated.org_id,
            roles: updated.user_roles.map((ur) => ur.role.slug),
            status: updated.status,
            updated_at: updated.updated_at.toISOString(),
          });
        }
      }
    });

    return serializeUserFullProfile(updated);
  },

  // ---------------------------------------------------------------------------
  // PUT /users/:id/roles — replace a user's roles
  // ---------------------------------------------------------------------------

  async assignRoles(
    requestingUser: AuthenticatedUser,
    targetUserId: string,
    roleSlugs: string[],
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('assign_role', 'User')) throw new AppError('FORBIDDEN', 403);

    const target = await prisma.user.findUnique({ where: { id: targetUserId, deleted_at: null }, ...withRoles });
    if (!target) throw new AppError('USER_NOT_FOUND', 404);

    // Object-level scope: org-scoped assigners only reach users in their own org.
    if (!ability.can('assign_role', subject('User', target) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    // Resolve each slug to a role visible to the target (org-specific wins over global).
    const resolved = await Promise.all(
      roleSlugs.map((slug) =>
        prisma.role.findFirst({
          where: { slug, OR: [{ org_id: target.org_id ?? null }, { org_id: null }] },
          orderBy: { org_id: 'asc' }, // non-null (org-specific) sorts first
          include: { role_grants: true },
        }),
      ),
    );
    for (const r of resolved) if (!r) throw new AppError('ROLE_NOT_FOUND', 404);
    const uniqueRoles = Array.from(
      new Map((resolved as NonNullable<typeof resolved[0]>[]).map((r) => [r.id, r])).values(),
    );

    // Escalation guard: you can only assign roles whose grants you already hold.
    const grantPatterns = uniqueRoles.flatMap((r) => r.role_grants.map((g) => g.pattern));
    if (!canAssignGrants(ability, grantPatterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    // Removing a user's last admin powers must not lock out the platform.
    const losesAdmin = holdsPlatformAdmin(target) &&
      !uniqueRoles.some((r) => r.role_grants.some((g) => g.pattern === PLATFORM_ADMIN_PATTERN));
    if (losesAdmin) await assertNotLastPlatformAdmin(target);

    const beforeRoles = target.user_roles.map((ur) => ur.role.slug).sort();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { user_id: targetUserId } });
      await tx.userRole.createMany({ data: uniqueRoles.map((r) => ({ user_id: targetUserId, role_id: r.id })) });
      return tx.user.findUniqueOrThrow({ where: { id: targetUserId }, ...withRoles });
    });

    const afterRoles = updated.user_roles.map((ur) => ur.role.slug).sort();

    setImmediate(() => {
      publishAudit({
        actor_id: requestingUser.id,
        action: 'update',
        resource: 'User',
        resource_id: targetUserId,
        delta: { roles: { from: beforeRoles, to: afterRoles } },
      });
      if (updated.user_type === 'staff') {
        publishUserEvent({
          type: 'staff.updated',
          id: updated.id,
          first_name: updated.first_name,
          last_name: updated.last_name,
          avatar_path: updated.avatar_path,
          org_id: updated.org_id,
          roles: afterRoles,
          status: updated.status,
          updated_at: updated.updated_at.toISOString(),
        });
      }
    });

    return serializeUserFullProfile(updated);
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/:id — soft delete + blacklist
  // ---------------------------------------------------------------------------

  async deleteUser(requestingUser: AuthenticatedUser, targetId: string): Promise<void> {
    const target = await prisma.user.findUnique({ where: { id: targetId }, ...withRoles });
    if (!target || target.status === 'deleted' || target.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    const ability = buildAbilityFromRules(requestingUser.rules);
    // Object-level scope enforced by CASL against the record (id / org_id).
    if (!ability.can('delete', subject('User', target) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    // Never delete the last platform admin.
    await assertNotLastPlatformAdmin(target);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: targetId },
        // Soft delete + anonymize PII (right-to-erasure): the row is retained for
        // referential integrity (tickets/audit) but identifying fields are scrubbed.
        // Nulling email/phone also frees their unique slots for re-registration.
        data: { status: 'pending_deletion', deleted_at: new Date(), ...anonymizedUserFields },
      }),
      // Revoke all refresh tokens
      prisma.refreshToken.updateMany({
        where: { user_id: targetId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    // Delete the avatar binary (the row is kept; the file is not). Fire-and-forget.
    if (target.avatar_path) deleteFromS3(target.avatar_path, 'public');

    // Blacklist active access tokens for TTL window
    try {
      await getRedisClient().set(`blacklist:user:${targetId}`, '1', 'EX', BLACKLIST_TTL_SECONDS);
    } catch (err) {
      console.error('[user] Failed to set blacklist entry', err);
    }

    const deletedAt = new Date();
    publishAudit({ actor_id: requestingUser.id, action: 'delete', resource: 'User', resource_id: targetId });

    if (target.user_type === 'staff') {
      publishUserEvent({
        type: 'staff.deleted',
        id: targetId,
        org_id: target.org_id,
        deleted_at: deletedAt.toISOString(),
      });
    }
  },

  // ---------------------------------------------------------------------------
  // POST /users/invite
  // ---------------------------------------------------------------------------

  async inviteUser(
    requestingUser: AuthenticatedUser,
    data: { email?: string; phone_number?: string; first_name: string; last_name: string; role_slugs: string[]; org_id?: string; locale?: string },
  ): Promise<{ invite_token: string; expires_at: Date }> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const platform = getScopeFor(ability, 'invite', 'User') === 'platform';

    const org_id = platform ? (data.org_id ?? null) : requestingUser.org_id!;

    if (!data.email && !data.phone_number) throw new AppError('VALIDATION_ERROR', 422);

    // Reject if a staff user or pending staff invitation already exists for the contact
    const now = new Date();
    const [phoneExists, emailExists, phoneInvited, emailInvited] = await Promise.all([
      data.phone_number
        ? prisma.user.findUnique({ where: { phone_number_user_type: { phone_number: data.phone_number, user_type: 'staff' } }, select: { id: true } })
        : null,
      data.email
        ? prisma.user.findUnique({ where: { email_user_type: { email: data.email, user_type: 'staff' } }, select: { id: true } })
        : null,
      data.phone_number
        ? prisma.invitation.findFirst({ where: { phone_number: data.phone_number, expires_at: { gt: now } }, select: { id: true } })
        : null,
      data.email
        ? prisma.invitation.findFirst({ where: { email: data.email, expires_at: { gt: now } }, select: { id: true } })
        : null,
    ]);
    if (phoneExists || phoneInvited) throw new AppError('PHONE_ALREADY_REGISTERED', 409);
    if (emailExists || emailInvited) throw new AppError('EMAIL_ALREADY_REGISTERED', 409);

    if (org_id) {
      const org = await prisma.org.findUnique({ where: { id: org_id, deleted_at: null }, select: { status: true } });
      if (!org) throw new AppError('ORG_NOT_FOUND', 404);
      if (org.status !== 'active') throw new AppError('ORG_NOT_ACTIVE', 400);
    }

    // Resolve each slug — prefer org-specific over global template.
    const roleResults = await Promise.all(
      data.role_slugs.map((slug) =>
        prisma.role.findFirst({
          where: { slug, OR: [{ org_id: org_id ?? null }, { org_id: null }] },
          orderBy: { org_id: 'asc' }, // non-null sorts first → org-specific wins
          include: { role_grants: true },
        }),
      ),
    );
    for (const role of roleResults) {
      if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
    }
    // Deduplicate by ID (two slugs might resolve to the same role after org-specific fallback)
    const uniqueRoles = Array.from(
      new Map((roleResults as NonNullable<typeof roleResults[0]>[]).map((r) => [r.id, r])).values(),
    );

    // Escalation guard (fixes invite→platform-admin hole): the inviter may only
    // attach roles whose grants they already hold. Passenger and platform-admin
    // are naturally excluded for an org admin because they lack those grants —
    // no slug special-casing.
    const invitedGrantPatterns = uniqueRoles.flatMap((r) => r.role_grants.map((g) => g.pattern));
    if (!canAssignGrants(ability, invitedGrantPatterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    // Org-scoped grants need an org context. A platform inviter may invite with no
    // org, but only when none of the assigned grants are org-scoped.
    // (Non-platform inviters always have their own org_id, so this never trips them.)
    if (hasOrgScopedPattern(invitedGrantPatterns) && !org_id) {
      throw new AppError('ORG_REQUIRED_FOR_ORG_SCOPED_ROLE', 400);
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const locale = (data.locale as 'rw' | 'en' | 'fr' | undefined) ?? 'rw';

    const invitation = await prisma.invitation.create({
      data: {
        email: data.email ?? null,
        phone_number: data.phone_number ?? null,
        first_name: data.first_name,
        last_name: data.last_name,
        org_id,
        invited_by: requestingUser.id,
        locale: data.locale ?? null,
        token_hash: tokenHash,
        expires_at: expiresAt,
        invitation_roles: {
          create: uniqueRoles.map((r) => ({ role_id: r.id })),
        },
      },
    });

    const inviteLink = `${config.appUrl}/i?t=${rawToken}`;
    const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    const inviter = await prisma.user.findUnique({
      where: { id: requestingUser.id },
      select: { first_name: true, last_name: true },
    });
    const invited_by = inviter ? `${inviter.first_name} ${inviter.last_name}` : 'Katisha';

    if (data.phone_number) {
      publishSms({
        type: 'invite.sms',
        phone_number: data.phone_number,
        first_name: data.first_name,
        invited_by,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
        locale,
      });
    }
    if (data.email) {
      publishMail({
        type: 'invite.mail',
        email: data.email,
        first_name: data.first_name,
        invited_by,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
        locale,
      });
    }
    publishInvitationEvent({
      type: 'invitation.created',
      invitation_id: invitation.id,
      org_id: org_id,
      email: data.email ?? null,
      phone_number: data.phone_number ?? null,
      invited_by: requestingUser.id,
      expires_at: expiresAt.toISOString(),
    });

    publishAudit({ actor_id: requestingUser.id, action: 'invite', resource: 'User', resource_id: requestingUser.id });

    return { invite_token: rawToken, expires_at: expiresAt };
  },

  // ---------------------------------------------------------------------------
  // POST /users/accept-invite
  // ---------------------------------------------------------------------------

  async acceptInvite(
    token: string,
    password: string,
  ): Promise<{ user_id: string; channels: ('phone' | 'email')[] }> {
    const tokenHash = hashToken(token);

    const invitation = await prisma.invitation.findUnique({
      where: { token_hash: tokenHash },
      include: {
        invitation_roles: { include: { role: { select: { slug: true } } } },
        invitation_grants: true,
      },
    });
    // Accepted invitations are deleted (see below), so a missing row means
    // invalid, already-used, or revoked — all indistinguishable by design.
    if (!invitation) throw new AppError('INVALID_TOKEN', 400);
    if (invitation.expires_at < new Date()) throw new AppError('TOKEN_EXPIRED', 410);

    if (invitation.org_id) {
      const org = await prisma.org.findUnique({ where: { id: invitation.org_id }, select: { status: true } });
      if (!org || org.status !== 'active') throw new AppError('ORG_NOT_ACTIVE', 403);
    }

    // Check for conflicting staff registrations before attempting the create
    const [phoneConflict, emailConflict] = await Promise.all([
      invitation.phone_number
        ? prisma.user.findUnique({ where: { phone_number_user_type: { phone_number: invitation.phone_number, user_type: 'staff' } }, select: { id: true } })
        : null,
      invitation.email
        ? prisma.user.findUnique({ where: { email_user_type: { email: invitation.email, user_type: 'staff' } }, select: { id: true } })
        : null,
    ]);
    if (phoneConflict) throw new AppError('PHONE_ALREADY_REGISTERED', 409);
    if (emailConflict) throw new AppError('EMAIL_ALREADY_REGISTERED', 409);

    const password_hash = await hashPassword(password);
    const locale = (invitation.locale as 'rw' | 'en' | 'fr' | null) ?? 'rw';

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          first_name: invitation.first_name,
          last_name: invitation.last_name,
          email: invitation.email ?? null,
          phone_number: invitation.phone_number!,
          password_hash,
          user_type: 'staff',
          status: 'pending_verification',
          org_id: invitation.org_id ?? null,
          notif_channel: invitation.email ? ['sms', 'email', 'app'] : ['sms', 'app'],
          locale,
        },
      });
      if (invitation.invitation_roles.length > 0) {
        await tx.userRole.createMany({
          data: invitation.invitation_roles.map((ir) => ({ user_id: created.id, role_id: ir.role_id })),
          skipDuplicates: true,
        });
      }
      // Materialise the invitation's direct grants onto the new user. They were
      // escalation-checked when set on the invitation, so they are trusted here.
      if (invitation.invitation_grants.length > 0) {
        await tx.userGrant.createMany({
          data: invitation.invitation_grants.map((g) => ({ user_id: created.id, pattern: g.pattern })),
          skipDuplicates: true,
        });
      }
      // Consume the invitation entirely — cascade drops invitation_roles +
      // invitation_grants. There is no "accepted" tombstone; the invite is gone.
      await tx.invitation.delete({ where: { token_hash: tokenHash } });
      return created;
    });

    const unverifiedChannels: ('phone' | 'email')[] = [];

    if (user.phone_number) {
      const { code: phoneCode, expiresIn } = await OtpService.create(user.id, 'phone_verification');
      publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number, code: phoneCode, expires_in_seconds: expiresIn, locale });
      unverifiedChannels.push('phone');
    }

    if (user.email) {
      const { code: emailCode, expiresIn } = await OtpService.create(user.id, 'email_verification');
      publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email, first_name: user.first_name, code: emailCode, expires_in_seconds: expiresIn, locale });
      unverifiedChannels.push('email');
    }

    publishInvitationEvent({
      type: 'invitation.accepted',
      invitation_id: invitation.id,
      org_id: invitation.org_id,
      user_id: user.id,
    });

    publishAudit({ actor_id: user.id, action: 'accept_invite', resource: 'User', resource_id: user.id });

    return { user_id: user.id, channels: unverifiedChannels };
  },

  // ---------------------------------------------------------------------------
  // GET /auth/invite/validate — token pre-check (public, frontend pre-check)
  // ---------------------------------------------------------------------------

  async validateInviteToken(token: string): Promise<{
    valid: true;
    first_name: string;
    channels: ('phone' | 'email')[];
    masked_phone: string | null;
    masked_email: string | null;
  }> {
    const tokenHash = hashToken(token);

    const invitation = await prisma.invitation.findUnique({ where: { token_hash: tokenHash } });
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);
    if (invitation.expires_at < new Date()) throw new AppError('INVITE_EXPIRED', 410);

    const maskPhone = (phone: string) => '+' + phone.slice(0, 3) + phone.slice(3, 6) + '***' + phone.slice(-3);
    const maskEmail = (email: string) => {
      const [local, domain] = email.split('@');
      return local.slice(0, 2) + '***@' + domain;
    };

    return {
      valid: true,
      first_name: invitation.first_name,
      channels: [
        ...(invitation.phone_number ? ['phone' as const] : []),
        ...(invitation.email ? ['email' as const] : []),
      ],
      masked_phone: invitation.phone_number ? maskPhone(invitation.phone_number) : null,
      masked_email: invitation.email ? maskEmail(invitation.email) : null,
    };
  },

  // ---------------------------------------------------------------------------
  // GET /users/invitations — list pending invitations
  // ---------------------------------------------------------------------------

  async listInvitations(
    requestingUser: AuthenticatedUser,
    query: { page?: number; limit?: number; org_id?: string; q?: string },
  ): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const ability = buildAbilityFromRules(requestingUser.rules);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 12));
    const skip = (page - 1) * limit;

    // Org boundary comes from the caller's Invitation rule conditions.
    // No accepted-state filter needed — accepted invitations are deleted on accept.
    const filters: Prisma.InvitationWhereInput[] = [
      accessibleWhere(ability, 'read', 'Invitation') as Prisma.InvitationWhereInput,
    ];

    if (query.org_id) filters.push({ org_id: query.org_id });
    if (query.q) {
      const q = query.q;
      filters.push({ OR: [
        { first_name:   { contains: q, mode: 'insensitive' } },
        { last_name:    { contains: q, mode: 'insensitive' } },
        { email:        { contains: q, mode: 'insensitive' } },
        { phone_number: { contains: q, mode: 'insensitive' } },
      ]});
    }

    const where: Prisma.InvitationWhereInput = { AND: filters };

    const [invitations, total] = await Promise.all([
      prisma.invitation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { invitation_roles: { include: { role: { select: { slug: true } } } } },
      }),
      prisma.invitation.count({ where }),
    ]);

    return {
      data: invitations.map((inv) => ({
        id: inv.id,
        first_name: inv.first_name,
        last_name: inv.last_name,
        email: inv.email,
        phone_number: inv.phone_number,
        role_slugs: inv.invitation_roles.map((ir) => ir.role.slug),
        org_id: inv.org_id,
        invited_by: inv.invited_by,
        expires_at: inv.expires_at,
        expired: inv.expires_at < new Date(),
        created_at: inv.created_at,
      })),
      total,
      page,
      limit,
    };
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/invitations/:id — update a pending invitation
  // ---------------------------------------------------------------------------

  async updateInvitation(
    requestingUser: AuthenticatedUser,
    invitationId: string,
    data: { first_name?: string; last_name?: string; email?: string; phone_number?: string; role_slugs?: string[]; locale?: string },
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const hasPlatformScope = getScopeFor(ability, 'invite', 'User') === 'platform';

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    // Accepted invitations are deleted on accept, so absence === gone (accepted/revoked/invalid).
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);

    if (!hasPlatformScope && invitation.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    // Check phone/email conflicts against users only if the value is being changed
    const [phoneConflict, emailConflict] = await Promise.all([
      data.phone_number && data.phone_number !== invitation.phone_number
        ? prisma.user.findUnique({ where: { phone_number_user_type: { phone_number: data.phone_number, user_type: 'staff' } }, select: { id: true } })
        : null,
      data.email && data.email !== invitation.email
        ? prisma.user.findUnique({ where: { email_user_type: { email: data.email, user_type: 'staff' } }, select: { id: true } })
        : null,
    ]);
    if (phoneConflict) throw new AppError('PHONE_ALREADY_REGISTERED', 409);
    if (emailConflict) throw new AppError('EMAIL_ALREADY_REGISTERED', 409);

    // Resolve new roles if provided
    let uniqueRoles: { id: string }[] | null = null;
    if (data.role_slugs) {
      const roleResults = await Promise.all(
        data.role_slugs.map((slug) =>
          prisma.role.findFirst({
            where: { slug, OR: [{ org_id: invitation.org_id ?? null }, { org_id: null }] },
            orderBy: { org_id: 'asc' },
            include: { role_grants: true },
          }),
        ),
      );
      for (const role of roleResults) {
        if (!role) throw new AppError('ROLE_NOT_FOUND', 404);
      }
      const resolved = Array.from(
        new Map((roleResults as NonNullable<typeof roleResults[0]>[]).map((r) => [r.id, r])).values(),
      );

      // Escalation guard — same rule as invite/assign: only grants you hold.
      const grantPatterns = resolved.flatMap((r) => r.role_grants.map((g) => g.pattern));
      if (!canAssignGrants(ability, grantPatterns, PERMISSIONS)) {
        throw new AppError('GRANT_SCOPE_ESCALATION', 403);
      }
      // An org-less invitation may not take on org-scoped roles (org_id is immutable
      // after creation, so there is no org context to bind them to).
      if (hasOrgScopedPattern(grantPatterns) && !invitation.org_id) {
        throw new AppError('ORG_REQUIRED_FOR_ORG_SCOPED_ROLE', 400);
      }
      uniqueRoles = resolved;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (uniqueRoles !== null) {
        await tx.invitationRole.deleteMany({ where: { invitation_id: invitationId } });
        if (uniqueRoles.length > 0) {
          await tx.invitationRole.createMany({
            data: uniqueRoles.map((r) => ({ invitation_id: invitationId, role_id: r.id })),
          });
        }
      }
      return tx.invitation.update({
        where: { id: invitationId },
        data: {
          first_name: data.first_name ?? invitation.first_name,
          last_name: data.last_name ?? invitation.last_name,
          email: data.email !== undefined ? (data.email ?? null) : invitation.email,
          phone_number: data.phone_number !== undefined ? (data.phone_number ?? null) : invitation.phone_number,
          locale: data.locale ?? invitation.locale,
        },
        include: { invitation_roles: { include: { role: { select: { slug: true } } } } },
      });
    });

    publishAudit({ actor_id: requestingUser.id, action: 'update', resource: 'Invitation', resource_id: invitationId });

    return {
      id: updated.id,
      first_name: updated.first_name,
      last_name: updated.last_name,
      email: updated.email,
      phone_number: updated.phone_number,
      role_slugs: updated.invitation_roles.map((ir) => ir.role.slug),
      org_id: updated.org_id,
      expires_at: updated.expires_at,
      expired: updated.expires_at < new Date(),
      created_at: updated.created_at,
    };
  },

  // ---------------------------------------------------------------------------
  // POST /users/invitations/:id/resend — regenerate token and resend
  // ---------------------------------------------------------------------------

  async resendInvitation(
    requestingUser: AuthenticatedUser,
    invitationId: string,
  ): Promise<{ expires_at: Date }> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const hasPlatformScope = getScopeFor(ability, 'invite', 'User') === 'platform';

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    // Accepted invitations are deleted on accept, so absence === gone (accepted/revoked/invalid).
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);

    if (!hasPlatformScope && invitation.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { token_hash: tokenHash, expires_at: expiresAt },
    });

    const inviteLink = `${config.appUrl}/i?t=${rawToken}`;
    const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    const locale = (invitation.locale as 'rw' | 'en' | 'fr' | null) ?? 'rw';

    const inviter = await prisma.user.findUnique({
      where: { id: requestingUser.id },
      select: { first_name: true, last_name: true },
    });
    const invited_by = inviter ? `${inviter.first_name} ${inviter.last_name}` : 'Katisha';

    if (invitation.phone_number) {
      publishSms({
        type: 'invite.sms',
        phone_number: invitation.phone_number,
        first_name: invitation.first_name,
        invited_by,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
        locale,
      });
    }
    if (invitation.email) {
      publishMail({
        type: 'invite.mail',
        email: invitation.email,
        first_name: invitation.first_name,
        invited_by,
        invite_link: inviteLink,
        expires_in_seconds: expiresInSeconds,
        locale,
      });
    }

    publishInvitationEvent({
      type: 'invitation.resent',
      invitation_id: invitationId,
      org_id: invitation.org_id,
      expires_at: expiresAt.toISOString(),
    });

    publishAudit({ actor_id: requestingUser.id, action: 'resend_invite', resource: 'Invitation', resource_id: invitationId });

    return { expires_at: expiresAt };
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/invitations/:id — revoke a pending invitation
  // ---------------------------------------------------------------------------

  async deleteInvitation(
    requestingUser: AuthenticatedUser,
    invitationId: string,
  ): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const hasPlatformScope = getScopeFor(ability, 'invite', 'User') === 'platform';

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, org_id: true },
    });
    // Accepted invitations are deleted on accept, so absence === gone (accepted/revoked/invalid).
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);

    if (!hasPlatformScope && invitation.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    await prisma.invitation.delete({ where: { id: invitationId } });

    publishAudit({ actor_id: requestingUser.id, action: 'delete', resource: 'Invitation', resource_id: invitationId });
  },

  // ---------------------------------------------------------------------------
  // GET /users/invitations/:id — single invitation detail (incl. direct grants)
  // ---------------------------------------------------------------------------

  async getInvitationById(
    requestingUser: AuthenticatedUser,
    invitationId: string,
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    const hasPlatformScope = getScopeFor(ability, 'invite', 'User') === 'platform';

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      include: {
        invitation_roles: { include: { role: { select: { slug: true } } } },
        invitation_grants: true,
      },
    });
    // Accepted invitations are deleted on accept, so absence === gone (accepted/revoked/invalid).
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);

    if (!hasPlatformScope && invitation.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    return serializeInvitationFull(invitation);
  },

  // ---------------------------------------------------------------------------
  // PUT /users/invitations/:id/grants — replace an invitation's direct grants.
  // These are materialised onto the user when the invite is accepted.
  // ---------------------------------------------------------------------------

  async setInvitationGrants(
    requestingUser: AuthenticatedUser,
    invitationId: string,
    patterns: string[],
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('assign_role', 'User')) throw new AppError('FORBIDDEN', 403);
    const hasPlatformScope = getScopeFor(ability, 'assign_role', 'User') === 'platform';

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, org_id: true },
    });
    if (!invitation) throw new AppError('INVITE_NOT_FOUND', 404);

    if (!hasPlatformScope && invitation.org_id !== requestingUser.org_id) throw new AppError('FORBIDDEN', 403);

    for (const pattern of patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) throw new AppError('INVALID_GRANT_PATTERN', 422);
    }

    // Escalation guard: you can only stage grants you already hold (this also
    // enforces "platform scope hidden from org-admin" — they can't grant it).
    if (!canAssignGrants(ability, patterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    // Direct org-scoped grants need an org context too — block them on an org-less invite.
    if (hasOrgScopedPattern(patterns) && !invitation.org_id) {
      throw new AppError('ORG_REQUIRED_FOR_ORG_SCOPED_ROLE', 400);
    }

    // Replace semantics: the submitted set is the desired full set, compressed.
    const compressed = compressPatterns(patterns, PERMISSIONS);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invitationGrant.deleteMany({ where: { invitation_id: invitationId } });
      if (compressed.length > 0) {
        await tx.invitationGrant.createMany({
          data: compressed.map((p) => ({ invitation_id: invitationId, pattern: p })),
        });
      }
      return tx.invitation.findUniqueOrThrow({
        where: { id: invitationId },
        include: {
          invitation_roles: { include: { role: { select: { slug: true } } } },
          invitation_grants: true,
        },
      });
    });

    publishAudit({
      actor_id: requestingUser.id,
      action: 'update',
      resource: 'Invitation',
      resource_id: invitationId,
      delta: { grants: compressed },
    });

    return serializeInvitationFull(updated);
  },

  // ---------------------------------------------------------------------------
  // POST /users/me/login-channel — request login channel change (sends OTP)
  // POST /users/me/login-channel/confirm — confirm with OTP
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // POST /users/me/login-channel
  //
  // Two modes:
  //   1. Switch mode (no identifier): change login_channel to the other verified channel.
  //      Target must be already verified on the account.
  //   2. Change mode (identifier provided): update the actual phone/email value AND make
  //      it the new login_channel. OTP is sent to the NEW identifier.
  //
  // In both modes a confirmation OTP is sent and pending state is stored in Redis
  // so that /confirm can validate the exact channel + identifier the user agreed to.
  // ---------------------------------------------------------------------------

  async requestLoginChannelChange(
    userId: string,
    channel: 'phone' | 'email',
    identifier?: string,
  ): Promise<{ expires_in: number; masked_identifier: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    const locale = user.locale as 'rw' | 'en' | 'fr';
    const redis = getRedisClient();
    const pendingKey = `pending_login_channel:${userId}`;

    const maskEmail = (email: string) => {
      const [local, domain] = email.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    };

    if (identifier) {
      // ── Change mode: new identifier + make it the login_channel ────────────
      const normIdentifier = identifier;

      // Reject if identifier is already the current value for that channel
      const currentValue = channel === 'email' ? user.email : (user.phone_number ? displayPhone(user.phone_number) : null);
      if (currentValue === normIdentifier || user.phone_number === normIdentifier) {
        throw new AppError('IDENTIFIER_UNCHANGED', 409);
      }

      // Uniqueness check — another account of the same user_type must not own this identifier
      if (channel === 'email') {
        const taken = await prisma.user.findFirst({ where: { email: normIdentifier, user_type: user.user_type, id: { not: userId } } });
        if (taken) throw new AppError('EMAIL_ALREADY_IN_USE', 409);
      } else {
        const taken = await prisma.user.findFirst({ where: { phone_number: normIdentifier, user_type: user.user_type, id: { not: userId } } });
        if (taken) throw new AppError('PHONE_ALREADY_IN_USE', 409);
      }

      const { code, expiresIn } = await OtpService.create(userId, 'login_channel_change');
      await redis.setex(pendingKey, expiresIn, JSON.stringify({ channel, identifier: normIdentifier, mode: 'change' }));

      if (channel === 'email') {
        publishMail({ type: 'otp.mail', purpose: 'email_verification', email: normIdentifier, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
        return { expires_in: expiresIn, masked_identifier: maskEmail(normIdentifier) };
      } else {
        publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: normIdentifier, code, expires_in_seconds: expiresIn, locale });
        return { expires_in: expiresIn, masked_identifier: maskPhone(normIdentifier) };
      }
    }

    // ── Switch mode: change login_channel to the other channel on the account ──
    if (user.login_channel === channel) throw new AppError('ALREADY_ACTIVE_CHANNEL', 409);

    if (channel === 'email') {
      if (!user.email) throw new AppError('EMAIL_NOT_FOUND', 422);

      const { code, expiresIn } = await OtpService.create(userId, 'login_channel_change');
      await redis.setex(pendingKey, expiresIn, JSON.stringify({ channel, identifier: user.email, mode: 'switch' }));
      publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
      return { expires_in: expiresIn, masked_identifier: maskEmail(user.email) };
    }

    // channel === 'phone'
    const { code, expiresIn } = await OtpService.create(userId, 'login_channel_change');
    await redis.setex(pendingKey, expiresIn, JSON.stringify({ channel, identifier: displayPhone(user.phone_number!), mode: 'switch' }));
    publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
    return { expires_in: expiresIn, masked_identifier: maskPhone(user.phone_number!) };
  },

  // ---------------------------------------------------------------------------
  // POST /users/me/login-channel/confirm
  //
  // Verifies the OTP and the exact (channel, identifier) pair that was requested.
  // On success:
  //   - switch mode: updates login_channel only
  //   - change mode: updates the identifier field + login_channel + marks verified
  // ---------------------------------------------------------------------------

  async confirmLoginChannelChange(
    userId: string,
    channel: 'phone' | 'email',
    otp: string,
  ): Promise<{ login_channel: string }> {
    const redis = getRedisClient();
    const pendingKey = `pending_login_channel:${userId}`;

    const raw = await redis.get(pendingKey);
    if (!raw) throw new AppError('NO_PENDING_CHANNEL_CHANGE', 400);

    const pending = JSON.parse(raw) as { channel: string; identifier: string; mode: 'switch' | 'change' };

    if (pending.channel !== channel) throw new AppError('CHANNEL_MISMATCH', 400);

    await OtpService.verify(userId, otp, 'login_channel_change');
    await redis.del(pendingKey);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email_verified_at: true, phone_verified_at: true } });
    const updateData: Prisma.UserUncheckedUpdateInput = { login_channel: channel };

    if (channel === 'email') {
      if (pending.mode === 'change') updateData.email = pending.identifier;
      if (pending.mode === 'change' || !user.email_verified_at) updateData.email_verified_at = new Date();
    } else {
      if (pending.mode === 'change') updateData.phone_number = pending.identifier;
      if (pending.mode === 'change' || !user.phone_verified_at) updateData.phone_verified_at = new Date();
    }

    await prisma.user.update({ where: { id: userId }, data: updateData });

    publishUserDomainEvent({ type: 'user.login_channel_changed', id: userId, login_channel: channel });

    publishAudit({ actor_id: userId, action: 'change_login_channel', resource: 'User', resource_id: userId });

    return { login_channel: channel };
  },

  // ---------------------------------------------------------------------------
  // POST /users/me/validate-password
  // Verifies the caller's password and issues a short-lived action-scoped sudo token.
  // Rate limiting (3 attempts / 15 min) is enforced by sudoRateLimiter middleware
  // before this method runs; on success we clear that counter.
  // ---------------------------------------------------------------------------

  async validatePassword(
    userId: string,
    password: string,
    action: SudoAction,
  ): Promise<{ sudoToken: string; expiresAt: string; expiresIn: 180 }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password_hash) throw new AppError('INVALID_CREDENTIALS', 401);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) throw new AppError('INVALID_CREDENTIALS', 401);

    await clearSudoRateLimit(userId);
    const { token, jti, expiresAt } = await issueSudoToken(userId, action);
    console.warn('[sudo] sudo_token_issued', { userId, jti, expiresAt, action });
    return { sudoToken: token, expiresAt, expiresIn: 180 };
  },

  // ---------------------------------------------------------------------------
  // PATCH /users/me — password branch
  // Changes the caller's password. Caller must have already consumed a sudo token
  // with action 'change_password' before invoking this method.
  // ---------------------------------------------------------------------------

  async changePassword(
    userId: string,
    newPassword: string,
    opts: { device_name?: string; ip_address?: string; user_agent?: string; clientType?: ClientType; reqLocale?: string } = {},
  ): Promise<AuthTokens> {
    const password_hash = await hashPassword(newPassword);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { password_hash },
      ...withRoles,
    });

    // "Sign out everywhere except this device" — kill every existing session
    // (other devices: refresh revoked + access tokens blacklisted) and mint a
    // fresh pair for the current device so the caller stays logged in.
    const tokens = await TokenService.rotateAllSessions(user, {
      device_name: opts.device_name,
      ip_address: opts.ip_address,
      user_agent: opts.user_agent,
      clientType: opts.clientType,
    });

    notifyUser(user, {
      sms: user.phone_number ? { type: 'security.password_changed', phone_number: user.phone_number, first_name: user.first_name } : undefined,
      mail: user.email ? { type: 'security.password_changed', email: user.email, first_name: user.first_name } : undefined,
      push: { type: 'security.password_changed' },
    }, opts.reqLocale);

    publishUserDomainEvent({ type: 'user.password_changed', id: userId, user_type: user.user_type });
    publishAudit({ actor_id: userId, action: 'change_password', resource: 'User', resource_id: userId });

    return tokens;
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/me
  // Soft-deletes the caller's own account. Caller must have already consumed a
  // sudo token with action 'delete_account' before invoking this method.
  // ---------------------------------------------------------------------------

  async deleteSelf(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'deleted' || user.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        // Soft delete + anonymize PII; keep the row, free email/phone unique slots.
        data: { status: 'pending_deletion', deleted_at: new Date(), ...anonymizedUserFields },
      }),
      prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    // Delete the avatar binary (fire-and-forget).
    if (user.avatar_path) deleteFromS3(user.avatar_path, 'public');

    try {
      await getRedisClient().set(`blacklist:user:${userId}`, '1', 'EX', BLACKLIST_TTL_SECONDS);
    } catch (err) {
      console.error('[user] Failed to set blacklist entry on self-delete', err);
    }

    publishAudit({ actor_id: userId, action: 'delete', resource: 'User', resource_id: userId });

    if (user.user_type === 'staff') {
      publishUserEvent({
        type: 'staff.deleted',
        id: userId,
        org_id: user.org_id,
        deleted_at: new Date().toISOString(),
      });
    }
  },

  // ---------------------------------------------------------------------------
  // POST /users/:id/grants — batch-add direct grant patterns to a user
  // ---------------------------------------------------------------------------

  async addUserGrants(
    requestingUser: AuthenticatedUser,
    targetUserId: string,
    patterns: string[],
  ): Promise<Record<string, unknown>> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('assign_role', 'User')) throw new AppError('FORBIDDEN', 403);

    const target = await prisma.user.findUnique({ where: { id: targetUserId, deleted_at: null }, ...withRoles });
    if (!target) throw new AppError('USER_NOT_FOUND', 404);

    // Object-level scope enforced by CASL against the record (id / org_id).
    if (!ability.can('assign_role', subject('User', target) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    for (const pattern of patterns) {
      if (!isValidPattern(pattern, PERMISSIONS)) throw new AppError('INVALID_GRANT_PATTERN', 422);
    }

    // Escalation guard: you can only grant power you already hold.
    if (!canAssignGrants(ability, patterns, PERMISSIONS)) {
      throw new AppError('GRANT_SCOPE_ESCALATION', 403);
    }

    const existingPatterns = target.user_grants.map((g) => g.pattern);
    const compressed = compressPatterns([...existingPatterns, ...patterns], PERMISSIONS);
    const existingSet = new Set(existingPatterns);
    const compressedSet = new Set(compressed);
    const toDelete = existingPatterns.filter((p) => !compressedSet.has(p));
    const toAdd = compressed.filter((p) => !existingSet.has(p));

    if (toAdd.length === 0 && toDelete.length === 0) {
      return serializeUserFullProfile(target);
    }

    await prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.userGrant.deleteMany({ where: { user_id: targetUserId, pattern: { in: toDelete } } });
      }
      if (toAdd.length > 0) {
        await tx.userGrant.createMany({ data: toAdd.map((p) => ({ user_id: targetUserId, pattern: p })) });
      }
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId }, ...withRoles });

    setImmediate(() => {
      publishAudit({
        actor_id: requestingUser.id,
        action: 'update',
        resource: 'User',
        resource_id: targetUserId,
        delta: {
          grants_added: toAdd,
          ...(toDelete.length > 0 ? { grants_consolidated: toDelete } : {}),
        },
      });
      if (updated.user_type === 'staff') {
        publishUserEvent({
          type: 'staff.updated',
          id: updated.id,
          first_name: updated.first_name,
          last_name: updated.last_name,
          avatar_path: updated.avatar_path,
          org_id: updated.org_id,
          roles: updated.user_roles.map((ur) => ur.role.slug),
          status: updated.status,
          updated_at: updated.updated_at.toISOString(),
        });
      }
    });

    return serializeUserFullProfile(updated);
  },

  // ---------------------------------------------------------------------------
  // DELETE /users/:id/grants/:grantId — remove a direct grant from a user
  // ---------------------------------------------------------------------------

  async removeUserGrant(
    requestingUser: AuthenticatedUser,
    targetUserId: string,
    grantId: string,
  ): Promise<void> {
    const ability = buildAbilityFromRules(requestingUser.rules);
    if (!ability.can('assign_role', 'User')) throw new AppError('FORBIDDEN', 403);

    const grant = await prisma.userGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.user_id !== targetUserId) throw new AppError('GRANT_NOT_FOUND', 404);
    if (grant.is_managed) throw new AppError('MANAGED_GRANT_IMMUTABLE', 403);

    const target = await prisma.user.findUnique({ where: { id: targetUserId }, ...withRoles });
    if (!target || target.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    // Object-level scope enforced by CASL against the record (id / org_id).
    if (!ability.can('assign_role', subject('User', target) as unknown as Subjects)) {
      throw new AppError('FORBIDDEN', 403);
    }

    await prisma.userGrant.delete({ where: { id: grantId } });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId }, ...withRoles });

    setImmediate(() => {
      publishAudit({
        actor_id: requestingUser.id,
        action: 'update',
        resource: 'User',
        resource_id: targetUserId,
        delta: { grant_removed: { from: grant.pattern, to: null } },
      });
      if (updated.user_type === 'staff') {
        publishUserEvent({
          type: 'staff.updated',
          id: updated.id,
          first_name: updated.first_name,
          last_name: updated.last_name,
          avatar_path: updated.avatar_path,
          org_id: updated.org_id,
          roles: updated.user_roles.map((ur) => ur.role.slug),
          status: updated.status,
          updated_at: updated.updated_at.toISOString(),
        });
      }
    });
  },

  // ---------------------------------------------------------------------------
  // GET /users/me/devices
  // ---------------------------------------------------------------------------

  async listMyDevices(userId: string): Promise<{
    data: { id: string; device_name: string | null; fcm_token_preview: string; registered_at: Date; last_active_at: Date | null }[]
  }> {
    const devices = await prisma.userDevice.findMany({
      where: { user_id: userId },
      select: { id: true, device_name: true, fcm_token: true, registered_at: true, last_active_at: true },
      orderBy: { registered_at: 'desc' },
    });

    return {
      data: devices.map((d) => ({
        id: d.id,
        device_name: d.device_name,
        fcm_token_preview: d.fcm_token.length > 6
          ? `${'*'.repeat(d.fcm_token.length - 6)}${d.fcm_token.slice(-6)}`
          : d.fcm_token,
        registered_at: d.registered_at,
        last_active_at: d.last_active_at,
      })),
    };
  },
};
