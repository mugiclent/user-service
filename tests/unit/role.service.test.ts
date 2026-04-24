/**
 * Tests for src/services/role.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AbilityModule from '../../src/utils/ability.js';

const mockCompressPatterns = vi.fn().mockImplementation((patterns: string[]) => patterns);

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockRoleFindMany = vi.fn();
const mockRoleFindUnique = vi.fn();
const mockRoleFindFirst = vi.fn();
const mockRoleCreate = vi.fn();
const mockRoleUpdate = vi.fn();
const mockRoleDelete = vi.fn();
const mockRoleFindUniqueOrThrow = vi.fn();

const mockRoleGrantFindUnique = vi.fn();
const mockRoleGrantCreate = vi.fn();
const mockRoleGrantCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockRoleGrantDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockRoleGrantDelete = vi.fn();

const mockInvitationCount = vi.fn().mockResolvedValue(0);

const mockTxRoleCreate = vi.fn();
const mockTxRoleGrantCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxRoleGrantDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxRoleFindUniqueOrThrow = vi.fn();

const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    role: { create: mockTxRoleCreate, findUniqueOrThrow: mockTxRoleFindUniqueOrThrow },
    roleGrant: { createMany: mockTxRoleGrantCreateMany, deleteMany: mockTxRoleGrantDeleteMany },
  };
  return fn(tx);
});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    role: {
      findMany: mockRoleFindMany,
      findUnique: mockRoleFindUnique,
      findFirst: mockRoleFindFirst,
      create: mockRoleCreate,
      update: mockRoleUpdate,
      delete: mockRoleDelete,
      findUniqueOrThrow: mockRoleFindUniqueOrThrow,
    },
    roleGrant: {
      findUnique: mockRoleGrantFindUnique,
      create: mockRoleGrantCreate,
      createMany: mockRoleGrantCreateMany,
      deleteMany: mockRoleGrantDeleteMany,
      delete: mockRoleGrantDelete,
    },
    invitation: {
      count: mockInvitationCount,
    },
    $transaction: mockTransaction,
  },
}));

const mockPublishAudit = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: mockPublishAudit,
}));

vi.mock('../../src/utils/ability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AbilityModule>();
  return {
    ...actual,
    isValidPattern: vi.fn().mockReturnValue(true),
    maxScopeFromPatterns: vi.fn().mockReturnValue('org'),
    compressPatterns: mockCompressPatterns,
    SCOPE_RANK: { own: 0, org: 1, platform: 2 },
  };
});

vi.mock('../../src/utils/slugify.js', () => ({
  slugify: vi.fn().mockImplementation((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
}));

// bootstrap.ts mock — PERMISSIONS catalog
vi.mock('../../src/loaders/bootstrap.js', () => ({
  PERMISSIONS: [],
}));

const { RoleService } = await import('../../src/services/role.service.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makePlatformAdmin = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  org_id: null as string | null,
  user_type: 'staff' as const,
  role_slugs: ['platform-admin'],
  rules: [{ action: 'manage', subject: 'all' }],
  ...overrides,
});

const makeOrgAdmin = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-2',
  org_id: 'org-1',
  user_type: 'staff' as const,
  role_slugs: ['org-admin'],
  rules: [
    { action: 'manage', subject: 'Role', conditions: { org_id: 'org-1' } },
    { action: 'read',   subject: 'Role', conditions: { org_id: null } },
  ],
  ...overrides,
});

const makeOtherUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-3',
  org_id: 'org-1',
  user_type: 'staff' as const,
  role_slugs: ['dispatcher'],
  rules: [],
  ...overrides,
});

const makeRole = (overrides: Record<string, unknown> = {}) => ({
  id: 'role-1',
  name: 'Custom Role',
  slug: 'custom-role',
  description: null as string | null,
  org_id: null as string | null,
  is_managed: false,
  created_at: new Date(),
  role_grants: [] as { id: string; pattern: string; is_managed: boolean; created_at: Date }[],
  ...overrides,
});

const makeGrant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  role_id: 'role-1',
  pattern: 'user:read:org',
  is_managed: false,
  created_at: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listRoles ─────────────────────────────────────────────────────────────────

describe('RoleService.listRoles', () => {
  it('non-admin staff see global + own org roles, excluding passenger', async () => {
    mockRoleFindMany.mockResolvedValueOnce([]);
    await RoleService.listRoles(makeOtherUser() as never, {});
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ org_id: null }, { org_id: 'org-1' }],
          slug: { not: 'passenger' },
        },
      }),
    );
  });

  it('platform admin gets all roles', async () => {
    mockRoleFindMany.mockResolvedValueOnce([makeRole()]);
    const result = await RoleService.listRoles(makePlatformAdmin() as never, {});
    expect(result.data).toHaveLength(1);
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('platform admin can filter by org_id', async () => {
    mockRoleFindMany.mockResolvedValueOnce([]);
    await RoleService.listRoles(makePlatformAdmin() as never, { org_id: 'org-42' });
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { org_id: 'org-42' } }),
    );
  });

  it('org admin sees global + own org roles, excluding passenger', async () => {
    mockRoleFindMany.mockResolvedValueOnce([makeRole()]);
    await RoleService.listRoles(makeOrgAdmin() as never, {});
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ org_id: null }, { org_id: 'org-1' }],
          slug: { not: 'passenger' },
        },
      }),
    );
  });

  it('does not include grants in list response — fetch detail for grants', async () => {
    mockRoleFindMany.mockResolvedValueOnce([makeRole()]);
    const result = await RoleService.listRoles(makePlatformAdmin() as never, {});
    expect(result.data[0]).not.toHaveProperty('grants');
    expect(result.data[0]).toHaveProperty('name');
    expect(result.data[0]).toHaveProperty('description');
  });
});

// ── createRole ────────────────────────────────────────────────────────────────

describe('RoleService.createRole', () => {
  const base = { name: 'Viewer', patterns: ['user:read:org'] };

  it('throws FORBIDDEN for non-admin users', async () => {
    await expect(RoleService.createRole(makeOtherUser() as never, base)).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ROLE_ALREADY_EXISTS when slug is taken in same org', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(makeRole());
    await expect(RoleService.createRole(makePlatformAdmin() as never, base)).rejects.toMatchObject({
      code: 'ROLE_ALREADY_EXISTS', status: 409,
    });
  });

  it('creates role and grants in a transaction', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    const created = makeRole({ id: 'new-role', name: 'Viewer' });
    mockTxRoleCreate.mockResolvedValueOnce(created);
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce({ ...created, role_grants: [] });

    const result = await RoleService.createRole(makePlatformAdmin() as never, base);

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Viewer', slug: 'viewer' }) }),
    );
    expect(mockTxRoleGrantCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ role_id: 'new-role', pattern: 'user:read:org' }] }),
    );
    expect(result).toMatchObject({ name: 'Viewer' });
  });

  it('org admin creates role scoped to their own org', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    mockTxRoleCreate.mockResolvedValueOnce(makeRole({ org_id: 'org-1' }));
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(makeRole({ org_id: 'org-1', role_grants: [] }));

    await RoleService.createRole(makeOrgAdmin() as never, base);

    expect(mockTxRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ org_id: 'org-1' }) }),
    );
  });

  it('uses provided slug when given', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    mockTxRoleCreate.mockResolvedValueOnce(makeRole({ slug: 'my-custom-slug' }));
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(makeRole({ slug: 'my-custom-slug', role_grants: [] }));

    await RoleService.createRole(makePlatformAdmin() as never, { ...base, slug: 'my-custom-slug' });

    expect(mockTxRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slug: 'my-custom-slug' }) }),
    );
  });

  it('compresses patterns before saving to the DB', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    const created = makeRole({ id: 'new-role' });
    mockTxRoleCreate.mockResolvedValueOnce(created);
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce({ ...created, role_grants: [] });
    mockCompressPatterns.mockReturnValueOnce(['user:*:org']);

    await RoleService.createRole(makePlatformAdmin() as never, {
      name: 'Viewer',
      patterns: ['user:read:org', 'user:update:org', 'user:delete:org'],
    });

    expect(mockTxRoleGrantCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ role_id: 'new-role', pattern: 'user:*:org' }] }),
    );
  });

  it('publishes audit event', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    mockTxRoleCreate.mockResolvedValueOnce(makeRole({ id: 'new-role' }));
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(makeRole({ id: 'new-role', role_grants: [] }));

    await RoleService.createRole(makePlatformAdmin() as never, base);

    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', resource: 'Role' }),
    );
  });
});

// ── getRoleById ───────────────────────────────────────────────────────────────

describe('RoleService.getRoleById', () => {
  it('non-admin staff cannot view another org role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org' }));
    await expect(RoleService.getRoleById(makeOtherUser() as never, 'role-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('non-admin staff cannot view the passenger role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: null, slug: 'passenger' }));
    await expect(RoleService.getRoleById(makeOtherUser() as never, 'role-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(null);
    await expect(RoleService.getRoleById(makePlatformAdmin() as never, 'ghost')).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('platform admin can view any role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org' }));
    const result = await RoleService.getRoleById(makePlatformAdmin() as never, 'role-1');
    expect(result).toMatchObject({ id: 'role-1' });
  });

  it('org admin can view global role (org_id=null)', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: null }));
    const result = await RoleService.getRoleById(makeOrgAdmin() as never, 'role-1');
    expect(result).toMatchObject({ id: 'role-1' });
  });

  it('org admin can view their own org role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'org-1' }));
    const result = await RoleService.getRoleById(makeOrgAdmin() as never, 'role-1');
    expect(result).toMatchObject({ id: 'role-1' });
  });

  it('org admin cannot view another org role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org' }));
    await expect(RoleService.getRoleById(makeOrgAdmin() as never, 'role-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });
});

// ── updateRole ────────────────────────────────────────────────────────────────

describe('RoleService.updateRole', () => {
  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(null);
    await expect(RoleService.updateRole(makePlatformAdmin() as never, 'ghost', { name: 'X' })).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('throws MANAGED_ROLE_IMMUTABLE for is_managed role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ is_managed: true }));
    await expect(RoleService.updateRole(makePlatformAdmin() as never, 'role-1', { name: 'X' })).rejects.toMatchObject({
      code: 'MANAGED_ROLE_IMMUTABLE', status: 403,
    });
  });

  it('org admin cannot update another org role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org', is_managed: false }));
    await expect(RoleService.updateRole(makeOrgAdmin() as never, 'role-1', { name: 'X' })).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('updates role name successfully', async () => {
    const existing = makeRole({ name: 'Old Name', org_id: null });
    mockRoleFindUnique.mockResolvedValueOnce(existing);
    mockRoleUpdate.mockResolvedValueOnce({ ...existing, name: 'New Name' });

    const result = await RoleService.updateRole(makePlatformAdmin() as never, 'role-1', { name: 'New Name' });
    expect(result).toMatchObject({ name: 'New Name' });
    expect(mockRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'New Name' } }),
    );
  });
});

// ── deleteRole ────────────────────────────────────────────────────────────────

describe('RoleService.deleteRole', () => {
  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(null);
    await expect(RoleService.deleteRole(makePlatformAdmin() as never, 'ghost')).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('throws MANAGED_ROLE_IMMUTABLE for is_managed role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ is_managed: true }));
    await expect(RoleService.deleteRole(makePlatformAdmin() as never, 'role-1')).rejects.toMatchObject({
      code: 'MANAGED_ROLE_IMMUTABLE', status: 403,
    });
  });

  it('throws FORBIDDEN when org admin targets another org role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org', is_managed: false }));
    await expect(RoleService.deleteRole(makeOrgAdmin() as never, 'role-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ROLE_HAS_PENDING_INVITATIONS when pending invitations exist', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: null, is_managed: false }));
    mockInvitationCount.mockResolvedValueOnce(2);
    await expect(RoleService.deleteRole(makePlatformAdmin() as never, 'role-1')).rejects.toMatchObject({
      code: 'ROLE_HAS_PENDING_INVITATIONS', status: 409,
    });
    expect(mockRoleDelete).not.toHaveBeenCalled();
  });

  it('deletes role and publishes audit', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: null, is_managed: false }));
    mockInvitationCount.mockResolvedValueOnce(0);
    mockRoleDelete.mockResolvedValueOnce({});
    await RoleService.deleteRole(makePlatformAdmin() as never, 'role-1');
    expect(mockRoleDelete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resource: 'Role', resource_id: 'role-1' }),
    );
  });
});

// ── addGrant ──────────────────────────────────────────────────────────────────

describe('RoleService.addGrant', () => {
  it('throws FORBIDDEN for non-admin', async () => {
    await expect(RoleService.addGrant(makeOtherUser() as never, 'role-1', 'user:read:org')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(null);
    await expect(RoleService.addGrant(makePlatformAdmin() as never, 'ghost', 'user:read:org')).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('throws MANAGED_ROLE_IMMUTABLE for managed role', async () => {
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ is_managed: true }));
    await expect(RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:read:org')).rejects.toMatchObject({
      code: 'MANAGED_ROLE_IMMUTABLE', status: 403,
    });
  });

  it('creates new grant via transaction and returns updated role', async () => {
    const role = makeRole({ org_id: null, is_managed: false, role_grants: [] });
    const updatedRole = makeRole({ role_grants: [makeGrant()] });
    mockRoleFindUnique.mockResolvedValueOnce(role);
    // compressPatterns default: returns patterns unchanged → toAdd=['user:read:org'], toDelete=[]
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(updatedRole);

    const result = await RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:read:org');

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxRoleGrantCreateMany).toHaveBeenCalledWith({
      data: [{ role_id: 'role-1', pattern: 'user:read:org' }],
    });
    expect(mockTxRoleGrantDeleteMany).not.toHaveBeenCalled();
    expect((result as Record<string, unknown>)['grants']).toHaveLength(1);
  });

  it('is idempotent when new pattern is already subsumed by existing set', async () => {
    // existing has 'user:read:org'; compress(['user:read:org', 'user:read:org']) → ['user:read:org']
    // toAdd=[], toDelete=[] → no-op
    const role = makeRole({ role_grants: [makeGrant({ pattern: 'user:read:org' })] });
    mockRoleFindUnique.mockResolvedValueOnce(role);

    const result = await RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:read:org');

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'role-1' });
  });

  it('consolidates to wildcard when adding the last action that completes full coverage', async () => {
    const existingGrants = [
      makeGrant({ id: 'g-1', pattern: 'user:read:org' }),
      makeGrant({ id: 'g-2', pattern: 'user:update:org' }),
    ];
    const role = makeRole({ org_id: null, is_managed: false, role_grants: existingGrants });
    mockRoleFindUnique.mockResolvedValueOnce(role);
    // simulate compression: all 3 user:*:org actions now present → produce wildcard
    mockCompressPatterns.mockReturnValueOnce(['user:*:org']);
    const updatedRole = makeRole({ role_grants: [makeGrant({ pattern: 'user:*:org' })] });
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(updatedRole);

    const result = await RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:delete:org');

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxRoleGrantDeleteMany).toHaveBeenCalledWith({
      where: { role_id: 'role-1', pattern: { in: expect.arrayContaining(['user:read:org', 'user:update:org']) } },
    });
    expect(mockTxRoleGrantCreateMany).toHaveBeenCalledWith({
      data: [{ role_id: 'role-1', pattern: 'user:*:org' }],
    });
    expect((result as Record<string, unknown>)['grants']).toHaveLength(1);
  });

  it('is no-op when new pattern is subsumed by an existing wildcard', async () => {
    // existing has user:*:org; adding user:read:org → compress returns ['user:*:org'] (unchanged)
    // toAdd=[], toDelete=[] → no-op
    const role = makeRole({ role_grants: [makeGrant({ pattern: 'user:*:org' })] });
    mockRoleFindUnique.mockResolvedValueOnce(role);
    mockCompressPatterns.mockReturnValueOnce(['user:*:org']);

    const result = await RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:read:org');

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'role-1' });
  });

  it('publishes correct delta with grants_consolidated when compression occurs', async () => {
    const existingGrants = [makeGrant({ id: 'g-1', pattern: 'user:read:org' })];
    const role = makeRole({ org_id: null, is_managed: false, role_grants: existingGrants });
    mockRoleFindUnique.mockResolvedValueOnce(role);
    mockCompressPatterns.mockReturnValueOnce(['user:*:org']);
    mockTxRoleFindUniqueOrThrow.mockResolvedValueOnce(makeRole({ role_grants: [makeGrant({ pattern: 'user:*:org' })] }));

    await RoleService.addGrant(makePlatformAdmin() as never, 'role-1', 'user:update:org');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: expect.objectContaining({ grants_added: ['user:*:org'], grants_consolidated: ['user:read:org'] }),
      }),
    );
  });
});

// ── removeGrant ───────────────────────────────────────────────────────────────

describe('RoleService.removeGrant', () => {
  it('throws GRANT_NOT_FOUND when grant does not exist', async () => {
    mockRoleGrantFindUnique.mockResolvedValueOnce(null);
    await expect(RoleService.removeGrant(makePlatformAdmin() as never, 'role-1', 'grant-1')).rejects.toMatchObject({
      code: 'GRANT_NOT_FOUND', status: 404,
    });
  });

  it('throws GRANT_NOT_FOUND when grant belongs to different role', async () => {
    mockRoleGrantFindUnique.mockResolvedValueOnce(makeGrant({ role_id: 'other-role' }));
    await expect(RoleService.removeGrant(makePlatformAdmin() as never, 'role-1', 'grant-1')).rejects.toMatchObject({
      code: 'GRANT_NOT_FOUND', status: 404,
    });
  });

  it('throws MANAGED_GRANT_IMMUTABLE for managed grant', async () => {
    mockRoleGrantFindUnique.mockResolvedValueOnce(makeGrant({ is_managed: true }));
    mockRoleFindUnique.mockResolvedValueOnce(makeRole());
    await expect(RoleService.removeGrant(makePlatformAdmin() as never, 'role-1', 'grant-1')).rejects.toMatchObject({
      code: 'MANAGED_GRANT_IMMUTABLE', status: 403,
    });
  });

  it('throws FORBIDDEN when org admin targets another org role', async () => {
    mockRoleGrantFindUnique.mockResolvedValueOnce(makeGrant({ is_managed: false }));
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: 'other-org' }));
    await expect(RoleService.removeGrant(makeOrgAdmin() as never, 'role-1', 'grant-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('deletes grant and publishes audit', async () => {
    mockRoleGrantFindUnique.mockResolvedValueOnce(makeGrant({ is_managed: false }));
    mockRoleFindUnique.mockResolvedValueOnce(makeRole({ org_id: null }));
    mockRoleGrantDelete.mockResolvedValueOnce({});

    await RoleService.removeGrant(makePlatformAdmin() as never, 'role-1', 'grant-1');

    // Flush setImmediate queue before asserting
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockRoleGrantDelete).toHaveBeenCalledWith({ where: { id: 'grant-1' } });
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', resource: 'Role', resource_id: 'role-1' }),
    );
  });
});
