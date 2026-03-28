/**
 * Tests for src/services/token.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockFindUniqueRefreshToken = vi.fn();
const mockCreateRefreshToken = vi.fn().mockResolvedValue({});
const mockUpdateManyRefreshToken = vi.fn().mockResolvedValue({ count: 0 });
const mockUpdateRefreshToken = vi.fn().mockResolvedValue({});
const mockDeleteRefreshToken = vi.fn().mockResolvedValue({});
const mockFindUniqueUser = vi.fn();

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    refreshToken: {
      findUnique: mockFindUniqueRefreshToken,
      create: mockCreateRefreshToken,
      updateMany: mockUpdateManyRefreshToken,
      update: mockUpdateRefreshToken,
      delete: mockDeleteRefreshToken,
    },
    user: {
      findUnique: mockFindUniqueUser,
    },
  },
}));

vi.mock('../../src/utils/crypto.js', () => ({
  hashToken: vi.fn().mockReturnValue('hashed-token'),
  generateRawToken: vi.fn().mockReturnValue('raw-refresh-token'),
}));

vi.mock('../../src/utils/tokens.js', () => ({
  signAccessToken: vi.fn().mockReturnValue('mock-access-token'),
}));

vi.mock('../../src/utils/ability.js', () => ({
  collectPermissions: vi.fn().mockReturnValue([]),
  buildRulesForUser: vi.fn().mockReturnValue([]),
  buildAbilityFromRules: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: { jwt: { refreshTtlMs: 604_800_000 } },
}));

const mockNotifyUser = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({
  notifyUser: mockNotifyUser,
}));

const { TokenService } = await import('../../src/services/token.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  org_id: 'org-1',
  user_type: 'staff',
  status: 'active',
  deleted_at: null,
  phone_number: '+250788000001',
  fcm_token: null,
  notif_channel: 'sms',
  user_roles: [],
  user_permissions: [],
  ...overrides,
});

const futureDate = new Date(Date.now() + 60_000);
const pastDate = new Date(Date.now() - 60_000);

const makeStoredToken = (overrides: Record<string, unknown> = {}) => ({
  token_hash: 'hashed-token',
  user_id: 'user-1',
  device_name: 'iPhone',
  revoked_at: null,
  expires_at: futureDate,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ── issueTokenPair ─────────────────────────────────────────────────────────────

describe('TokenService.issueTokenPair', () => {
  it('creates a refresh token record in the DB', async () => {
    const user = makeUser() as never;
    await TokenService.issueTokenPair(user, 'iPhone', '1.2.3.4', 'Mozilla/5.0');
    expect(mockCreateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          token_hash: 'hashed-token',
          user_id: 'user-1',
          device_name: 'iPhone',
          ip_address: '1.2.3.4',
          user_agent: 'Mozilla/5.0',
        }),
      }),
    );
  });

  it('returns access and refresh tokens', async () => {
    const user = makeUser() as never;
    const tokens = await TokenService.issueTokenPair(user);
    expect(tokens).toEqual({ access: 'mock-access-token', refresh: 'raw-refresh-token' });
  });

  it('stores null device_name when not provided', async () => {
    await TokenService.issueTokenPair(makeUser() as never);
    const call = mockCreateRefreshToken.mock.calls[0][0];
    expect(call.data.device_name).toBeNull();
  });
});

// ── rotateRefreshToken — error paths ──────────────────────────────────────────

describe('TokenService.rotateRefreshToken — token not found', () => {
  it('throws INVALID_REFRESH_TOKEN (401)', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(null);
    await expect(TokenService.rotateRefreshToken('some-raw-token')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN', status: 401,
    });
  });
});

describe('TokenService.rotateRefreshToken — revoked token (reuse detection)', () => {
  it('revokes all sessions for the user', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken({ revoked_at: pastDate }));
    mockFindUniqueUser.mockResolvedValueOnce(null); // victim lookup
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED', status: 401,
    });
    expect(mockUpdateManyRefreshToken).toHaveBeenCalledWith({
      where: { user_id: 'user-1', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('notifies the user when victim is found', async () => {
    const victim = makeUser();
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken({ revoked_at: pastDate }));
    mockFindUniqueUser.mockResolvedValueOnce(victim);
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({ code: 'TOKEN_REUSE_DETECTED' });
    expect(mockNotifyUser).toHaveBeenCalledWith(
      victim,
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.all_sessions_revoked' }) }),
    );
  });

  it('throws TOKEN_REUSE_DETECTED (401)', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken({ revoked_at: pastDate }));
    mockFindUniqueUser.mockResolvedValueOnce(null);
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'TOKEN_REUSE_DETECTED', status: 401,
    });
  });
});

describe('TokenService.rotateRefreshToken — expired token', () => {
  it('deletes the record and throws INVALID_REFRESH_TOKEN', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken({ expires_at: pastDate }));
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN', status: 401,
    });
    expect(mockDeleteRefreshToken).toHaveBeenCalledWith({ where: { token_hash: 'hashed-token' } });
  });
});

describe('TokenService.rotateRefreshToken — user not found or deleted', () => {
  it('throws INVALID_REFRESH_TOKEN when user does not exist', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken());
    mockFindUniqueUser.mockResolvedValueOnce(null);
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN', status: 401,
    });
  });

  it('throws INVALID_REFRESH_TOKEN when user is soft-deleted', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken());
    mockFindUniqueUser.mockResolvedValueOnce(makeUser({ deleted_at: new Date() }));
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN', status: 401,
    });
  });
});

describe('TokenService.rotateRefreshToken — suspended user', () => {
  it('throws ACCOUNT_SUSPENDED (403)', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken());
    mockFindUniqueUser.mockResolvedValueOnce(makeUser({ status: 'suspended' }));
    await expect(TokenService.rotateRefreshToken('raw')).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED', status: 403,
    });
  });
});

describe('TokenService.rotateRefreshToken — success', () => {
  it('revokes old token and returns user + new tokens', async () => {
    const user = makeUser();
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken());
    mockFindUniqueUser.mockResolvedValueOnce(user);
    const result = await TokenService.rotateRefreshToken('raw');
    expect(mockUpdateRefreshToken).toHaveBeenCalledWith({
      where: { token_hash: 'hashed-token' },
      data: { revoked_at: expect.any(Date) },
    });
    expect(result).toMatchObject({
      user,
      tokens: { access: 'mock-access-token', refresh: 'raw-refresh-token' },
    });
  });

  it('passes device_name to issueTokenPair', async () => {
    mockFindUniqueRefreshToken.mockResolvedValueOnce(makeStoredToken({ device_name: 'Android' }));
    mockFindUniqueUser.mockResolvedValueOnce(makeUser());
    await TokenService.rotateRefreshToken('raw');
    const createCall = mockCreateRefreshToken.mock.calls[0][0];
    expect(createCall.data.device_name).toBe('Android');
  });
});

// ── revokeByRawToken ──────────────────────────────────────────────────────────

describe('TokenService.revokeByRawToken', () => {
  it('updates the matching token to revoked', async () => {
    await TokenService.revokeByRawToken('my-raw-token');
    expect(mockUpdateManyRefreshToken).toHaveBeenCalledWith({
      where: { token_hash: 'hashed-token', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });
});

// ── revokeAllForUser ──────────────────────────────────────────────────────────

describe('TokenService.revokeAllForUser', () => {
  it('revokes all non-revoked tokens for the user', async () => {
    await TokenService.revokeAllForUser('user-42');
    expect(mockUpdateManyRefreshToken).toHaveBeenCalledWith({
      where: { user_id: 'user-42', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });
});

// ── getUserWithRoles ──────────────────────────────────────────────────────────

describe('TokenService.getUserWithRoles', () => {
  it('returns the user from prisma', async () => {
    const user = makeUser();
    mockFindUniqueUser.mockResolvedValueOnce(user);
    const result = await TokenService.getUserWithRoles('user-1');
    expect(result).toEqual(user);
    expect(mockFindUniqueUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('returns null when user does not exist', async () => {
    mockFindUniqueUser.mockResolvedValueOnce(null);
    const result = await TokenService.getUserWithRoles('no-such-user');
    expect(result).toBeNull();
  });
});
