/**
 * Tests for src/middleware/orgBillingGuard.ts
 *
 * The guard reads org_blocked:{org_id} from Redis (written by the billing-service).
 * When the key exists, all mutating requests from org members are blocked (403).
 * GET/HEAD, auth bypass paths, platform admins, and passengers always pass through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../src/utils/AppError.js';

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockExists = vi.fn();
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ exists: mockExists }),
}));

// ── ability mock — controls platform-scope detection ─────────────────────────

const mockGetScopeFor = vi.fn();
vi.mock('../../src/utils/ability.js', () => ({
  buildAbilityFromRules: vi.fn(() => ({})),
  getScopeFor: mockGetScopeFor,
}));

const { orgBillingGuard } = await import('../../src/middleware/orgBillingGuard.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makeReq = (overrides: Partial<{
  method: string;
  path: string;
  org_id: string | null;
  rules: unknown[];
}> = {}): Request => ({
  method: overrides.method ?? 'POST',
  path: overrides.path ?? '/api/v1/users/invite',
  user: {
    id: 'user-1',
    org_id: overrides.org_id !== undefined ? overrides.org_id : 'org-1',
    user_type: 'staff',
    role_slugs: [],
    rules: overrides.rules ?? [],
    locale: 'rw',
  },
} as unknown as Request);

const res = {} as Response;

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(0);          // default: org is NOT blocked
  mockGetScopeFor.mockReturnValue('org');   // default: org-scoped user
});

// ── bypass: no org_id (passengers / platform users without org) ───────────────

describe('orgBillingGuard — bypass: no org_id', () => {
  it('calls next() with no error when user has no org_id', async () => {
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ org_id: null }), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('calls next() with no error when req.user is absent', async () => {
    const next = vi.fn() as NextFunction;
    const req = { method: 'POST', path: '/api/v1/users' } as unknown as Request;
    await orgBillingGuard(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockExists).not.toHaveBeenCalled();
  });
});

// ── bypass: safe HTTP methods ─────────────────────────────────────────────────

describe('orgBillingGuard — bypass: GET and HEAD', () => {
  it.each(['GET', 'HEAD'])('%s passes through without Redis check', async (method) => {
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method }), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockExists).not.toHaveBeenCalled();
  });
});

// ── bypass: platform-scoped admins ───────────────────────────────────────────

describe('orgBillingGuard — bypass: platform admin', () => {
  it('calls next() with no error for platform-scoped user even when org is blocked', async () => {
    mockGetScopeFor.mockReturnValue('platform');
    mockExists.mockResolvedValue(1);
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method: 'POST' }), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('does NOT hit Redis when user is platform-scoped', async () => {
    mockGetScopeFor.mockReturnValue('platform');
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method: 'DELETE' }), res, next);
    expect(mockExists).not.toHaveBeenCalled();
  });
});

// ── bypass: allowlisted auth paths ───────────────────────────────────────────

describe('orgBillingGuard — bypass: auth allowlist', () => {
  it.each([
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/logout-all'],
    ['POST', '/api/v1/auth/refresh'],
  ])('%s %s passes through even when org is blocked', async (method, path) => {
    mockExists.mockResolvedValue(1);
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method, path }), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockExists).not.toHaveBeenCalled();
  });
});

// ── blocked org: mutating methods rejected ────────────────────────────────────

describe('orgBillingGuard — blocked org: mutating requests rejected', () => {
  beforeEach(() => mockExists.mockResolvedValue(1));

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    '%s returns 403 ORG_BILLING_BLOCKED when org is blocked',
    async (method) => {
      const next = vi.fn() as NextFunction;
      await orgBillingGuard(makeReq({ method }), res, next);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(403);
      expect(err.code).toBe('ORG_BILLING_OVERDUE');
    },
  );

  it('checks the correct Redis key (org_blocked:{org_id})', async () => {
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method: 'POST', org_id: 'org-abc' }), res, next);
    expect(mockExists).toHaveBeenCalledWith('org_blocked:org-abc');
  });
});

// ── unblocked org: mutating requests allowed ──────────────────────────────────

describe('orgBillingGuard — unblocked org: mutating requests allowed', () => {
  it('calls next() with no error when org is not blocked', async () => {
    mockExists.mockResolvedValue(0);
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method: 'POST' }), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ── Redis failure: fail open ──────────────────────────────────────────────────

describe('orgBillingGuard — Redis failure', () => {
  it('calls next() with no error when Redis throws (fail open)', async () => {
    mockExists.mockRejectedValue(new Error('Redis connection lost'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const next = vi.fn() as NextFunction;
    await orgBillingGuard(makeReq({ method: 'POST' }), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
