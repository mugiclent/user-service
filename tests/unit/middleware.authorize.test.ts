/**
 * Tests for src/middleware/authorize.ts
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorize } from '../../src/middleware/authorize.js';
import { AppError } from '../../src/utils/AppError.js';

const makeReq = (rules: unknown[] = []) =>
  ({
    user: { id: 'u', org_id: null, user_type: 'staff', role_slugs: [], rules },
  } as unknown as Request);

const res = {} as Response;

describe('authorize', () => {
  it('calls next() when ability permits the action', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq([{ action: 'read', subject: 'User' }]);
    authorize('read', 'User')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError 403) when ability denies the action', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq([]); // no rules → no permissions
    authorize('delete', 'User')(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('allows manage:all to pass any action', () => {
    const next = vi.fn() as NextFunction;
    const req = makeReq([{ action: 'manage', subject: 'all' }]);
    authorize('delete', 'User')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
