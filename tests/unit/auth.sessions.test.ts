/**
 * Tests for GET /auth/sessions and DELETE /auth/sessions/:id via AuthController + AuthService.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockListSessions = vi.fn();
const mockRevokeSession = vi.fn();
const mockUnregisterDevice = vi.fn();

vi.mock('../../src/services/auth.service.js', () => ({
  AuthService: {
    listSessions: mockListSessions,
    revokeSession: mockRevokeSession,
    unregisterDevice: mockUnregisterDevice,
    logout: vi.fn(),
  },
}));

vi.mock('../../src/utils/sendAuthResponse.js', () => ({
  clearAuthCookies: vi.fn(),
}));

const { AuthController } = await import('../../src/api/auth.controller.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn(), clearCookie: vi.fn() };
  res.status.mockReturnValue(res);
  res.clearCookie.mockReturnValue(res);
  return res as unknown as Response;
};

const next = vi.fn() as NextFunction;
const authUser = { id: 'user-1', org_id: null, user_type: 'staff', role_slugs: [], rules: [], locale: 'rw', session_id: 'sess-1' };

beforeEach(() => vi.clearAllMocks());

// ── GET /auth/sessions ────────────────────────────────────────────────────────

describe('AuthController.listSessions', () => {
  it('returns sessions for authenticated user', async () => {
    const sessions = {
      data: [
        { id: 'sess-1', device_name: 'iPhone', created_at: new Date(), last_used_at: new Date(), is_current: true },
        { id: 'sess-2', device_name: null, created_at: new Date(), last_used_at: null, is_current: false },
      ],
    };
    mockListSessions.mockResolvedValueOnce(sessions);
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await AuthController.listSessions(req, res, next);
    expect(mockListSessions).toHaveBeenCalledWith('user-1', 'sess-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(sessions);
  });

  it('calls next(err) on error', async () => {
    mockListSessions.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser } as unknown as Request;
    await AuthController.listSessions(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── DELETE /auth/sessions/:id ─────────────────────────────────────────────────

describe('AuthController.revokeSession', () => {
  it('revokes own session and returns 204', async () => {
    mockRevokeSession.mockResolvedValueOnce(undefined);
    const req = { user: authUser, params: { id: 'sess-2' } } as unknown as Request;
    const res = makeRes();
    await AuthController.revokeSession(req, res, next);
    expect(mockRevokeSession).toHaveBeenCalledWith('user-1', 'sess-2');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 for a session belonging to another user', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    mockRevokeSession.mockRejectedValueOnce(new AppError('SESSION_NOT_FOUND', 404));
    const req = { user: authUser, params: { id: 'sess-other' } } as unknown as Request;
    await AuthController.revokeSession(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_NOT_FOUND', status: 404 }));
  });

  it('returns 409 if already revoked', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    mockRevokeSession.mockRejectedValueOnce(new AppError('SESSION_ALREADY_REVOKED', 409));
    const req = { user: authUser, params: { id: 'sess-1' } } as unknown as Request;
    await AuthController.revokeSession(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_ALREADY_REVOKED', status: 409 }));
  });

  it('allows revoking the current session', async () => {
    mockRevokeSession.mockResolvedValueOnce(undefined);
    const req = { user: authUser, params: { id: 'sess-1' } } as unknown as Request;
    const res = makeRes();
    await AuthController.revokeSession(req, res, next);
    expect(mockRevokeSession).toHaveBeenCalledWith('user-1', 'sess-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

// ── DELETE /auth/register-device ─────────────────────────────────────────────

describe('AuthController.unregisterDevice', () => {
  it('unregisters device and returns 204', async () => {
    mockUnregisterDevice.mockResolvedValueOnce(undefined);
    const req = { user: authUser } as unknown as Request;
    const res = makeRes();
    await AuthController.unregisterDevice(req, res, next);
    expect(mockUnregisterDevice).toHaveBeenCalledWith('user-1', 'staff');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 404 when no device registered', async () => {
    const { AppError } = await import('../../src/utils/AppError.js');
    mockUnregisterDevice.mockRejectedValueOnce(new AppError('DEVICE_NOT_REGISTERED', 404));
    const req = { user: authUser } as unknown as Request;
    await AuthController.unregisterDevice(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEVICE_NOT_REGISTERED', status: 404 }));
  });

  it('calls next(err) on unexpected error', async () => {
    mockUnregisterDevice.mockRejectedValueOnce(new Error('db fail'));
    const req = { user: authUser } as unknown as Request;
    await AuthController.unregisterDevice(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
