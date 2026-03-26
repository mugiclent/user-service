import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashToken, generateRawToken } from '../utils/crypto.js';
import { signAccessToken } from '../utils/tokens.js';
import { buildRulesForUser, collectPermissions } from '../utils/ability.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Build access token payload and sign it. */
const buildAccessToken = (user: UserWithRoles): string => {
  const entries = collectPermissions(user);
  const rules = buildRulesForUser(user.id, user.org_id, entries);
  return signAccessToken({ sub: user.id, org_id: user.org_id, user_type: user.user_type, rules });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const TokenService = {
  /**
   * Issue a new access + refresh token pair.
   * Stores a hashed refresh token in the DB — never the raw value.
   */
  async issueTokenPair(
    user: UserWithRoles,
    device_name?: string,
  ): Promise<AuthTokens> {
    const access = buildAccessToken(user);
    const rawRefresh = generateRawToken();
    const hash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlMs);

    await prisma.refreshToken.create({
      data: {
        token_hash: hash,
        user_id: user.id,
        device_name: device_name ?? null,
        expires_at: expiresAt,
      },
    });

    return { access, refresh: rawRefresh };
  },

  /**
   * Rotate a refresh token — core of POST /auth/refresh.
   *
   * Flow:
   *   1. Hash the incoming raw token and look up by hash
   *   2. Not found → INVALID_REFRESH_TOKEN
   *   3. Already revoked → reuse detection → wipe ALL sessions → TOKEN_REUSE_DETECTED
   *   4. Expired → INVALID_REFRESH_TOKEN (and delete the record)
   *   5. User suspended → ACCOUNT_SUSPENDED
   *   6. Mark old token revoked, issue new pair
   */
  async rotateRefreshToken(rawToken: string): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    const hash = hashToken(rawToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { token_hash: hash },
    });

    if (!stored) throw new AppError('INVALID_REFRESH_TOKEN', 401);

    if (stored.revoked_at) {
      // Reuse of a revoked token — wipe all sessions for this user
      await prisma.refreshToken.updateMany({
        where: { user_id: stored.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      throw new AppError('TOKEN_REUSE_DETECTED', 401);
    }

    if (stored.expires_at < new Date()) {
      await prisma.refreshToken.delete({ where: { token_hash: hash } });
      throw new AppError('INVALID_REFRESH_TOKEN', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: stored.user_id }, ...withRoles });
    if (!user || user.deleted_at) throw new AppError('INVALID_REFRESH_TOKEN', 401);
    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403);

    // Revoke old token
    await prisma.refreshToken.update({
      where: { token_hash: hash },
      data: { revoked_at: new Date() },
    });

    const tokens = await TokenService.issueTokenPair(user, stored.device_name ?? undefined);
    return { user, tokens };
  },

  /** Revoke a single refresh token by raw value. Idempotent. */
  async revokeByRawToken(rawToken: string): Promise<void> {
    const hash = hashToken(rawToken);
    await prisma.refreshToken.updateMany({
      where: { token_hash: hash, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  },

  /** Revoke all refresh tokens for a user. Used by logout-all and password reset. */
  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  },

  /** Fetch a user with their roles — used by auth flows that need the full object. */
  async getUserWithRoles(userId: string): Promise<UserWithRoles | null> {
    return prisma.user.findUnique({ where: { id: userId }, ...withRoles });
  },
};
