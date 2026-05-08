/**
 * Tests for src/api/permission.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockListPermissions = vi.fn();
vi.mock('../../src/services/permission.service.js', () => ({
  PermissionService: { listPermissions: mockListPermissions },
}));

const { PermissionController } = await import('../../src/api/permission.controller.js');

beforeEach(() => vi.clearAllMocks());

describe('PermissionController.listPermissions', () => {
  it('returns 200 with permissions wrapped in data', async () => {
    mockListPermissions.mockResolvedValue([{ name: 'read', subject: 'User' }]);
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await PermissionController.listPermissions(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [{ name: 'read', subject: 'User' }] });
  });

  it('calls next(err) on service error', async () => {
    mockListPermissions.mockRejectedValueOnce(new Error('DB error'));
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await PermissionController.listPermissions(req, res, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
