/**
 * Tests for AuthService.listSessions, revokeSession, and unregisterDevice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockRefreshTokenFindMany = vi.fn().mockResolvedValue([]);
const mockRefreshTokenFindUnique = vi.fn();
const mockRefreshTokenUpdate = vi.fn().mockResolvedValue({});
const mockUserDeviceFindFirst = vi.fn();
const mockUserDeviceDelete = vi.fn().mockResolvedValue({});
const mockUserDeviceCount = vi.fn().mockResolvedValue(0);
const mockUserUpdate = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    refreshToken: {
      findMany: mockRefreshTokenFindMany,
      findUnique: mockRefreshTokenFindUnique,
      update: mockRefreshTokenUpdate,
    },
    userDevice: {
      findFirst: mockUserDeviceFindFirst,
      delete: mockUserDeviceDelete,
      count: mockUserDeviceCount,
    },
    user: { update: mockUserUpdate },
  },
}));

// Stub out all other dependencies used by AuthService
vi.mock('../../src/utils/crypto.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  hashToken: vi.fn((t: string) => `hash:${t}`),
  generateRawToken: vi.fn(() => 'raw-tok'),
}));
vi.mock('../../src/services/token.service.js', () => ({
  TokenService: {
    issueTokenPair: vi.fn(),
    rotateRefreshToken: vi.fn(),
    revokeByRawToken: vi.fn(),
    revokeAllForUser: vi.fn(),
  },
}));
vi.mock('../../src/services/otp.service.js', () => ({ OtpService: { create: vi.fn(), verify: vi.fn() } }));
vi.mock('../../src/services/password.service.js', () => ({ PasswordService: { forgotPassword: vi.fn(), resetPassword: vi.fn() } }));
vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: vi.fn(),
  publishSms: vi.fn(),
  publishMail: vi.fn(),
  notifyUser: vi.fn(),
}));

const { AuthService } = await import('../../src/services/auth.service.js');

beforeEach(() => vi.clearAllMocks());

// ── listSessions ──────────────────────────────────────────────────────────────

describe('AuthService.listSessions', () => {
  it('returns sessions for authenticated user', async () => {
    const now = new Date();
    mockRefreshTokenFindMany.mockResolvedValueOnce([
      { id: 'sess-1', device_name: 'iPhone', created_at: now, last_used_at: now },
      { id: 'sess-2', device_name: null, created_at: now, last_used_at: null },
    ]);
    const result = await AuthService.listSessions('user-1', 'sess-1');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ id: 'sess-1', is_current: true });
    expect(result.data[1]).toMatchObject({ id: 'sess-2', is_current: false });
  });

  it('is_current is true only for the calling session', async () => {
    const now = new Date();
    mockRefreshTokenFindMany.mockResolvedValueOnce([
      { id: 'sess-1', device_name: null, created_at: now, last_used_at: now },
      { id: 'sess-2', device_name: null, created_at: now, last_used_at: now },
    ]);
    const result = await AuthService.listSessions('user-1', 'sess-2');
    expect(result.data.find((s) => s.id === 'sess-1')?.is_current).toBe(false);
    expect(result.data.find((s) => s.id === 'sess-2')?.is_current).toBe(true);
  });

  it('excludes revoked and expired sessions (query filter)', async () => {
    await AuthService.listSessions('user-1', undefined);
    expect(mockRefreshTokenFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          revoked_at: null,
          expires_at: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('returns empty data when no active sessions', async () => {
    mockRefreshTokenFindMany.mockResolvedValueOnce([]);
    const result = await AuthService.listSessions('user-1', undefined);
    expect(result.data).toEqual([]);
  });
});

// ── revokeSession ─────────────────────────────────────────────────────────────

describe('AuthService.revokeSession', () => {
  it('revokes own session and marks revoked_at', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({ id: 'sess-1', user_id: 'user-1', revoked_at: null });
    await AuthService.revokeSession('user-1', 'sess-1');
    expect(mockRefreshTokenUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('returns 404 for a non-existent id', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce(null);
    await expect(AuthService.revokeSession('user-1', 'ghost')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND', status: 404,
    });
  });

  it('returns 404 for a session belonging to another user', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({ id: 'sess-1', user_id: 'other-user', revoked_at: null });
    await expect(AuthService.revokeSession('user-1', 'sess-1')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND', status: 404,
    });
  });

  it('returns 409 if already revoked', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({ id: 'sess-1', user_id: 'user-1', revoked_at: new Date() });
    await expect(AuthService.revokeSession('user-1', 'sess-1')).rejects.toMatchObject({
      code: 'SESSION_ALREADY_REVOKED', status: 409,
    });
  });

  it('allows revoking the current session', async () => {
    mockRefreshTokenFindUnique.mockResolvedValueOnce({ id: 'sess-current', user_id: 'user-1', revoked_at: null });
    await expect(AuthService.revokeSession('user-1', 'sess-current')).resolves.toBeUndefined();
    expect(mockRefreshTokenUpdate).toHaveBeenCalled();
  });
});

// ── unregisterDevice ──────────────────────────────────────────────────────────

describe('AuthService.unregisterDevice', () => {
  it('removes FCM token and returns 204', async () => {
    mockUserDeviceFindFirst.mockResolvedValueOnce({ id: 'dev-1' });
    mockUserDeviceCount.mockResolvedValueOnce(0);
    await AuthService.unregisterDevice('user-1', 'staff');
    expect(mockUserDeviceDelete).toHaveBeenCalledWith({ where: { id: 'dev-1' } });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('reverts notif_channel when no devices remain', async () => {
    mockUserDeviceFindFirst.mockResolvedValueOnce({ id: 'dev-1' });
    mockUserDeviceCount.mockResolvedValueOnce(0);
    await AuthService.unregisterDevice('user-1', 'staff');
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notif_channel: ['sms', 'email'] }),
      }),
    );
  });

  it('reverts to ["sms"] for passenger when no devices remain', async () => {
    mockUserDeviceFindFirst.mockResolvedValueOnce({ id: 'dev-1' });
    mockUserDeviceCount.mockResolvedValueOnce(0);
    await AuthService.unregisterDevice('user-1', 'passenger');
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notif_channel: ['sms'] }),
      }),
    );
  });

  it('does not revert notif_channel if other devices still registered', async () => {
    mockUserDeviceFindFirst.mockResolvedValueOnce({ id: 'dev-1' });
    mockUserDeviceCount.mockResolvedValueOnce(1);
    await AuthService.unregisterDevice('user-1', 'staff');
    const updateCall = mockUserUpdate.mock.calls[0][0];
    expect(updateCall.data.notif_channel).toBeUndefined();
  });

  it('returns 404 when no device is registered', async () => {
    mockUserDeviceFindFirst.mockResolvedValueOnce(null);
    await expect(AuthService.unregisterDevice('user-1', 'staff')).rejects.toMatchObject({
      code: 'DEVICE_NOT_REGISTERED', status: 404,
    });
  });
});
