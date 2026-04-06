/**
 * Tests for src/services/permission.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockPermissionFindMany = vi.fn();

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    permission: { findMany: mockPermissionFindMany },
  },
}));

const { PermissionService } = await import('../../src/services/permission.service.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makePermission = (overrides: Record<string, unknown> = {}) => ({
  id: 'perm-1',
  code: 'user:read',
  action: 'read',
  subject: 'User',
  display_name: 'View users',
  description: 'Read user profile information',
  group: 'User management',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ── listPermissions ────────────────────────────────────────────────────────────

describe('PermissionService.listPermissions', () => {
  it('returns serialized permissions from DB', async () => {
    const perms = [
      makePermission({ id: 'p1', code: 'user:read' }),
      makePermission({ id: 'p2', code: 'user:update', action: 'update', display_name: 'Edit users' }),
    ];
    mockPermissionFindMany.mockResolvedValueOnce(perms);

    const result = await PermissionService.listPermissions();

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'p1',
      code: 'user:read',
      action: 'read',
      subject: 'User',
      display_name: 'View users',
      group: 'User management',
    });
  });

  it('queries DB ordered by group, subject, action', async () => {
    mockPermissionFindMany.mockResolvedValueOnce([]);
    await PermissionService.listPermissions();
    expect(mockPermissionFindMany).toHaveBeenCalledWith({
      orderBy: [{ group: 'asc' }, { subject: 'asc' }, { action: 'asc' }],
    });
  });

  it('returns empty array when no permissions exist', async () => {
    mockPermissionFindMany.mockResolvedValueOnce([]);
    const result = await PermissionService.listPermissions();
    expect(result).toEqual([]);
  });

  it('includes all expected fields in serialized output', async () => {
    const perm = makePermission();
    mockPermissionFindMany.mockResolvedValueOnce([perm]);
    const [result] = await PermissionService.listPermissions();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('display_name');
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('group');
  });
});
