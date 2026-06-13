/**
 * Tests for GET /users/me/devices via UserController.
 * Service-layer tests are in user.devices.service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type * as AbilityModule from '../../src/utils/ability.js';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockListMyDevices = vi.fn();

vi.mock('../../src/services/user.service.js', () => ({
  UserService: {
    listMyDevices: mockListMyDevices,
    getMe: vi.fn(),
    updateMe: vi.fn(),
    listUsers: vi.fn(),
    getUserById: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    inviteUser: vi.fn(),
    acceptInvite: vi.fn(),
    validateInviteToken: vi.fn(),
    listInvitations: vi.fn(),
    updateInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
    validatePassword: vi.fn(),
    requestLoginChannelChange: vi.fn(),
    confirmLoginChannelChange: vi.fn(),
    addUserGrants: vi.fn(),
    removeUserGrant: vi.fn(),
  },
}));

vi.mock('../../src/services/media.service.js', () => ({
  MediaService: { generateUserAvatarPresignedUrl: vi.fn() },
}));

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    userDevice: { findMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    role: { findFirst: vi.fn(), findMany: vi.fn() },
    invitation: { findUnique: vi.fn(), create: vi.fn() },
    org: { findUnique: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    userGrant: { delete: vi.fn() },
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
}));
vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com' } }));
vi.mock('../../src/services/otp.service.js', () => ({ OtpService: { create: vi.fn() } }));
vi.mock('../../src/loaders/bootstrap.js', () => ({ PERMISSIONS: [] }));

const { UserController } = await import('../../src/api/user.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;
const authUser = { id: 'user-1', org_id: null, user_type: 'passenger', role_slugs: [], rules: [], locale: 'rw' };

beforeEach(() => vi.clearAllMocks());

// ── UserController.listMyDevices ──────────────────────────────────────────────

describe('UserController.listMyDevices', () => {
  it('returns registered devices with masked fcm_token_preview', async () => {
    const devices = {
      data: [{ id: 'd1', device_name: 'iPhone', fcm_token_preview: '**long**def456', registered_at: new Date(), last_active_at: null }],
    };
    mockListMyDevices.mockResolvedValueOnce(devices);
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await UserController.listMyDevices(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(devices);
  });

  it('returns data: [] when no devices are registered', async () => {
    mockListMyDevices.mockResolvedValueOnce({ data: [] });
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await UserController.listMyDevices(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });

  it('calls next(err) on error', async () => {
    mockListMyDevices.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser } as unknown as Request;
    await UserController.listMyDevices(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
