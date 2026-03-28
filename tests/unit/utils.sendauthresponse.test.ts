/**
 * Tests for src/utils/sendAuthResponse.ts
 * Covers: sendAuthResponse (web + mobile), clearAuthCookies, sendRefreshResponse (web + mobile)
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/config/index.js', () => ({
  config: {
    cookie: { secure: false },
    jwt: { refreshTtlMs: 7 * 24 * 60 * 60 * 1000 },
  },
}));

const { sendAuthResponse, clearAuthCookies, sendRefreshResponse } =
  await import('../../src/utils/sendAuthResponse.js');

// ── helpers ────────────────────────────────────────────────────────────────────

const makeRes = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    end: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.cookie.mockReturnValue(res);
  res.clearCookie.mockReturnValue(res);
  return res as unknown as Response;
};

const tokens = { access: 'access-tok', refresh: 'refresh-tok' };
const user = { id: 'u-1', first_name: 'A', last_name: 'B' } as never;

// ── sendAuthResponse ───────────────────────────────────────────────────────────

describe('sendAuthResponse — mobile', () => {
  it('returns tokens + user in body with 200', () => {
    const req = { headers: { 'x-client-type': 'mobile' } } as unknown as Request;
    const res = makeRes();
    sendAuthResponse(req, res, { user, tokens });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'access-tok', refresh_token: 'refresh-tok', token_type: 'Bearer', user }),
    );
  });

  it('sets expires_in to 900 seconds', () => {
    const req = { headers: { 'x-client-type': 'mobile' } } as unknown as Request;
    const res = makeRes();
    sendAuthResponse(req, res, { user, tokens });
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.expires_in).toBe(900);
  });
});

describe('sendAuthResponse — web', () => {
  it('sets HttpOnly cookies and returns user in body', () => {
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();
    sendAuthResponse(req, res, { user, tokens });
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'access-tok', expect.objectContaining({ httpOnly: true }));
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-tok', expect.objectContaining({ httpOnly: true }));
    expect(res.json).toHaveBeenCalledWith({ user });
  });

  it('responds with status 200', () => {
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();
    sendAuthResponse(req, res, { user, tokens });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ── clearAuthCookies ───────────────────────────────────────────────────────────

describe('clearAuthCookies', () => {
  it('clears access_token and refresh_token cookies', () => {
    const res = makeRes();
    clearAuthCookies(res);
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
  });
});

// ── sendRefreshResponse ────────────────────────────────────────────────────────

describe('sendRefreshResponse — mobile', () => {
  it('returns tokens in body with 200', () => {
    const req = { headers: { 'x-client-type': 'mobile' } } as unknown as Request;
    const res = makeRes();
    sendRefreshResponse(req, res, tokens);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'access-tok', token_type: 'Bearer' }),
    );
  });
});

describe('sendRefreshResponse — web', () => {
  it('sets new cookies and responds 204', () => {
    const req = { headers: {} } as unknown as Request;
    const res = makeRes();
    sendRefreshResponse(req, res, tokens);
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'access-tok', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
