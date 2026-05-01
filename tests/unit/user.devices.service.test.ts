/**
 * Unit tests for UserService.listMyDevices (service layer only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AbilityModule from '../../src/utils/ability.js';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUserDeviceFindMany = vi.fn().mockResolvedValue([]);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    userDevice: { findMany: mockUserDeviceFindMany },
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    role: { findFirst: vi.fn(), findMany: vi.fn() },
    invitation: { findUnique: vi.fn(), create: vi.fn() },
    org: { findUnique: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  Prisma: {},
}));

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: vi.fn(),
  publishSms: vi.fn(),
  publishMail: vi.fn(),
  notifyUser: vi.fn(),
  publishUserEvent: vi.fn(),
}));

vi.mock('../../src/loaders/redis.js', () => ({ getRedisClient: () => ({ set: vi.fn() }) }));
vi.mock('../../src/utils/crypto.js', () => ({ generateRawToken: vi.fn(), hashToken: vi.fn(), hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock('../../src/utils/s3.js', () => ({ deleteFromS3: vi.fn() }));
vi.mock('../../src/utils/ability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AbilityModule>();
  return { ...actual, buildRulesFromGrants: vi.fn().mockReturnValue([]) };
});
vi.mock('../../src/models/serializers.js', () => ({
  serializeUserMe: vi.fn().mockReturnValue({}),
  serializeUserForList: vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id })),
  serializeUserFullProfile: vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id })),
  maskPhone: vi.fn((p: string) => p),
}));
vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com', staffAppUrl: 'https://staff.katisha.com' } }));
vi.mock('../../src/services/otp.service.js', () => ({ OtpService: { create: vi.fn() } }));
vi.mock('../../src/loaders/bootstrap.js', () => ({ PERMISSIONS: [] }));

const { UserService } = await import('../../src/services/user.service.js');

beforeEach(() => vi.clearAllMocks());

// ── UserService.listMyDevices ─────────────────────────────────────────────────

describe('UserService.listMyDevices', () => {
  it('masks fcm_token, keeping last 6 chars', async () => {
    mockUserDeviceFindMany.mockResolvedValueOnce([
      { id: 'd1', device_name: null, fcm_token: 'ABCDEF123456', registered_at: new Date(), last_active_at: null },
    ]);
    const result = await UserService.listMyDevices('user-1');
    expect(result.data[0].fcm_token_preview).toBe('******123456');
    expect(result.data[0].fcm_token_preview).not.toContain('ABCDEF');
  });

  it('returns data: [] when no devices are registered', async () => {
    mockUserDeviceFindMany.mockResolvedValueOnce([]);
    const result = await UserService.listMyDevices('user-1');
    expect(result.data).toEqual([]);
  });

  it('queries by user_id', async () => {
    await UserService.listMyDevices('user-abc');
    expect(mockUserDeviceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-abc' } }),
    );
  });

  it('short tokens (≤6 chars) are returned as-is', async () => {
    mockUserDeviceFindMany.mockResolvedValueOnce([
      { id: 'd1', device_name: null, fcm_token: 'abc', registered_at: new Date(), last_active_at: null },
    ]);
    const result = await UserService.listMyDevices('user-1');
    expect(result.data[0].fcm_token_preview).toBe('abc');
  });
});
