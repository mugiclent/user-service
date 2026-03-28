/**
 * Tests for src/middleware/authenticate.ts
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../src/middleware/authenticate.js';
import { AppError } from '../../src/utils/AppError.js';

const makeReq = (headers: Record<string, string> = {}): Request =>
  ({ headers } as unknown as Request);

const res = {} as Response;
const next = vi.fn() as NextFunction;

const clearNext = () => (next as ReturnType<typeof vi.fn>).mockClear();

describe('authenticate', () => {
  beforeEach(clearNext);

  it('calls next(AppError 401) when X-User-ID is missing', () => {
    authenticate(makeReq({}), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0].status).toBe(401);
  });

  it('populates req.user from valid headers', () => {
    const req = makeReq({
      'x-user-id': 'user-1',
      'x-org-id': 'org-1',
      'x-user-type': 'staff',
      'x-user-roles': JSON.stringify(['org_admin']),
      'x-user-rules': JSON.stringify([]),
    });
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith(/* no arg */);
    expect((req as Record<string, unknown>)['user']).toMatchObject({
      id: 'user-1',
      org_id: 'org-1',
      user_type: 'staff',
      role_slugs: ['org_admin'],
    });
  });

  it('defaults org_id to null when X-Org-ID absent', () => {
    const req = makeReq({ 'x-user-id': 'user-1' });
    authenticate(req, res, next);
    expect((req as Record<string, unknown>)['user']).toMatchObject({ org_id: null });
  });

  it('defaults user_type to passenger when header absent', () => {
    const req = makeReq({ 'x-user-id': 'user-1' });
    authenticate(req, res, next);
    expect((req as Record<string, unknown>)['user']).toMatchObject({ user_type: 'passenger' });
  });

  it('defaults role_slugs to [] when X-User-Roles absent', () => {
    const req = makeReq({ 'x-user-id': 'user-1' });
    authenticate(req, res, next);
    expect((req as Record<string, unknown>)['user']).toMatchObject({ role_slugs: [] });
  });

  it('calls next(AppError 401) when X-User-Rules is invalid JSON', () => {
    const req = makeReq({ 'x-user-id': 'user-1', 'x-user-rules': 'not-json' });
    authenticate(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });

  it('calls next(AppError 401) when X-User-Roles is invalid JSON', () => {
    const req = makeReq({ 'x-user-id': 'user-1', 'x-user-roles': '{bad}' });
    authenticate(req, res, next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0].status).toBe(401);
  });

  it('calls next() with no arguments on success', () => {
    const req = makeReq({ 'x-user-id': 'user-1' });
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
