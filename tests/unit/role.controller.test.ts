/**
 * Tests for src/api/role.controller.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockListRoles = vi.fn();
const mockCreateRole = vi.fn();
const mockGetRoleById = vi.fn();
const mockUpdateRole = vi.fn();
const mockDeleteRole = vi.fn();
const mockAddGrant = vi.fn();
const mockRemoveGrant = vi.fn();

vi.mock('../../src/services/role.service.js', () => ({
  RoleService: {
    listRoles: mockListRoles,
    createRole: mockCreateRole,
    getRoleById: mockGetRoleById,
    updateRole: mockUpdateRole,
    deleteRole: mockDeleteRole,
    addGrant: mockAddGrant,
    removeGrant: mockRemoveGrant,
  },
}));

const { RoleController } = await import('../../src/api/role.controller.js');

beforeEach(() => vi.clearAllMocks());

// ── helpers ───────────────────────────────────────────────────────────────────

const makeReq = (overrides: Partial<Request> = {}) => ({
  user: { id: 'user-1', rules: [] },
  query: {},
  params: {},
  body: {},
  ...overrides,
} as unknown as Request);

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  end: vi.fn(),
} as unknown as Response);

const makeNext = () => vi.fn() as unknown as NextFunction;

// ── listRoles ─────────────────────────────────────────────────────────────────

describe('RoleController.listRoles', () => {
  it('returns 200 with role list', async () => {
    mockListRoles.mockResolvedValue([{ id: 'r-1', name: 'Admin' }]);
    const res = makeRes();
    await RoleController.listRoles(makeReq({ query: { org_id: 'org-1' } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ id: 'r-1', name: 'Admin' }]);
  });

  it('calls next(err) on service error', async () => {
    mockListRoles.mockRejectedValueOnce(new Error('DB error'));
    const next = makeNext();
    await RoleController.listRoles(makeReq(), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── createRole ────────────────────────────────────────────────────────────────

describe('RoleController.createRole', () => {
  it('returns 201 with created role', async () => {
    mockCreateRole.mockResolvedValue({ id: 'r-1', name: 'Manager' });
    const res = makeRes();
    await RoleController.createRole(makeReq({ body: { name: 'Manager', patterns: [] } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('calls next(err) on error', async () => {
    mockCreateRole.mockRejectedValueOnce(new Error('conflict'));
    const next = makeNext();
    await RoleController.createRole(makeReq({ body: { name: 'X', patterns: [] } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── getRoleById ───────────────────────────────────────────────────────────────

describe('RoleController.getRoleById', () => {
  it('returns 200 with role', async () => {
    mockGetRoleById.mockResolvedValue({ id: 'r-1', name: 'Admin' });
    const res = makeRes();
    await RoleController.getRoleById(makeReq({ params: { id: 'r-1' } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'r-1', name: 'Admin' });
  });

  it('calls next(err) on error', async () => {
    mockGetRoleById.mockRejectedValueOnce(new Error('not found'));
    const next = makeNext();
    await RoleController.getRoleById(makeReq({ params: { id: 'x' } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── updateRole ────────────────────────────────────────────────────────────────

describe('RoleController.updateRole', () => {
  it('returns 200 with updated role', async () => {
    mockUpdateRole.mockResolvedValue({ id: 'r-1', name: 'Updated' });
    const res = makeRes();
    await RoleController.updateRole(makeReq({ params: { id: 'r-1' }, body: { name: 'Updated' } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockUpdateRole.mockRejectedValueOnce(new Error('not found'));
    const next = makeNext();
    await RoleController.updateRole(makeReq({ params: { id: 'x' }, body: { name: 'X' } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── deleteRole ────────────────────────────────────────────────────────────────

describe('RoleController.deleteRole', () => {
  it('returns 204 on success', async () => {
    mockDeleteRole.mockResolvedValue(undefined);
    const res = makeRes();
    await RoleController.deleteRole(makeReq({ params: { id: 'r-1' } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('calls next(err) on error', async () => {
    mockDeleteRole.mockRejectedValueOnce(new Error('in use'));
    const next = makeNext();
    await RoleController.deleteRole(makeReq({ params: { id: 'r-1' } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── addGrant ──────────────────────────────────────────────────────────────────

describe('RoleController.addGrant', () => {
  it('returns 200 with updated role', async () => {
    mockAddGrant.mockResolvedValue({ id: 'r-1', grants: ['user:read:org'] });
    const res = makeRes();
    await RoleController.addGrant(makeReq({ params: { id: 'r-1' }, body: { patterns: ['user:read:org'] } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next(err) on error', async () => {
    mockAddGrant.mockRejectedValueOnce(new Error('invalid pattern'));
    const next = makeNext();
    await RoleController.addGrant(makeReq({ params: { id: 'r-1' }, body: { patterns: [] } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// ── removeGrant ───────────────────────────────────────────────────────────────

describe('RoleController.removeGrant', () => {
  it('returns 204 on success', async () => {
    mockRemoveGrant.mockResolvedValue(undefined);
    const res = makeRes();
    await RoleController.removeGrant(makeReq({ params: { id: 'r-1', grantId: 'g-1' } } as never), res, makeNext());
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('calls next(err) on error', async () => {
    mockRemoveGrant.mockRejectedValueOnce(new Error('not found'));
    const next = makeNext();
    await RoleController.removeGrant(makeReq({ params: { id: 'r-1', grantId: 'g-1' } } as never), makeRes(), next);
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
