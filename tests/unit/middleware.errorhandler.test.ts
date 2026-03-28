/**
 * Tests for src/middleware/errorHandler.ts
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError } from '../../src/utils/AppError.js';

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

const req = { headers: {} } as unknown as Request;
const next = vi.fn() as NextFunction;

describe('errorHandler', () => {
  it('returns status + code + message for AppError', () => {
    const res = makeRes();
    errorHandler(new AppError('NOT_FOUND', 404), req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });

  it('includes details when AppError has them', () => {
    const res = makeRes();
    const details = [{ msg: 'bad' }];
    errorHandler(new AppError('VALIDATION_ERROR', 422, details), req, res, next);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.details).toEqual(details);
  });

  it('does not include details key when AppError has none', () => {
    const res = makeRes();
    errorHandler(new AppError('FORBIDDEN', 403), req, res, next);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error).not.toHaveProperty('details');
  });

  it('returns 500 INTERNAL_SERVER_ERROR for unknown errors', () => {
    const res = makeRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(new Error('boom'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
    });
    consoleSpy.mockRestore();
  });

  it('includes request-id in log for unknown errors', () => {
    const res = makeRes();
    const reqWithId = { headers: { 'x-request-id': 'req-123' } } as unknown as Request;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(new Error('boom'), reqWithId, res, next);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[errorHandler] Unhandled error',
      expect.objectContaining({ requestId: 'req-123' }),
    );
    consoleSpy.mockRestore();
  });

  it('handles non-Error thrown values', () => {
    const res = makeRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler('string error', req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    consoleSpy.mockRestore();
  });
});
