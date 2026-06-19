import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashToken, generateRawToken } from '../utils/crypto.js';
import { randomUUID } from 'node:crypto';
import { signAccessToken } from '../utils/tokens.js';
import { buildRulesFromGrants } from '../utils/ability.js';
import { PERMISSIONS } from '../utils/catalog.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';
import { getRedisClient } from '../loaders/redis.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';

/** Selects which session-lifetime profile a token pair is issued under. */
export type ClientType = 'web' | 'mobile';

// Access tokens live 15 min; a revocation key only needs to outlast that window,
// after which the token expires on its own and the key self-expires.
const ACCESS_TOKEN_TTL_SECONDS = 900;

/**
 * Block a single session's access token until it expires. The refresh-token row
 * id IS the session_id baked into the access token, so the gateway's
 * blacklist:session:<id> check kills exactly the matching access token.
 * Best-effort: a Redis failure must not break logout.
 */
const blacklistSession = async (sessionId: string): Promise<void> => {
  try {
    await getRedisClient().set(`blacklist:session:${sessionId}`, '1', 'EX', ACCESS_TOKEN_TTL_SECONDS);
  } catch (err) {
    console.error('[token] Failed to blacklist session', err);
  }
};

/** Block every access token for a user (logout-all, password reset). Best-effort. */
const blacklistUser = async (userId: string): Promise<void> => {
  try {
    await getRedisClient().set(`blacklist:user:${userId}`, '1', 'EX', ACCESS_TOKEN_TTL_SECONDS);
  } catch (err) {
    console.error('[token] Failed to blacklist user', err);
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withRoles = {
  include: {
    user_roles: { include: { role: { include: { role_grants: true } } } },
    user_grants: true,
  },
} as const;

/** Collect all grant patterns for a user (from roles + direct grants), deduped. */
const collectPatterns = (user: UserWithRoles): string[] => {
  const seen = new Set<string>();
  for (const ur of user.user_roles) {
    for (const g of ur.role.role_grants) seen.add(g.pattern);
  }
  for (const g of user.user_grants) seen.add(g.pattern);
  return Array.from(seen);
};

/** Build access token payload and sign it. */
const buildAccessToken = async (user: UserWithRoles, session_id?: string): Promise<string> => {
  const patterns = collectPatterns(user);
  const rules = buildRulesFromGrants(patterns, user.id, user.org_id, PERMISSIONS);
  const role_slugs = user.user_roles.map((ur) => ur.role.slug);
  const name = `${user.first_name} ${user.last_name}`.trim();
  return signAccessToken({ sub: user.id, org_id: user.org_id, user_type: user.user_type, phone_number: user.phone_number, name, role_slugs, rules, locale: user.locale, session_id });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const TokenService = {
  /**
   * Issue a new access + refresh token pair.
   * Stores a hashed refresh token in the DB — never the raw value.
   *
   * `clientType` selects the lifetime profile (web = tight, mobile = generous).
   * `absoluteExpiresAt` is supplied on rotation to carry the session's hard
   * ceiling forward unchanged; at login it is omitted and computed fresh.
   */
  async issueTokenPair(
    user: UserWithRoles,
    opts: {
      device_name?: string;
      ip_address?: string;
      user_agent?: string;
      clientType?: ClientType;
      absoluteExpiresAt?: Date;
    } = {},
  ): Promise<AuthTokens> {
    const clientType = opts.clientType ?? 'web';
    const ttls = config.jwt.session[clientType];
    const now = Date.now();

    const sessionId = randomUUID();
    const access = await buildAccessToken(user, sessionId);
    const rawRefresh = generateRawToken();
    const hash = hashToken(rawRefresh);

    const absoluteExpiresAt = opts.absoluteExpiresAt ?? new Date(now + ttls.absoluteMs);
    // Sliding idle window, but never allowed to outlive the absolute ceiling.
    const idleExpiresAt = new Date(now + ttls.idleMs);
    const expiresAt = idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;

    await prisma.refreshToken.create({
      data: {
        id: sessionId,
        token_hash: hash,
        user_id: user.id,
        device_name: opts.device_name ?? null,
        ip_address: opts.ip_address ?? null,
        user_agent: opts.user_agent ?? null,
        expires_at: expiresAt,
        absolute_expires_at: absoluteExpiresAt,
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
   *   4. Idle window elapsed → INVALID_REFRESH_TOKEN (and delete the record)
   *   5. Absolute cap reached → SESSION_EXPIRED (revoke; full re-login required)
   *   6. User suspended → ACCOUNT_SUSPENDED
   *   7. Mark old token revoked, issue new pair inheriting the absolute cap
   */
  async rotateRefreshToken(
    rawToken: string,
    clientType: ClientType = 'web',
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
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

    // Absolute ceiling — a session may not rotate forever; force a fresh login.
    if (stored.absolute_expires_at && stored.absolute_expires_at < new Date()) {
      await prisma.refreshToken.update({
        where: { token_hash: hash },
        data: { revoked_at: new Date() },
      });
      throw new AppError('SESSION_EXPIRED', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: stored.user_id }, ...withRoles });
    if (!user || user.deleted_at) throw new AppError('INVALID_REFRESH_TOKEN', 401);
    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403);

    // Revoke old token
    await prisma.refreshToken.update({
      where: { token_hash: hash },
      data: { revoked_at: new Date() },
    });

    const tokens = await TokenService.issueTokenPair(user, {
      device_name: stored.device_name ?? undefined,
      clientType,
      // Inherit the original ceiling so the lineage really does expire; legacy
      // rows (null) get a fresh cap applied from now.
      absoluteExpiresAt: stored.absolute_expires_at ?? undefined,
    });
    return { user, tokens };
  },

  /**
   * Revoke a single refresh token by raw value. Idempotent.
   * Also blacklists the matching session so the in-flight access token is killed
   * immediately rather than living out its 15-min TTL.
   */
  async revokeByRawToken(rawToken: string): Promise<void> {
    const hash = hashToken(rawToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { token_hash: hash },
      select: { id: true, revoked_at: true },
    });
    if (!stored) return;

    if (!stored.revoked_at) {
      await prisma.refreshToken.update({
        where: { token_hash: hash },
        data: { revoked_at: new Date() },
      });
    }
    // refresh_tokens.id === access token session_id
    await blacklistSession(stored.id);
  },

  /**
   * Revoke all refresh tokens for a user. Used by logout-all and password reset.
   * Blacklists the user so every in-flight access token is killed at once.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await blacklistUser(userId);
  },

  /**
   * "Sign out everywhere except this device" — the password-change pattern used by
   * GitHub/Google/etc. Kills every existing session (in-flight access tokens via
   * per-session blacklist + all refresh tokens), then mints ONE fresh pair for the
   * current device so the caller stays logged in seamlessly.
   *
   * Uses per-session blacklisting (not blacklist:user) precisely so the brand-new
   * session — which has a fresh session_id not in the blacklisted set — is NOT
   * caught by the revocation.
   */
  async rotateAllSessions(
    user: UserWithRoles,
    opts: {
      device_name?: string;
      ip_address?: string;
      user_agent?: string;
      clientType?: ClientType;
    } = {},
  ): Promise<AuthTokens> {
    const sessions = await prisma.refreshToken.findMany({
      where: { user_id: user.id, revoked_at: null },
      select: { id: true },
    });
    await Promise.all(sessions.map((s) => blacklistSession(s.id)));
    await prisma.refreshToken.updateMany({
      where: { user_id: user.id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return TokenService.issueTokenPair(user, opts);
  },

  /** Fetch a user with their roles — used by auth flows that need the full object. */
  async getUserWithRoles(userId: string): Promise<UserWithRoles | null> {
    return prisma.user.findUnique({ where: { id: userId }, ...withRoles });
  },
};
