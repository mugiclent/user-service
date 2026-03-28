/**
 * Tests for src/middleware/rateLimiter.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockIncr = vi.fn();
const mockExpire = vi.fn();

vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ incr: mockIncr, expire: mockExpire }),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    rateLimit: {
      login: { max: 5, windowSeconds: 900 },
      reset: { max: 3, windowSeconds: 3600 },
    },
    otp: { maxAttempts: 3, windowSeconds: 600 },
  },
}));

const { loginRateLimiter, resetRateLimiter, otpRateLimiter } =
  await import('../../src/middleware/rateLimiter.js');

const res = {} as Response;

beforeEach(() => {
  vi.clearAllMocks();
  mockExpire.mockResolvedValue(1);
});

// ── loginRateLimiter ───────────────────────────────────────────────────────────

describe('loginRateLimiter', () => {
  it('calls next() with no error when under limit', async () => {
    mockIncr.mockResolvedValue(1);
    const req = { body: { identifier: 'user@example.com' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await loginRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockExpire).toHaveBeenCalledWith('ratelimit:login:user@example.com', 900);
  });

  it('calls next(AppError 429) when over limit', async () => {
    mockIncr.mockResolvedValue(6); // max is 5
    const req = { body: { identifier: 'user@example.com' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await loginRateLimiter(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(429);
    expect(err.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('does not set expire when count > 1 (key already has TTL)', async () => {
    mockIncr.mockResolvedValue(3);
    const req = { body: { identifier: 'user@example.com' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await loginRateLimiter(req, res, next);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it('skips rate limiting when identifier is absent', async () => {
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await loginRateLimiter(req, res, next);
    expect(mockIncr).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('fails open on Redis error', async () => {
    mockIncr.mockRejectedValue(new Error('redis down'));
    const req = { body: { identifier: 'u' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await loginRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ── resetRateLimiter ──────────────────────────────────────────────────────────

describe('resetRateLimiter', () => {
  it('blocks after max attempts', async () => {
    mockIncr.mockResolvedValue(4); // max is 3
    const req = { body: { identifier: '+250788000001' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await resetRateLimiter(req, res, next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0].status).toBe(429);
  });

  it('skips when no identifier', async () => {
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await resetRateLimiter(req, res, next);
    expect(mockIncr).not.toHaveBeenCalled();
  });
});

// ── otpRateLimiter ─────────────────────────────────────────────────────────────

describe('otpRateLimiter', () => {
  it('blocks after maxAttempts', async () => {
    mockIncr.mockResolvedValue(4); // maxAttempts is 3
    const req = { body: { phone_number: '+250788000001' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await otpRateLimiter(req, res, next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0].status).toBe(429);
  });

  it('skips when no phone_number', async () => {
    const req = { body: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await otpRateLimiter(req, res, next);
    expect(mockIncr).not.toHaveBeenCalled();
  });

  it('fails open on Redis error', async () => {
    mockIncr.mockRejectedValue(new Error('redis down'));
    const req = { body: { phone_number: '+250788000001' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await otpRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
