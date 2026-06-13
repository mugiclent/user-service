/**
 * Tests for src/services/user.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AbilityModule from '../../src/utils/ability.js';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockUserFindUniqueOrThrow = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindFirst = vi.fn().mockResolvedValue(null); // no existing org admin by default
const mockUserFindMany = vi.fn().mockResolvedValue([]);
const mockUserCount = vi.fn().mockResolvedValue(0);
const mockUserUpdate = vi.fn();
const mockRoleFindFirst = vi.fn();
const mockRoleFindUnique = vi.fn().mockResolvedValue({ slug: 'dispatcher' }); // non-org-admin by default
const mockInvitationFindUnique = vi.fn();
const mockInvitationFindFirst = vi.fn().mockResolvedValue(null);
const mockInvitationCreate = vi.fn().mockResolvedValue({ id: 'inv-1' });
const mockUserGrantFindUnique = vi.fn();
const mockUserGrantDelete = vi.fn().mockResolvedValue({});

// Transaction tx mocks
const mockTxUserUpdate = vi.fn();
const mockTxUserCreate = vi.fn();
const mockTxUserFindUniqueOrThrow = vi.fn();
const mockTxRoleFindMany = vi.fn().mockResolvedValue([]);
const mockTxUserRoleDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserRoleCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserRoleCreate = vi.fn().mockResolvedValue({});
const mockTxInvitationUpdate = vi.fn().mockResolvedValue({});
const mockTxInvitationDelete = vi.fn().mockResolvedValue({});
const mockTxInvitationFindUniqueOrThrow = vi.fn().mockResolvedValue({ invitation_roles: [], invitation_grants: [] });
const mockTxInvitationGrantDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxInvitationGrantCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserGrantDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserGrantCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockRefreshTokenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

const mockTransaction = vi.fn().mockImplementation(async (arg: unknown) => {
  if (typeof arg === 'function') {
    const tx = {
      user: { update: mockTxUserUpdate, create: mockTxUserCreate, findUniqueOrThrow: mockTxUserFindUniqueOrThrow },
      role: { findMany: mockTxRoleFindMany },
      userRole: { deleteMany: mockTxUserRoleDeleteMany, createMany: mockTxUserRoleCreateMany, create: mockTxUserRoleCreate },
      invitation: { update: mockTxInvitationUpdate, delete: mockTxInvitationDelete, findUniqueOrThrow: mockTxInvitationFindUniqueOrThrow },
      invitationGrant: { deleteMany: mockTxInvitationGrantDeleteMany, createMany: mockTxInvitationGrantCreateMany },
      userGrant: { deleteMany: mockTxUserGrantDeleteMany, createMany: mockTxUserGrantCreateMany },
    };
    return (arg as (tx: unknown) => Promise<unknown>)(tx);
  }
  return [];
});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: mockUserFindUniqueOrThrow,
      findUnique: mockUserFindUnique,
      findFirst: mockUserFindFirst,
      findMany: mockUserFindMany,
      count: mockUserCount,
      update: mockUserUpdate,
    },
    role: { findFirst: mockRoleFindFirst, findUnique: mockRoleFindUnique },
    invitation: { findUnique: mockInvitationFindUnique, findFirst: mockInvitationFindFirst, create: mockInvitationCreate },
    org: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    userGrant: { findUnique: mockUserGrantFindUnique, delete: mockUserGrantDelete },
    refreshToken: { updateMany: mockRefreshTokenUpdateMany },
    $transaction: mockTransaction,
  },
  Prisma: {},
}));

const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisSetex = vi.fn().mockResolvedValue('OK');
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisDel = vi.fn().mockResolvedValue(1);
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: mockRedisSet, setex: mockRedisSetex, get: mockRedisGet, del: mockRedisDel }),
}));

const mockSerializeUserMe = vi.fn().mockReturnValue({ id: 'user-1', serialized: 'me' });
const mockSerializeUserForList = vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id }));
const mockSerializeUserFullProfile = vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id }));
const mockSerializeInvitationFull = vi.fn().mockImplementation((inv: { id: string }) => ({ id: inv.id }));

vi.mock('../../src/models/serializers.js', () => ({
  serializeUserMe: mockSerializeUserMe,
  serializeUserForList: mockSerializeUserForList,
  serializeUserFullProfile: mockSerializeUserFullProfile,
  serializeInvitationFull: mockSerializeInvitationFull,
}));

vi.mock('../../src/utils/ability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AbilityModule>();
  return {
    ...actual,
    buildRulesFromGrants: vi.fn().mockReturnValue([]),
  };
});

const mockGenerateRawToken = vi.fn().mockReturnValue('raw-invite-token');
const mockHashToken = vi.fn().mockReturnValue('hashed-token');
const mockHashPassword = vi.fn().mockResolvedValue('hashed-password');
const mockVerifyPassword = vi.fn();

vi.mock('../../src/utils/crypto.js', () => ({
  generateRawToken: mockGenerateRawToken,
  hashToken: mockHashToken,
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}));

const mockPublishAudit = vi.fn();
const mockPublishSms = vi.fn();
const mockPublishMail = vi.fn();
const mockNotifyUser = vi.fn();
const mockPublishUserEvent = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: mockPublishAudit,
  publishSms: mockPublishSms,
  publishMail: mockPublishMail,
  notifyUser: mockNotifyUser,
  publishUserEvent: mockPublishUserEvent,
  publishUserDomainEvent: vi.fn(),
  publishInvitationEvent: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: { appUrl: 'https://app.katisha.rw' },
}));

const mockIssueSudoToken = vi.fn().mockResolvedValue({
  token: 'sudo.token.mock',
  jti: 'mock-jti',
  expiresAt: '2025-05-18T12:03:00.000Z',
});
vi.mock('../../src/utils/sudoToken.js', () => ({
  issueSudoToken: mockIssueSudoToken,
}));

const mockClearSudoRateLimit = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  clearSudoRateLimit: mockClearSudoRateLimit,
}));

const mockDeleteFromS3 = vi.fn();
vi.mock('../../src/utils/s3.js', () => ({
  deleteFromS3: mockDeleteFromS3,
}));

const mockOtpCreate = vi.fn().mockResolvedValue({ code: '123456', expiresIn: 300 });
const mockOtpVerify = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: mockOtpCreate, verify: mockOtpVerify },
}));

const { UserService } = await import('../../src/services/user.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeAuthUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  org_id: null as string | null,
  user_type: 'passenger',
  role_slugs: [] as string[],
  rules: [] as unknown[],
  ...overrides,
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  phone_number: '+250788000001',
  email: null as string | null,
  password_hash: 'hash',
  status: 'active',
  user_type: 'passenger',
  org_id: null as string | null,
  two_factor_enabled: false,
  deleted_at: null,
  avatar_path: null as string | null,
  notif_channel: 'sms',
  user_roles: [] as unknown[],
  user_grants: [] as unknown[],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue(makeUser());
});

// ── getMe ────────────────────────────────────────────────────────────────────

describe('UserService.getMe', () => {
  it('fetches user and serializes with JWT rules', async () => {
    const user = makeUser();
    mockUserFindUniqueOrThrow.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ rules: [{ action: 'read', subject: 'User' }] });
    const result = await UserService.getMe(authUser as never);
    expect(mockUserFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(mockSerializeUserMe).toHaveBeenCalledWith(user, authUser.rules);
    expect(result).toEqual({ id: 'user-1', serialized: 'me' });
  });
});

// ── updateMe ─────────────────────────────────────────────────────────────────

describe('UserService.updateMe', () => {
  it('updates user and returns serialized result', async () => {
    const user = makeUser();
    mockUserUpdate.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { first_name: 'Alice' });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { first_name: 'Alice' } }),
    );
  });

  it('deletes old S3 avatar when avatar_path is included in update', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValueOnce({ login_channel: null, two_factor_enabled: false, avatar_path: 'avatars/user-1/old.jpg' });
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { avatar_path: null });
    expect(mockDeleteFromS3).toHaveBeenCalledWith('avatars/user-1/old.jpg');
  });

  it('does not call deleteFromS3 when existing avatar is null', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValueOnce({ login_channel: null, two_factor_enabled: false, avatar_path: null });
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { avatar_path: 'avatars/new.jpg' });
    expect(mockDeleteFromS3).not.toHaveBeenCalled();
  });

  it('skips current user fetch when no sensitive fields in update data', async () => {
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { locale: 'en' });
    expect(mockUserFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});

// ── listUsers ─────────────────────────────────────────────────────────────────

describe('UserService.listUsers', () => {
  // The boundary now comes from accessibleBy(ability,'read').User, ANDed with filters.
  const whereAndContaining = (...conds: unknown[]) =>
    expect.objectContaining({ where: { AND: expect.arrayContaining(conds.map((c) => expect.objectContaining(c as object))) } });

  it('scopes org-scoped non-admin to their org via accessibleBy', async () => {
    const authUser = makeAuthUser({
      org_id: 'org-1',
      rules: [{ action: 'read', subject: 'User', conditions: { org_id: 'org-1' } }],
    });
    await UserService.listUsers(authUser as never, {});
    expect(mockUserFindMany).toHaveBeenCalledWith(whereAndContaining({ OR: [{ org_id: 'org-1' }] }));
  });

  it('restricts self-scoped user to own id via accessibleBy', async () => {
    const authUser = makeAuthUser({ id: 'user-1', org_id: null, rules: [{ action: 'read', subject: 'User', conditions: { id: 'user-1' } }] });
    await UserService.listUsers(authUser as never, {});
    expect(mockUserFindMany).toHaveBeenCalledWith(whereAndContaining({ OR: [{ id: 'user-1' }] }));
  });

  it('admin can filter by org_id query param', async () => {
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.listUsers(authUser as never, { org_id: 'org-42' });
    expect(mockUserFindMany).toHaveBeenCalledWith(whereAndContaining({ org_id: 'org-42' }));
  });

  it('applies status and user_type filters', async () => {
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.listUsers(authUser as never, { status: 'active', user_type: 'staff' });
    expect(mockUserFindMany).toHaveBeenCalledWith(whereAndContaining({ status: 'active' }, { user_type: 'staff' }));
  });

  it('filters by multiple role slugs', async () => {
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.listUsers(authUser as never, { role: ['driver', 'cashier'] });
    expect(mockUserFindMany).toHaveBeenCalledWith(
      whereAndContaining({ user_roles: { some: { role: { slug: { in: ['driver', 'cashier'] } } } } }),
    );
  });

  it('returns data, total, page, limit', async () => {
    mockUserFindMany.mockResolvedValueOnce([makeUser()]);
    mockUserCount.mockResolvedValueOnce(1);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    const result = await UserService.listUsers(authUser as never, { page: 2, limit: 5 });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 5 });
    expect(result.data).toHaveLength(1);
  });
});

// ── getUserById ───────────────────────────────────────────────────────────────

describe('UserService.getUserById', () => {
  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.getUserById(authUser as never, 'ghost-id')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('admin can view any user', async () => {
    const user = makeUser({ id: 'other-user', org_id: 'other-org' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.getUserById(authUser as never, 'other-user');
    expect(mockSerializeUserFullProfile).toHaveBeenCalledWith(user);
  });

  it('org-scoped user can view users in same org', async () => {
    const user = makeUser({ org_id: 'org-1' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org-admin'], rules: [{ action: 'manage', subject: 'User', conditions: { org_id: 'org-1' } }] });
    await UserService.getUserById(authUser as never, 'user-1');
    expect(mockSerializeUserFullProfile).toHaveBeenCalled();
  });

  it('org-scoped user cannot view user in different org', async () => {
    const user = makeUser({ org_id: 'other-org' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org-admin'] });
    await expect(UserService.getUserById(authUser as never, 'user-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('self-scoped user can view own profile', async () => {
    const user = makeUser({ id: 'user-1', org_id: null });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ id: 'user-1', org_id: null, rules: [{ action: 'read', subject: 'User', conditions: { id: 'user-1' } }] });
    await UserService.getUserById(authUser as never, 'user-1');
    expect(mockSerializeUserFullProfile).toHaveBeenCalled();
  });

  it('self-scoped user cannot view another user', async () => {
    const user = makeUser({ id: 'other-user', org_id: null });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ id: 'user-1', org_id: null });
    await expect(UserService.getUserById(authUser as never, 'other-user')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });
});

// ── updateUser ────────────────────────────────────────────────────────────────

describe('UserService.updateUser', () => {
  it('throws USER_NOT_FOUND when target does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.updateUser(authUser as never, 'ghost-id', {})).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('org-scoped user cannot update user in different org', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ org_id: 'other-org' }));
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org-admin'] });
    await expect(UserService.updateUser(authUser as never, 'user-2', {})).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('self-scoped user cannot update another user', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2', org_id: null }));
    const authUser = makeAuthUser({ id: 'user-1', org_id: null });
    await expect(UserService.updateUser(authUser as never, 'user-2', {})).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('updates user data and returns serialized result', async () => {
    const target = makeUser({ id: 'user-2', org_id: 'org-1' });
    const updated = makeUser({ id: 'user-2', first_name: 'New', org_id: 'org-1', user_roles: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.updateUser(authUser as never, 'user-2', { first_name: 'New' });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ first_name: 'New' }) }),
    );
  });

  it('notifies user when status changed to suspended', async () => {
    const target = makeUser({ id: 'user-2', org_id: null, user_roles: [], user_grants: [] });
    const updated = makeUser({ id: 'user-2', status: 'suspended', org_id: null, user_roles: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.updateUser(authUser as never, 'user-2', { status: 'suspended' });
    expect(mockNotifyUser).toHaveBeenCalledWith(
      updated,
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.account_suspended' }) }),
    );
  });
});

// ── assignRoles (dedicated role-assignment endpoint) ────────────────────────────

describe('UserService.assignRoles', () => {
  it('replaces roles when caller holds assign_role and the role grants are a subset', async () => {
    const target = makeUser({ id: 'user-2', org_id: null, user_roles: [], user_grants: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1', slug: 'org-admin', role_grants: [{ pattern: 'user:read:org' }] });
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(makeUser({ id: 'user-2', user_roles: [{ role: { slug: 'org-admin' } }] }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });

    await UserService.assignRoles(authUser as never, 'user-2', ['org-admin']);

    expect(mockTxUserRoleDeleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-2' } });
    expect(mockTxUserRoleCreateMany).toHaveBeenCalledWith({ data: [{ user_id: 'user-2', role_id: 'role-1' }] });
  });

  it('throws FORBIDDEN when caller lacks assign_role', async () => {
    const authUser = makeAuthUser({ role_slugs: [], rules: [] });
    await expect(UserService.assignRoles(authUser as never, 'user-2', ['org-admin'])).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws GRANT_SCOPE_ESCALATION when assigning a role with grants the caller lacks', async () => {
    const target = makeUser({ id: 'user-2', org_id: 'org-1', user_roles: [], user_grants: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-pa', slug: 'platform-admin', role_grants: [{ pattern: '*:*:platform' }] });
    // Org admin: manage within own org only — cannot grant platform-admin.
    const orgAdmin = makeAuthUser({ org_id: 'org-1', role_slugs: ['org-admin'], rules: [{ action: 'manage', subject: 'all', conditions: { org_id: 'org-1' } }] });
    await expect(UserService.assignRoles(orgAdmin as never, 'user-2', ['platform-admin'])).rejects.toMatchObject({
      code: 'GRANT_SCOPE_ESCALATION', status: 403,
    });
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────────

describe('UserService.deleteUser', () => {
  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.deleteUser(authUser as never, 'ghost-id')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('throws USER_NOT_FOUND when user is already soft-deleted', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ deleted_at: new Date() }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.deleteUser(authUser as never, 'user-1')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('throws FORBIDDEN for org_admin deleting user outside their org', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ org_id: 'other-org' }));
    const authUser = makeAuthUser({
      org_id: 'org-1',
      role_slugs: ['org-admin'],
      rules: [{ action: 'manage', subject: 'User', conditions: { org_id: 'org-1' } }],
    });
    await expect(UserService.deleteUser(authUser as never, 'user-2')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('soft-deletes, anonymizes PII, and revokes tokens in a transaction', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_deletion',
          deleted_at: expect.any(Date),
          email: null,
          phone_number: null,
          avatar_path: null,
          driver_license_number: null,
          first_name: 'Deleted',
          last_name: 'User',
        }),
      }),
    );
    expect(mockRefreshTokenUpdateMany).toHaveBeenCalled();
  });

  it('deletes the avatar binary from the public bucket on delete', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2', avatar_path: 'avatars/user-2/x.jpg' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockDeleteFromS3).toHaveBeenCalledWith('avatars/user-2/x.jpg', 'public');
  });

  it('sets Redis blacklist entry', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockRedisSet).toHaveBeenCalledWith('blacklist:user:user-2', '1', 'EX', 900);
  });

  it('fails open when Redis throws', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    mockRedisSet.mockRejectedValueOnce(new Error('redis down'));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await expect(UserService.deleteUser(authUser as never, 'user-2')).resolves.toBeUndefined();
  });

  it('publishes an audit event', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], rules: [{ action: 'manage', subject: 'all' }] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resource: 'User', resource_id: 'user-2' }),
    );
  });
});

// ── inviteUser ────────────────────────────────────────────────────────────────

describe('UserService.inviteUser', () => {
  const base = { first_name: 'Bob', last_name: 'Smith', role_slugs: ['dispatcher'] };

  it('throws VALIDATION_ERROR when neither email nor phone provided', async () => {
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.inviteUser(authUser as never, base)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', status: 422,
    });
  });

  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' })).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('org_admin uses their own org_id', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1', role_grants: [] });
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1' });
    await UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' });
    expect(mockRoleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: 'dispatcher',
          OR: [{ org_id: 'org-1' }, { org_id: null }],
        }),
        orderBy: { org_id: 'asc' },
      }),
    );
  });

  it('sends SMS when phone_number provided', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1', role_grants: [] });
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await UserService.inviteUser(authUser as never, { ...base, phone_number: '+250788000001' });
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.sms' }));
  });

  it('sends email when email provided', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1', role_grants: [] });
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' });
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.mail' }));
  });

  it('returns invite_token and expires_at', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1', role_grants: [] });
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    const result = await UserService.inviteUser(authUser as never, { ...base, email: 'b@c.com' });
    expect(result.invite_token).toBe('raw-invite-token');
    expect(result.expires_at).toBeInstanceOf(Date);
  });
});

// ── acceptInvite ──────────────────────────────────────────────────────────────

describe('UserService.acceptInvite', () => {
  const futureExpiry = new Date(Date.now() + 60_000);
  const pastExpiry = new Date(Date.now() - 60_000);

  const makeInvitation = (overrides: Record<string, unknown> = {}) => ({
    id: 'invite-1',
    token_hash: 'hashed-token',
    first_name: 'Bob',
    last_name: 'Smith',
    email: null,
    phone_number: '+250788000002',
    invitation_roles: [{ role_id: 'role-1', role: { slug: 'org_staff' } }],
    invitation_grants: [],
    org_id: 'org-1',
    expires_at: futureExpiry,
    ...overrides,
  });

  it('throws INVALID_TOKEN when invitation not found', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.acceptInvite('bad-token', 'pass')).rejects.toMatchObject({
      code: 'INVALID_TOKEN', status: 400,
    });
  });

  // Accepted invitations are deleted on accept, so "already accepted" is just
  // "not found" (INVALID_TOKEN) — covered by the test above. No separate state.

  it('throws TOKEN_EXPIRED when invitation is past expiry', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(makeInvitation({ expires_at: pastExpiry }));
    await expect(UserService.acceptInvite('tok', 'pass')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED', status: 410,
    });
  });

  it('creates user, assigns role, and deletes the invitation in transaction', async () => {
    const invitation = makeInvitation();
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000002', email: null, first_name: 'Bob', locale: 'rw' });
    const result = await UserService.acceptInvite('tok', 'pass');
    expect(mockTxUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_type: 'staff', status: 'pending_verification', password_hash: 'hashed-password' }),
      }),
    );
    expect(mockTxUserRoleCreateMany).toHaveBeenCalledWith({ data: [{ user_id: 'new-user', role_id: 'role-1' }], skipDuplicates: true });
    // Invitation is consumed (deleted), not stamped accepted.
    expect(mockTxInvitationDelete).toHaveBeenCalledWith({ where: { token_hash: 'hashed-token' } });
    expect(mockTxInvitationUpdate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ user_id: 'new-user', channels: ['phone'] });
  });

  it('materialises invitation direct grants onto the new user', async () => {
    const invitation = makeInvitation({ invitation_grants: [{ pattern: 'user:read:org' }, { pattern: 'Trip:update:org' }] });
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000002', email: null, first_name: 'Bob', locale: 'rw' });
    await UserService.acceptInvite('tok', 'pass');
    expect(mockTxUserGrantCreateMany).toHaveBeenCalledWith({
      data: [
        { user_id: 'new-user', pattern: 'user:read:org' },
        { user_id: 'new-user', pattern: 'Trip:update:org' },
      ],
      skipDuplicates: true,
    });
  });

  it('sends phone OTP via SMS (always)', async () => {
    const invitation = makeInvitation();
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000002', email: null, first_name: 'Bob', locale: 'rw' });
    await UserService.acceptInvite('tok', 'pass');
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'otp.sms', purpose: 'phone_verification' }));
  });

  it('sends email OTP when invitation has email', async () => {
    const invitation = makeInvitation({ email: 'bob@acme.com' });
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000002', email: 'bob@acme.com', first_name: 'Bob', locale: 'rw' });
    await UserService.acceptInvite('tok', 'pass');
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'otp.mail', purpose: 'email_verification' }));
  });
});

// ── validatePassword ──────────────────────────────────────────────────────────

describe('UserService.validatePassword', () => {
  it('throws INVALID_CREDENTIALS when user not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.validatePassword('user-1', 'pass', 'change_password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when no password_hash', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ password_hash: null }));
    await expect(UserService.validatePassword('user-1', 'pass', 'change_password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when password does not match', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser());
    mockVerifyPassword.mockResolvedValueOnce(false);
    await expect(UserService.validatePassword('user-1', 'wrong', 'change_password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('returns sudo token when password is correct', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser());
    mockVerifyPassword.mockResolvedValueOnce(true);
    const result = await UserService.validatePassword('user-1', 'correct', 'change_password');
    expect(result).toMatchObject({ sudoToken: 'sudo.token.mock', expiresIn: 180 });
    expect(mockIssueSudoToken).toHaveBeenCalledWith('user-1', 'change_password');
    expect(mockClearSudoRateLimit).toHaveBeenCalledWith('user-1');
  });
});

// ── addUserGrants ─────────────────────────────────────────────────────────────

// Rules that grant assign_role on User with platform scope
const grantAdminRules = [{ action: 'manage', subject: 'all' }];

describe('UserService.addUserGrants', () => {
  const adminUser = () => makeAuthUser({ role_slugs: ['platform-admin'], rules: grantAdminRules });

  it('throws FORBIDDEN when user lacks assign_role permission', async () => {
    const auth = makeAuthUser({ role_slugs: [] });
    await expect(UserService.addUserGrants(auth as never, 'user-2', ['User:read:org']))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws USER_NOT_FOUND when target does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.addUserGrants(adminUser() as never, 'user-2', ['User:read:org']))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND', status: 404 });
  });

  it('returns current profile unchanged when no new patterns to add', async () => {
    const targetWithGrant = makeUser({ id: 'user-2', user_grants: [{ pattern: 'user:read:platform' }] });
    mockUserFindUnique.mockResolvedValueOnce(targetWithGrant);
    const result = await UserService.addUserGrants(adminUser() as never, 'user-2', ['user:read:platform']);
    expect(mockTxUserGrantCreateMany).not.toHaveBeenCalled();
    expect(mockSerializeUserFullProfile).toHaveBeenCalledWith(targetWithGrant);
    expect(result).toBeDefined();
  });

  it('runs transaction and returns updated profile when grants change', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    mockUserFindUniqueOrThrow.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const result = await UserService.addUserGrants(adminUser() as never, 'user-2', ['user:read:org']);
    expect(mockTransaction).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});

// ── getInvitationById ─────────────────────────────────────────────────────────

describe('UserService.getInvitationById', () => {
  const admin = () => makeAuthUser({ role_slugs: ['platform-admin'], rules: grantAdminRules });

  it('throws INVITE_NOT_FOUND when the invitation is gone (accepted/revoked/invalid)', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.getInvitationById(admin() as never, 'inv-1'))
      .rejects.toMatchObject({ code: 'INVITE_NOT_FOUND', status: 404 });
  });

  it('serializes the invitation when found', async () => {
    const invitation = { id: 'inv-1', org_id: 'org-1', invitation_roles: [], invitation_grants: [] };
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    const result = await UserService.getInvitationById(admin() as never, 'inv-1');
    expect(mockSerializeInvitationFull).toHaveBeenCalledWith(invitation);
    expect(result).toMatchObject({ id: 'inv-1' });
  });
});

// ── setInvitationGrants ───────────────────────────────────────────────────────

describe('UserService.setInvitationGrants', () => {
  const admin = () => makeAuthUser({ role_slugs: ['platform-admin'], rules: grantAdminRules });

  it('throws FORBIDDEN without assign_role permission', async () => {
    const auth = makeAuthUser({ role_slugs: [] });
    await expect(UserService.setInvitationGrants(auth as never, 'inv-1', ['user:read:org']))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws INVITE_NOT_FOUND when the invitation is gone', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.setInvitationGrants(admin() as never, 'inv-1', ['user:read:org']))
      .rejects.toMatchObject({ code: 'INVITE_NOT_FOUND', status: 404 });
  });

  it('replaces grants: clears existing then inserts the new set', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce({ id: 'inv-1', org_id: 'org-1' });
    await UserService.setInvitationGrants(admin() as never, 'inv-1', ['user:read:org']);
    expect(mockTxInvitationGrantDeleteMany).toHaveBeenCalledWith({ where: { invitation_id: 'inv-1' } });
    expect(mockTxInvitationGrantCreateMany).toHaveBeenCalledWith({
      data: [{ invitation_id: 'inv-1', pattern: 'user:read:org' }],
    });
  });

  it('allows clearing all grants with an empty set', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce({ id: 'inv-1', org_id: 'org-1' });
    await UserService.setInvitationGrants(admin() as never, 'inv-1', []);
    expect(mockTxInvitationGrantDeleteMany).toHaveBeenCalledWith({ where: { invitation_id: 'inv-1' } });
    expect(mockTxInvitationGrantCreateMany).not.toHaveBeenCalled();
  });
});

// ── removeUserGrant ───────────────────────────────────────────────────────────

describe('UserService.removeUserGrant', () => {
  const adminUser = () => makeAuthUser({ role_slugs: ['platform-admin'], rules: grantAdminRules });

  it('throws FORBIDDEN when user lacks assign_role permission', async () => {
    const auth = makeAuthUser({ role_slugs: [] });
    await expect(UserService.removeUserGrant(auth as never, 'user-2', 'grant-1'))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('throws GRANT_NOT_FOUND when grant does not exist', async () => {
    mockUserGrantFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.removeUserGrant(adminUser() as never, 'user-2', 'grant-1'))
      .rejects.toMatchObject({ code: 'GRANT_NOT_FOUND', status: 404 });
  });

  it('throws MANAGED_GRANT_IMMUTABLE when grant is managed', async () => {
    mockUserGrantFindUnique.mockResolvedValueOnce({ id: 'grant-1', user_id: 'user-2', is_managed: true, pattern: 'User:read:org' });
    await expect(UserService.removeUserGrant(adminUser() as never, 'user-2', 'grant-1'))
      .rejects.toMatchObject({ code: 'MANAGED_GRANT_IMMUTABLE', status: 403 });
  });

  it('throws USER_NOT_FOUND when target user does not exist', async () => {
    mockUserGrantFindUnique.mockResolvedValueOnce({ id: 'grant-1', user_id: 'user-2', is_managed: false, pattern: 'User:read:org' });
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.removeUserGrant(adminUser() as never, 'user-2', 'grant-1'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND', status: 404 });
  });

  it('deletes grant and publishes audit on success', async () => {
    mockUserGrantFindUnique.mockResolvedValueOnce({ id: 'grant-1', user_id: 'user-2', is_managed: false, pattern: 'User:read:org' });
    mockUserFindUnique.mockResolvedValueOnce({ org_id: null, deleted_at: null });
    mockUserFindUniqueOrThrow.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    await UserService.removeUserGrant(adminUser() as never, 'user-2', 'grant-1');
    expect(mockUserGrantDelete).toHaveBeenCalledWith({ where: { id: 'grant-1' } });
  });
});

// ── toggle2fa ─────────────────────────────────────────────────────────────────

