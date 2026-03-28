/**
 * Tests for src/services/user.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockUserFindUniqueOrThrow = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn().mockResolvedValue([]);
const mockUserCount = vi.fn().mockResolvedValue(0);
const mockUserUpdate = vi.fn();
const mockRoleFindFirst = vi.fn();
const mockInvitationFindUnique = vi.fn();
const mockInvitationCreate = vi.fn().mockResolvedValue({});

// Transaction tx mocks
const mockTxUserUpdate = vi.fn();
const mockTxUserCreate = vi.fn();
const mockTxUserFindUniqueOrThrow = vi.fn();
const mockTxRoleFindMany = vi.fn().mockResolvedValue([]);
const mockTxUserRoleDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserRoleCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserRoleCreate = vi.fn().mockResolvedValue({});
const mockTxInvitationUpdate = vi.fn().mockResolvedValue({});
const mockRefreshTokenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

const mockTransaction = vi.fn().mockImplementation(async (arg: unknown) => {
  if (typeof arg === 'function') {
    const tx = {
      user: { update: mockTxUserUpdate, create: mockTxUserCreate, findUniqueOrThrow: mockTxUserFindUniqueOrThrow },
      role: { findMany: mockTxRoleFindMany },
      userRole: { deleteMany: mockTxUserRoleDeleteMany, createMany: mockTxUserRoleCreateMany, create: mockTxUserRoleCreate },
      invitation: { update: mockTxInvitationUpdate },
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
      findMany: mockUserFindMany,
      count: mockUserCount,
      update: mockUserUpdate,
    },
    role: { findFirst: mockRoleFindFirst },
    invitation: { findUnique: mockInvitationFindUnique, create: mockInvitationCreate },
    refreshToken: { updateMany: mockRefreshTokenUpdateMany },
    $transaction: mockTransaction,
  },
  Prisma: {},
}));

const mockRedisSet = vi.fn().mockResolvedValue('OK');
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: mockRedisSet }),
}));

const mockSerializeUserMe = vi.fn().mockReturnValue({ id: 'user-1', serialized: 'me' });
const mockSerializeUserForList = vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id }));
const mockSerializeUserFullProfile = vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id }));

vi.mock('../../src/models/serializers.js', () => ({
  serializeUserMe: mockSerializeUserMe,
  serializeUserForList: mockSerializeUserForList,
  serializeUserFullProfile: mockSerializeUserFullProfile,
}));

const mockAbilityCan = vi.fn().mockReturnValue(false);

vi.mock('../../src/utils/ability.js', () => ({
  buildAbilityFromRules: vi.fn().mockReturnValue({ can: mockAbilityCan }),
  buildRulesForUser: vi.fn().mockReturnValue([]),
  collectPermissions: vi.fn().mockReturnValue([]),
}));

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

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: mockPublishAudit,
  publishSms: mockPublishSms,
  publishMail: mockPublishMail,
  notifyUser: mockNotifyUser,
}));

vi.mock('../../src/config/index.js', () => ({
  config: { appUrl: 'https://app.katisha.rw' },
}));

const mockDeleteFromS3 = vi.fn();
vi.mock('../../src/utils/s3.js', () => ({
  deleteFromS3: mockDeleteFromS3,
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
  user_permissions: [] as unknown[],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAbilityCan.mockReturnValue(false);
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
  it('throws PASSENGERS_CANNOT_HAVE_EMAIL when passenger sets email', async () => {
    const authUser = makeAuthUser({ user_type: 'passenger' });
    await expect(UserService.updateMe(authUser as never, { email: 'a@b.com' })).rejects.toMatchObject({
      code: 'PASSENGERS_CANNOT_HAVE_EMAIL', status: 422,
    });
  });

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
    mockUserFindUnique.mockResolvedValueOnce({ avatar_path: 'avatars/user-1/old.jpg' });
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { avatar_path: null });
    expect(mockDeleteFromS3).toHaveBeenCalledWith('avatars/user-1/old.jpg');
  });

  it('does not call deleteFromS3 when existing avatar is null', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ avatar_path: null });
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { avatar_path: 'avatars/new.jpg' });
    expect(mockDeleteFromS3).not.toHaveBeenCalled();
  });

  it('skips avatar fetch when avatar_path not in update data', async () => {
    mockUserUpdate.mockResolvedValueOnce(makeUser());
    const authUser = makeAuthUser({ user_type: 'staff' });
    await UserService.updateMe(authUser as never, { first_name: 'Bob' });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});

// ── listUsers ─────────────────────────────────────────────────────────────────

describe('UserService.listUsers', () => {
  it('adds org_id filter for org-scoped non-admin', async () => {
    const authUser = makeAuthUser({ org_id: 'org-1' });
    await UserService.listUsers(authUser as never, {});
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org-1' }) }),
    );
  });

  it('restricts self-scoped user (no org_id) to own id', async () => {
    const authUser = makeAuthUser({ id: 'user-1', org_id: null });
    await UserService.listUsers(authUser as never, {});
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'user-1' }) }),
    );
  });

  it('admin can filter by org_id query param', async () => {
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.listUsers(authUser as never, { org_id: 'org-42' });
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org-42' }) }),
    );
  });

  it('applies status and user_type filters', async () => {
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.listUsers(authUser as never, { status: 'active', user_type: 'staff' });
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active', user_type: 'staff' }),
      }),
    );
  });

  it('returns data, total, page, limit', async () => {
    mockUserFindMany.mockResolvedValueOnce([makeUser()]);
    mockUserCount.mockResolvedValueOnce(1);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    const result = await UserService.listUsers(authUser as never, { page: 2, limit: 5 });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 5 });
    expect(result.data).toHaveLength(1);
  });
});

// ── getUserById ───────────────────────────────────────────────────────────────

describe('UserService.getUserById', () => {
  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.getUserById(authUser as never, 'ghost-id')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('admin can view any user', async () => {
    const user = makeUser({ id: 'other-user', org_id: 'other-org' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.getUserById(authUser as never, 'other-user');
    expect(mockSerializeUserFullProfile).toHaveBeenCalledWith(user, true);
  });

  it('org-scoped user can view users in same org', async () => {
    const user = makeUser({ org_id: 'org-1' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org_admin'] });
    await UserService.getUserById(authUser as never, 'user-1');
    expect(mockSerializeUserFullProfile).toHaveBeenCalled();
  });

  it('org-scoped user cannot view user in different org', async () => {
    const user = makeUser({ org_id: 'other-org' });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org_admin'] });
    await expect(UserService.getUserById(authUser as never, 'user-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('self-scoped user can view own profile', async () => {
    const user = makeUser({ id: 'user-1', org_id: null });
    mockUserFindUnique.mockResolvedValueOnce(user);
    const authUser = makeAuthUser({ id: 'user-1', org_id: null });
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
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.updateUser(authUser as never, 'ghost-id', {})).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('org-scoped user cannot update user in different org', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ org_id: 'other-org' }));
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org_admin'] });
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
    mockTxUserUpdate.mockResolvedValueOnce(updated);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.updateUser(authUser as never, 'user-2', { first_name: 'New' });
    expect(mockTxUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ first_name: 'New' }) }),
    );
  });

  it('replaces roles when admin has manage:User and role_slugs provided', async () => {
    const target = makeUser({ id: 'user-2', org_id: null, user_roles: [] });
    const updated = makeUser({ id: 'user-2', org_id: null, user_roles: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockTxUserUpdate.mockResolvedValueOnce(updated);
    mockTxRoleFindMany.mockResolvedValueOnce([{ id: 'role-1' }]);
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(updated);
    mockAbilityCan.mockReturnValue(true);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.updateUser(authUser as never, 'user-2', { role_slugs: ['org_admin'] });
    expect(mockTxUserRoleDeleteMany).toHaveBeenCalledWith({ where: { user_id: 'user-2' } });
    expect(mockTxUserRoleCreateMany).toHaveBeenCalled();
  });

  it('notifies user when status changed to suspended', async () => {
    const target = makeUser({ id: 'user-2', org_id: null, user_roles: [] });
    const updated = makeUser({ id: 'user-2', status: 'suspended', org_id: null, user_roles: [] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockTxUserUpdate.mockResolvedValueOnce(updated);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.updateUser(authUser as never, 'user-2', { status: 'suspended' });
    expect(mockNotifyUser).toHaveBeenCalledWith(
      updated,
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.account_suspended' }) }),
    );
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────────

describe('UserService.deleteUser', () => {
  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.deleteUser(authUser as never, 'ghost-id')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('throws USER_NOT_FOUND when user is already soft-deleted', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ deleted_at: new Date() }));
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.deleteUser(authUser as never, 'user-1')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('throws FORBIDDEN for org_admin deleting user outside their org', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ org_id: 'other-org' }));
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org_admin'] });
    await expect(UserService.deleteUser(authUser as never, 'user-2')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('soft-deletes and revokes tokens in a transaction', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
    );
    expect(mockRefreshTokenUpdateMany).toHaveBeenCalled();
  });

  it('sets Redis blacklist entry', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockRedisSet).toHaveBeenCalledWith('blacklist:user:user-2', '1', 'EX', 900);
  });

  it('fails open when Redis throws', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    mockRedisSet.mockRejectedValueOnce(new Error('redis down'));
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.deleteUser(authUser as never, 'user-2')).resolves.toBeUndefined();
  });

  it('publishes an audit event', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ id: 'user-2' }));
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.deleteUser(authUser as never, 'user-2');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resource: 'User', resource_id: 'user-2' }),
    );
  });
});

// ── inviteUser ────────────────────────────────────────────────────────────────

describe('UserService.inviteUser', () => {
  const base = { first_name: 'Bob', last_name: 'Smith', role_slug: 'dispatcher' };

  it('throws VALIDATION_ERROR when neither email nor phone provided', async () => {
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.inviteUser(authUser as never, base)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', status: 422,
    });
  });

  it('throws ROLE_NOT_FOUND when role does not exist', async () => {
    mockRoleFindFirst.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await expect(UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' })).rejects.toMatchObject({
      code: 'ROLE_NOT_FOUND', status: 404,
    });
  });

  it('org_admin uses their own org_id', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1' });
    const authUser = makeAuthUser({ role_slugs: ['org_admin'], org_id: 'org-1' });
    await UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' });
    expect(mockRoleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org-1' }) }),
    );
  });

  it('sends SMS when phone_number provided', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1' });
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.inviteUser(authUser as never, { ...base, phone_number: '+250788000001' });
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.sms' }));
  });

  it('sends email when email provided', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1' });
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
    await UserService.inviteUser(authUser as never, { ...base, email: 'bob@acme.com' });
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.mail' }));
  });

  it('returns invite_token and expires_at', async () => {
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-1' });
    const authUser = makeAuthUser({ role_slugs: ['katisha_admin'] });
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
    role_id: 'role-1',
    org_id: 'org-1',
    accepted_at: null,
    expires_at: futureExpiry,
    ...overrides,
  });

  it('throws INVALID_TOKEN when invitation not found', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.acceptInvite('bad-token', 'pass')).rejects.toMatchObject({
      code: 'INVALID_TOKEN', status: 400,
    });
  });

  it('throws INVALID_TOKEN when invitation already accepted', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(makeInvitation({ accepted_at: new Date() }));
    await expect(UserService.acceptInvite('tok', 'pass')).rejects.toMatchObject({
      code: 'INVALID_TOKEN', status: 400,
    });
  });

  it('throws TOKEN_EXPIRED when invitation is past expiry', async () => {
    mockInvitationFindUnique.mockResolvedValueOnce(makeInvitation({ expires_at: pastExpiry }));
    await expect(UserService.acceptInvite('tok', 'pass')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED', status: 410,
    });
  });

  it('creates user, assigns role, marks invite accepted in transaction', async () => {
    const invitation = makeInvitation();
    const createdUser = makeUser({ id: 'new-user', phone_number: '+250788000002', user_roles: [] });
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user' });
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(createdUser);
    const result = await UserService.acceptInvite('tok', 'pass');
    expect(mockTxUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_type: 'staff', status: 'active', password_hash: 'hashed-password' }),
      }),
    );
    expect(mockTxUserRoleCreate).toHaveBeenCalledWith({ data: { user_id: 'new-user', role_id: 'role-1' } });
    expect(mockTxInvitationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accepted_at: expect.any(Date) } }),
    );
    expect(result.user).toEqual(createdUser);
  });

  it('sends welcome SMS (always)', async () => {
    const invitation = makeInvitation();
    const createdUser = makeUser({ id: 'new-user', phone_number: '+250788000002', user_roles: [] });
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user' });
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(createdUser);
    await UserService.acceptInvite('tok', 'pass');
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'welcome.sms' }));
  });

  it('sends welcome email when user has email', async () => {
    const invitation = makeInvitation({ email: 'bob@acme.com' });
    const createdUser = makeUser({ id: 'new-user', email: 'bob@acme.com', phone_number: '+250788000002', user_roles: [] });
    mockInvitationFindUnique.mockResolvedValueOnce(invitation);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user' });
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(createdUser);
    await UserService.acceptInvite('tok', 'pass');
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'welcome.mail' }));
  });
});

// ── validatePassword ──────────────────────────────────────────────────────────

describe('UserService.validatePassword', () => {
  it('throws INVALID_CREDENTIALS when user not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(UserService.validatePassword('user-1', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when no password_hash', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser({ password_hash: null }));
    await expect(UserService.validatePassword('user-1', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when password does not match', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser());
    mockVerifyPassword.mockResolvedValueOnce(false);
    await expect(UserService.validatePassword('user-1', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('resolves when password is correct', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeUser());
    mockVerifyPassword.mockResolvedValueOnce(true);
    await expect(UserService.validatePassword('user-1', 'correct')).resolves.toBeUndefined();
  });
});

// ── toggle2fa ─────────────────────────────────────────────────────────────────

describe('UserService.toggle2fa', () => {
  it('enables 2FA and returns true', async () => {
    mockUserUpdate.mockResolvedValueOnce(makeUser({ two_factor_enabled: true }));
    const result = await UserService.toggle2fa('user-1', true);
    expect(result).toEqual({ two_factor_enabled: true });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { two_factor_enabled: true } }),
    );
    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.2fa_enabled' }) }),
    );
  });

  it('disables 2FA and returns false', async () => {
    mockUserUpdate.mockResolvedValueOnce(makeUser({ two_factor_enabled: false }));
    const result = await UserService.toggle2fa('user-1', false);
    expect(result).toEqual({ two_factor_enabled: false });
    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.2fa_disabled' }) }),
    );
  });
});
