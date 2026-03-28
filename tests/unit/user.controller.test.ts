/**
 * Tests for src/api/user.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockGetMe = vi.fn().mockResolvedValue({ id: 'user-1' });
const mockUpdateMe = vi.fn().mockResolvedValue({ id: 'user-1' });
const mockListUsers = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
const mockGetUserById = vi.fn().mockResolvedValue({ id: 'user-2' });
const mockUpdateUser = vi.fn().mockResolvedValue({ id: 'user-2' });
const mockDeleteUser = vi.fn().mockResolvedValue(undefined);
const mockInviteUser = vi.fn().mockResolvedValue({ invite_token: 'tok', expires_at: new Date() });
const mockAcceptInvite = vi.fn();
const mockValidatePassword = vi.fn().mockResolvedValue(undefined);
const mockToggle2fa = vi.fn().mockResolvedValue({ two_factor_enabled: true });

vi.mock('../../src/services/user.service.js', () => ({
  UserService: {
    getMe: mockGetMe,
    updateMe: mockUpdateMe,
    listUsers: mockListUsers,
    getUserById: mockGetUserById,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
    inviteUser: mockInviteUser,
    acceptInvite: mockAcceptInvite,
    validatePassword: mockValidatePassword,
    toggle2fa: mockToggle2fa,
  },
}));

const mockIssueTokenPair = vi.fn().mockResolvedValue({ access: 'a', refresh: 'r' });
vi.mock('../../src/services/token.service.js', () => ({
  TokenService: { issueTokenPair: mockIssueTokenPair },
}));

const mockGenerateUserAvatarPresignedUrl = vi.fn().mockResolvedValue({ uploadUrl: 'https://...', path: 'key' });
vi.mock('../../src/services/media.service.js', () => ({
  MediaService: { generateUserAvatarPresignedUrl: mockGenerateUserAvatarPresignedUrl },
}));

const mockSendAuthResponse = vi.fn();
vi.mock('../../src/utils/sendAuthResponse.js', () => ({
  sendAuthResponse: mockSendAuthResponse,
}));

const mockSerializeUserForAuth = vi.fn().mockReturnValue({ id: 'user-1' });
vi.mock('../../src/models/serializers.js', () => ({
  serializeUserForAuth: mockSerializeUserForAuth,
}));

const { UserController } = await import('../../src/api/user.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;

const authUser = { id: 'user-1', org_id: null, user_type: 'staff', role_slugs: ['katisha_admin'], rules: [] };

beforeEach(() => vi.clearAllMocks());

// ── getMe ────────────────────────────────────────────────────────────────────

describe('UserController.getMe', () => {
  it('returns 200 with user data', async () => {
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await UserController.getMe(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('calls next(err) on error', async () => {
    mockGetMe.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser } as unknown as Request;
    await UserController.getMe(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── updateMe ─────────────────────────────────────────────────────────────────

describe('UserController.updateMe', () => {
  it('returns 200 with updated user data', async () => {
    const req = { user: authUser, body: { first_name: 'Alice' } } as unknown as Request;
    const res = makeRes();
    await UserController.updateMe(req, res, next);
    expect(mockUpdateMe).toHaveBeenCalledWith(authUser, { first_name: 'Alice' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockUpdateMe.mockRejectedValueOnce(new Error('email not allowed'));
    const req = { user: authUser, body: { email: 'a@b.com' } } as unknown as Request;
    await UserController.updateMe(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getAvatarPresignedUrl ─────────────────────────────────────────────────────

describe('UserController.getAvatarPresignedUrl', () => {
  it('calls next with MISSING_CONTENT_TYPE when content_type query param absent', async () => {
    const req = { user: authUser, query: {} } as unknown as Request;
    await UserController.getAvatarPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_CONTENT_TYPE', status: 400 }));
  });

  it('returns 200 with presigned URL for valid content_type', async () => {
    const req = { user: authUser, query: { content_type: 'image/jpeg' } } as unknown as Request;
    const res = makeRes();
    await UserController.getAvatarPresignedUrl(req, res, next);
    expect(mockGenerateUserAvatarPresignedUrl).toHaveBeenCalledWith('user-1', 'image/jpeg');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uploadUrl: 'https://...', path: 'key' });
  });

  it('calls next(err) when service throws', async () => {
    mockGenerateUserAvatarPresignedUrl.mockRejectedValueOnce(new Error('s3 fail'));
    const req = { user: authUser, query: { content_type: 'image/jpeg' } } as unknown as Request;
    await UserController.getAvatarPresignedUrl(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── validatePassword ──────────────────────────────────────────────────────────

describe('UserController.validatePassword', () => {
  it('returns 204 on success', async () => {
    const req = { user: authUser, body: { password: 'correct' } } as unknown as Request;
    const res = makeRes();
    await UserController.validatePassword(req, res, next);
    expect(mockValidatePassword).toHaveBeenCalledWith('user-1', 'correct');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls next(err) on error', async () => {
    mockValidatePassword.mockRejectedValueOnce(new Error('invalid'));
    const req = { user: authUser, body: { password: 'wrong' } } as unknown as Request;
    await UserController.validatePassword(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── toggle2fa ─────────────────────────────────────────────────────────────────

describe('UserController.toggle2fa', () => {
  it('returns 200 with 2FA result', async () => {
    const req = { user: authUser, body: { enabled: true } } as unknown as Request;
    const res = makeRes();
    await UserController.toggle2fa(req, res, next);
    expect(mockToggle2fa).toHaveBeenCalledWith('user-1', true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ two_factor_enabled: true });
  });

  it('calls next(err) on error', async () => {
    mockToggle2fa.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser, body: { enabled: false } } as unknown as Request;
    await UserController.toggle2fa(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── listUsers ─────────────────────────────────────────────────────────────────

describe('UserController.listUsers', () => {
  it('returns 200 with user list', async () => {
    const req = { user: authUser, query: { page: '2', limit: '10', status: 'active' } } as unknown as Request;
    const res = makeRes();
    await UserController.listUsers(req, res, next);
    expect(mockListUsers).toHaveBeenCalledWith(authUser, { page: 2, limit: 10, status: 'active', user_type: undefined, org_id: undefined });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes undefined for missing query params', async () => {
    const req = { user: authUser, query: {} } as unknown as Request;
    await UserController.listUsers(req, makeRes(), next);
    expect(mockListUsers).toHaveBeenCalledWith(authUser, {
      page: undefined, limit: undefined, status: undefined, user_type: undefined, org_id: undefined,
    });
  });

  it('calls next(err) on error', async () => {
    mockListUsers.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser, query: {} } as unknown as Request;
    await UserController.listUsers(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getUserById ───────────────────────────────────────────────────────────────

describe('UserController.getUserById', () => {
  it('returns 200 with user profile', async () => {
    const req = { user: authUser, params: { id: 'user-2' } } as unknown as Request;
    const res = makeRes();
    await UserController.getUserById(req, res, next);
    expect(mockGetUserById).toHaveBeenCalledWith(authUser, 'user-2');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockGetUserById.mockRejectedValueOnce(new Error('forbidden'));
    const req = { user: authUser, params: { id: 'user-99' } } as unknown as Request;
    await UserController.getUserById(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── updateUser ────────────────────────────────────────────────────────────────

describe('UserController.updateUser', () => {
  it('returns 200 with updated user', async () => {
    const req = { user: authUser, params: { id: 'user-2' }, body: { status: 'active' } } as unknown as Request;
    const res = makeRes();
    await UserController.updateUser(req, res, next);
    expect(mockUpdateUser).toHaveBeenCalledWith(authUser, 'user-2', { status: 'active' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockUpdateUser.mockRejectedValueOnce(new Error('forbidden'));
    const req = { user: authUser, params: { id: 'user-2' }, body: {} } as unknown as Request;
    await UserController.updateUser(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────────

describe('UserController.deleteUser', () => {
  it('returns 204 on success', async () => {
    const req = { user: authUser, params: { id: 'user-2' } } as unknown as Request;
    const res = makeRes();
    await UserController.deleteUser(req, res, next);
    expect(mockDeleteUser).toHaveBeenCalledWith(authUser, 'user-2');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls next(err) on error', async () => {
    mockDeleteUser.mockRejectedValueOnce(new Error('not found'));
    const req = { user: authUser, params: { id: 'ghost' } } as unknown as Request;
    await UserController.deleteUser(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── inviteUser ────────────────────────────────────────────────────────────────

describe('UserController.inviteUser', () => {
  it('returns 201 with invite result', async () => {
    const req = { user: authUser, body: { first_name: 'B', last_name: 'S', role_slug: 'dispatcher', email: 'b@s.com' } } as unknown as Request;
    const res = makeRes();
    await UserController.inviteUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('calls next(err) on error', async () => {
    mockInviteUser.mockRejectedValueOnce(new Error('role not found'));
    const req = { user: authUser, body: { first_name: 'B', last_name: 'S', role_slug: 'bad' } } as unknown as Request;
    await UserController.inviteUser(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── acceptInvite ──────────────────────────────────────────────────────────────

describe('UserController.acceptInvite', () => {
  it('issues token pair and calls sendAuthResponse', async () => {
    const user = { id: 'new-user', user_roles: [] };
    mockAcceptInvite.mockResolvedValueOnce({ user });
    const req = { body: { token: 'tok', password: 'pass' }, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    const res = makeRes();
    await UserController.acceptInvite(req, res, next);
    expect(mockIssueTokenPair).toHaveBeenCalledWith(user, undefined, '1.1.1.1', undefined);
    expect(mockSendAuthResponse).toHaveBeenCalled();
  });

  it('calls next(err) on error', async () => {
    mockAcceptInvite.mockRejectedValueOnce(new Error('bad token'));
    const req = { body: { token: 'bad', password: 'p' }, headers: {} } as unknown as Request;
    await UserController.acceptInvite(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
