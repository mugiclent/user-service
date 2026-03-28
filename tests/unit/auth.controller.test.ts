/**
 * Tests for src/api/auth.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockAuthServiceLogin = vi.fn();
const mockAuthServiceVerify2fa = vi.fn();
const mockAuthServiceRegister = vi.fn();
const mockAuthServiceVerifyPhone = vi.fn();
const mockAuthServiceForgotPassword = vi.fn().mockResolvedValue(undefined);
const mockAuthServiceResetPassword = vi.fn().mockResolvedValue(undefined);
const mockAuthServiceRefresh = vi.fn();
const mockAuthServiceLogout = vi.fn().mockResolvedValue(undefined);
const mockAuthServiceLogoutAll = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/auth.service.js', () => ({
  AuthService: {
    login: mockAuthServiceLogin,
    verify2fa: mockAuthServiceVerify2fa,
    register: mockAuthServiceRegister,
    verifyPhone: mockAuthServiceVerifyPhone,
    forgotPassword: mockAuthServiceForgotPassword,
    resetPassword: mockAuthServiceResetPassword,
    refresh: mockAuthServiceRefresh,
    logout: mockAuthServiceLogout,
    logoutAll: mockAuthServiceLogoutAll,
  },
}));

const mockSerializeUserForAuth = vi.fn().mockReturnValue({ id: 'user-1', serialized: true });

vi.mock('../../src/models/serializers.js', () => ({
  serializeUserForAuth: mockSerializeUserForAuth,
}));

const mockSendAuthResponse = vi.fn();
const mockSendRefreshResponse = vi.fn();
const mockClearAuthCookies = vi.fn();

vi.mock('../../src/utils/sendAuthResponse.js', () => ({
  sendAuthResponse: mockSendAuthResponse,
  sendRefreshResponse: mockSendRefreshResponse,
  clearAuthCookies: mockClearAuthCookies,
}));

const mockPrismaUserUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../src/models/index.js', () => ({
  prisma: { user: { update: mockPrismaUserUpdate } },
}));

const { AuthController } = await import('../../src/api/auth.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;

const makeUser = () => ({
  id: 'user-1',
  org_id: null,
  user_type: 'passenger',
  role_slugs: [],
  rules: [],
});

beforeEach(() => vi.clearAllMocks());

// ── login ─────────────────────────────────────────────────────────────────────

describe('AuthController.login', () => {
  it('returns 202 with requires_2fa payload when 2FA is needed', async () => {
    mockAuthServiceLogin.mockResolvedValueOnce({ requires_2fa: true, user_id: 'user-1', expires_in: 300 });
    const req = { body: { identifier: 'u@e.com', password: 'pass' }, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    const res = makeRes();
    await AuthController.login(req, res, next);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ requires_2fa: true, user_id: 'user-1', expires_in: 300 });
  });

  it('calls sendAuthResponse for normal login', async () => {
    const user = makeUser();
    mockAuthServiceLogin.mockResolvedValueOnce({ requires_2fa: false, user, tokens: { access: 'a', refresh: 'r' } });
    const req = { body: { identifier: 'u@e.com', password: 'pass' }, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    const res = makeRes();
    await AuthController.login(req, res, next);
    expect(mockSendAuthResponse).toHaveBeenCalledWith(req, res, {
      user: { id: 'user-1', serialized: true },
      tokens: { access: 'a', refresh: 'r' },
    });
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceLogin.mockRejectedValueOnce(new Error('fail'));
    const req = { body: {}, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    await AuthController.login(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── verify2fa ─────────────────────────────────────────────────────────────────

describe('AuthController.verify2fa', () => {
  it('calls sendAuthResponse on success', async () => {
    const user = makeUser();
    mockAuthServiceVerify2fa.mockResolvedValueOnce({ user, tokens: { access: 'a', refresh: 'r' } });
    const req = { body: { user_id: 'user-1', otp: '123456' }, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    const res = makeRes();
    await AuthController.verify2fa(req, res, next);
    expect(mockSendAuthResponse).toHaveBeenCalled();
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceVerify2fa.mockRejectedValueOnce(new Error('bad otp'));
    const req = { body: { user_id: 'user-1', otp: 'bad' }, headers: {} } as unknown as Request;
    await AuthController.verify2fa(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── register ──────────────────────────────────────────────────────────────────

describe('AuthController.register', () => {
  it('returns 201 with registration result', async () => {
    mockAuthServiceRegister.mockResolvedValueOnce({ user_id: 'new-user', expires_in: 300 });
    const req = { body: { first_name: 'A', last_name: 'B', phone_number: '+250788000001', password: 'pass' } } as unknown as Request;
    const res = makeRes();
    await AuthController.register(req, res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ user_id: 'new-user', expires_in: 300 });
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceRegister.mockRejectedValueOnce(new Error('dup'));
    await AuthController.register({ body: {} } as unknown as Request, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── verifyPhone ───────────────────────────────────────────────────────────────

describe('AuthController.verifyPhone', () => {
  it('calls sendAuthResponse on success', async () => {
    const user = makeUser();
    mockAuthServiceVerifyPhone.mockResolvedValueOnce({ user, tokens: { access: 'a', refresh: 'r' } });
    const req = { body: { user_id: 'user-1', otp: '123456' }, headers: {}, ip: '1.1.1.1' } as unknown as Request;
    await AuthController.verifyPhone(req, makeRes(), next);
    expect(mockSendAuthResponse).toHaveBeenCalled();
  });
});

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('AuthController.forgotPassword', () => {
  it('returns 204', async () => {
    const req = { body: { identifier: 'u@e.com' } } as unknown as Request;
    const res = makeRes();
    await AuthController.forgotPassword(req, res, next);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('AuthController.resetPassword', () => {
  it('clears cookies and returns 204', async () => {
    const req = { body: { identifier: 'u@e.com', otp: '123456', new_password: 'NewPass1!' } } as unknown as Request;
    const res = makeRes();
    await AuthController.resetPassword(req, res, next);
    expect(mockClearAuthCookies).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

// ── refresh ───────────────────────────────────────────────────────────────────

describe('AuthController.refresh', () => {
  it('returns 401 when no refresh token present', async () => {
    const req = { headers: {}, cookies: {} } as unknown as Request;
    const res = makeRes();
    await AuthController.refresh(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'MISSING_REFRESH_TOKEN' } });
  });

  it('extracts Bearer token for mobile client', async () => {
    const tokens = { access: 'new-access', refresh: 'new-refresh' };
    mockAuthServiceRefresh.mockResolvedValueOnce({ tokens });
    const req = {
      headers: { 'x-client-type': 'mobile', authorization: 'Bearer my-refresh-token' },
      cookies: {},
    } as unknown as Request;
    await AuthController.refresh(req, makeRes(), next);
    expect(mockAuthServiceRefresh).toHaveBeenCalledWith('my-refresh-token');
    expect(mockSendRefreshResponse).toHaveBeenCalled();
  });

  it('extracts cookie token for web client', async () => {
    const tokens = { access: 'new-access', refresh: 'new-refresh' };
    mockAuthServiceRefresh.mockResolvedValueOnce({ tokens });
    const req = {
      headers: {},
      cookies: { refresh_token: 'cookie-refresh-token' },
    } as unknown as Request;
    await AuthController.refresh(req, makeRes(), next);
    expect(mockAuthServiceRefresh).toHaveBeenCalledWith('cookie-refresh-token');
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceRefresh.mockRejectedValueOnce(new Error('invalid'));
    const req = { headers: {}, cookies: { refresh_token: 'tok' } } as unknown as Request;
    await AuthController.refresh(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('AuthController.logout', () => {
  it('clears cookies and returns 204 even without token', async () => {
    const req = { headers: {}, cookies: {} } as unknown as Request;
    const res = makeRes();
    await AuthController.logout(req, res, next);
    expect(mockAuthServiceLogout).not.toHaveBeenCalled();
    expect(mockClearAuthCookies).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls logout service when mobile Bearer token present', async () => {
    const req = {
      headers: { 'x-client-type': 'mobile', authorization: 'Bearer tok' },
      cookies: {},
    } as unknown as Request;
    const res = makeRes();
    await AuthController.logout(req, res, next);
    expect(mockAuthServiceLogout).toHaveBeenCalledWith('tok');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls logout service with cookie token for web client', async () => {
    const req = { headers: {}, cookies: { refresh_token: 'my-tok' } } as unknown as Request;
    await AuthController.logout(req, makeRes(), next);
    expect(mockAuthServiceLogout).toHaveBeenCalledWith('my-tok');
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceLogout.mockRejectedValueOnce(new Error('db fail'));
    const req = { headers: {}, cookies: { refresh_token: 'tok' } } as unknown as Request;
    await AuthController.logout(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── logoutAll ─────────────────────────────────────────────────────────────────

describe('AuthController.logoutAll', () => {
  it('calls logoutAll and returns 204', async () => {
    const req = { user: makeUser() } as unknown as Request;
    const res = makeRes();
    await AuthController.logoutAll(req, res, next);
    expect(mockAuthServiceLogoutAll).toHaveBeenCalledWith('user-1');
    expect(mockClearAuthCookies).toHaveBeenCalledWith(res);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls next(err) on error', async () => {
    mockAuthServiceLogoutAll.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: makeUser() } as unknown as Request;
    await AuthController.logoutAll(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── registerDevice ────────────────────────────────────────────────────────────

describe('AuthController.registerDevice', () => {
  it('updates user fcm_token and returns 204', async () => {
    const req = { user: makeUser(), body: { fcm_token: 'fcm-abc-123' } } as unknown as Request;
    const res = makeRes();
    await AuthController.registerDevice(req, res, next);
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { fcm_token: 'fcm-abc-123', notif_channel: 'app' },
    });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('calls next(err) on error', async () => {
    mockPrismaUserUpdate.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: makeUser(), body: { fcm_token: 'tok' } } as unknown as Request;
    await AuthController.registerDevice(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
