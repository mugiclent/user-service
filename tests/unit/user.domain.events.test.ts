/**
 * Tests that UserService publishes staff domain events for
 * acceptInvite, updateMe, updateUser, and deleteUser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AbilityModule from '../../src/utils/ability.js';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishUserEvent = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: vi.fn(),
  publishSms: vi.fn(),
  publishMail: vi.fn(),
  notifyUser: vi.fn(),
  publishUserEvent,
  publishUserDomainEvent: vi.fn(),
  publishInvitationEvent: vi.fn(),
}));

vi.mock('../../src/utils/ability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AbilityModule>();
  return { ...actual, buildRulesFromGrants: vi.fn().mockReturnValue([]) };
});

vi.mock('../../src/models/serializers.js', () => ({
  serializeUserMe: vi.fn().mockReturnValue({ id: 'user-1' }),
  serializeUserForList: vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id })),
  serializeUserFullProfile: vi.fn().mockImplementation((u: { id: string }) => ({ id: u.id })),
  maskPhone: vi.fn((p: string) => p),
}));

vi.mock('../../src/utils/crypto.js', () => ({
  generateRawToken: vi.fn().mockReturnValue('raw-tok'),
  hashToken: vi.fn().mockImplementation((t: string) => `h:${t}`),
  hashPassword: vi.fn().mockResolvedValue('hashed-pw'),
  verifyPassword: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com' } }));
vi.mock('../../src/utils/s3.js', () => ({ deleteFromS3: vi.fn() }));
vi.mock('../../src/loaders/redis.js', () => ({ getRedisClient: () => ({ set: vi.fn().mockResolvedValue('OK') }) }));
vi.mock('../../src/loaders/bootstrap.js', () => ({ PERMISSIONS: [] }));
vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: vi.fn().mockResolvedValue({ code: '123456', expiresIn: 300 }), verify: vi.fn() },
}));

// ── prisma mocks ──────────────────────────────────────────────────────────────

const mockUserFindUniqueOrThrow = vi.fn();
const mockUserFindUnique = vi.fn().mockResolvedValue(null);
const mockUserFindFirst = vi.fn().mockResolvedValue(null);
const mockUserUpdate = vi.fn();
const mockRefreshTokenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockInvitationFindUnique = vi.fn();
const mockOrgFindUnique = vi.fn().mockResolvedValue({ status: 'active' });

const mockRoleFindFirst = vi.fn();
const mockTxUserUpdate = vi.fn();
const mockTxUserCreate = vi.fn();
const mockTxUserFindUniqueOrThrow = vi.fn();
const mockTxRoleFindMany = vi.fn().mockResolvedValue([]);
const mockTxUserRoleDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxUserRoleCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTxInvitationUpdate = vi.fn().mockResolvedValue({});

const mockTransaction = vi.fn().mockImplementation(async (arg: unknown) => {
  if (typeof arg === 'function') {
    const tx = {
      user: { update: mockTxUserUpdate, create: mockTxUserCreate, findUniqueOrThrow: mockTxUserFindUniqueOrThrow },
      role: { findMany: mockTxRoleFindMany },
      userRole: { deleteMany: mockTxUserRoleDeleteMany, createMany: mockTxUserRoleCreateMany },
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
      findFirst: mockUserFindFirst,
      count: vi.fn().mockResolvedValue(1),
      update: mockUserUpdate,
    },
    role: { findFirst: mockRoleFindFirst },
    invitation: { findUnique: mockInvitationFindUnique, findFirst: vi.fn().mockResolvedValue(null) },
    org: { findUnique: mockOrgFindUnique },
    refreshToken: { updateMany: mockRefreshTokenUpdateMany },
    $transaction: mockTransaction,
  },
  Prisma: {},
}));

const { UserService } = await import('../../src/services/user.service.js');

const flushImmediate = () => new Promise<void>((r) => setImmediate(r));

// ── fixtures ──────────────────────────────────────────────────────────────────

const adminUser = {
  id: 'admin-1',
  org_id: null as string | null,
  user_type: 'staff',
  role_slugs: ['platform-admin'],
  rules: [{ action: 'manage', subject: 'all' }],
  locale: 'rw',
};

const makeStaffUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-2',
  first_name: 'Bob',
  last_name: 'Smith',
  phone_number: '+250788000002',
  email: null as string | null,
  password_hash: 'hash',
  status: 'active',
  user_type: 'staff',
  org_id: 'org-1' as string | null,
  avatar_path: null as string | null,
  login_channel: 'phone',
  two_factor_enabled: false,
  notif_channel: ['sms', 'app'],
  deleted_at: null,
  locale: 'rw',
  updated_at: new Date(),
  user_roles: [] as unknown[],
  user_grants: [] as unknown[],
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ── staff.created ─────────────────────────────────────────────────────────────

describe('UserService domain events — staff.created', () => {
  const invitation = {
    token_hash: 'h:invite-tok',
    first_name: 'Bob',
    last_name: 'Invited',
    phone_number: '+250780000099',
    email: null as string | null,
    locale: 'rw',
    org_id: 'org-1',
    accepted_at: null,
    expires_at: new Date(Date.now() + 3_600_000),
    invitation_roles: [{ role_id: 'role-1', role: { slug: 'org_staff' } }],
  };

  beforeEach(() => {
    mockInvitationFindUnique.mockResolvedValue(invitation);
    mockTxUserCreate.mockResolvedValue({
      id: 'user-new-1',
      first_name: 'Bob',
      last_name: 'Invited',
      org_id: 'org-1',
      avatar_path: null,
      user_type: 'staff',
      phone_number: '+250780000099',
      email: null,
      locale: 'rw',
    });
  });

  it('does not publish staff.created on acceptInvite (user is still pending_verification)', async () => {
    await UserService.acceptInvite('invite-tok', 'Pass!123');
    const staffCreatedCalls = publishUserEvent.mock.calls.filter(
      ([e]: [{ type: string }]) => e.type === 'staff.created',
    );
    expect(staffCreatedCalls).toHaveLength(0);
  });
});

// ── staff.updated via updateMe ────────────────────────────────────────────────

describe('UserService domain events — staff.updated (updateMe)', () => {
  const requestingUser = { id: 'user-1', org_id: 'org-1', user_type: 'staff', role_slugs: [], rules: [], locale: 'rw' };

  it('publishes staff.updated when first_name changes', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValueOnce({
      login_channel: 'phone',
      two_factor_enabled: false,
      avatar_path: null,
      first_name: 'OldFirst',
      last_name: 'Smith',
    });
    mockUserUpdate.mockResolvedValue(makeStaffUser({ first_name: 'NewFirst', id: 'user-1', org_id: 'org-1' }));

    await UserService.updateMe(requestingUser as never, { first_name: 'NewFirst' });

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated', id: 'user-1', first_name: 'NewFirst' }),
    );
  });

  it('publishes staff.updated when last_name changes', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValueOnce({
      login_channel: 'phone',
      two_factor_enabled: false,
      avatar_path: null,
      first_name: 'Bob',
      last_name: 'OldLast',
    });
    mockUserUpdate.mockResolvedValue(makeStaffUser({ last_name: 'NewLast', id: 'user-1', org_id: 'org-1' }));

    await UserService.updateMe(requestingUser as never, { last_name: 'NewLast' });

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated', id: 'user-1', last_name: 'NewLast' }),
    );
  });

  it('does NOT publish staff.updated when other fields change (two_factor_enabled)', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValueOnce({
      login_channel: 'phone',
      two_factor_enabled: false,
      avatar_path: null,
      first_name: 'Bob',
      last_name: 'Smith',
    });
    mockUserUpdate.mockResolvedValue(makeStaffUser({ two_factor_enabled: true, id: 'user-1' }));

    await UserService.updateMe(requestingUser as never, { two_factor_enabled: true });

    expect(publishUserEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated' }),
    );
  });
});

// ── staff.suspended via updateUser ────────────────────────────────────────────

describe('UserService domain events — staff.suspended (updateUser)', () => {
  it('publishes staff.suspended when staff user status set to suspended', async () => {
    const target = makeStaffUser({ id: 'user-2' });
    const updated = makeStaffUser({ id: 'user-2', status: 'suspended' });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);

    await UserService.updateUser(adminUser as never, 'user-2', { status: 'suspended' });
    await flushImmediate();

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.suspended', id: 'user-2', status: 'suspended' }),
    );
  });

  it('does NOT publish staff.suspended when passenger user is suspended', async () => {
    const target = makeStaffUser({ id: 'user-2', user_type: 'passenger' });
    const updated = makeStaffUser({ id: 'user-2', user_type: 'passenger', status: 'suspended' });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);

    await UserService.updateUser(adminUser as never, 'user-2', { status: 'suspended' });
    await flushImmediate();

    expect(publishUserEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.suspended' }),
    );
  });
});

// ── staff.updated via updateUser ─────────────────────────────────────────────

describe('UserService domain events — staff.updated (updateUser)', () => {
  it('publishes staff.updated when staff first_name changes', async () => {
    const target = makeStaffUser({ id: 'user-2', first_name: 'OldFirst' });
    const updated = makeStaffUser({ id: 'user-2', first_name: 'NewFirst' });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);

    await UserService.updateUser(adminUser as never, 'user-2', { first_name: 'NewFirst' });
    await flushImmediate();

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated', id: 'user-2', first_name: 'NewFirst' }),
    );
  });

  it('publishes staff.updated when status changes', async () => {
    const target = makeStaffUser({ id: 'user-2', status: 'active' });
    const updated = makeStaffUser({ id: 'user-2', status: 'suspended' });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockUserUpdate.mockResolvedValueOnce(updated);

    await UserService.updateUser(adminUser as never, 'user-2', { status: 'suspended' });
    await flushImmediate();

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated', id: 'user-2', status: 'suspended' }),
    );
  });

  it('publishes staff.updated when roles change (via assignRoles)', async () => {
    const target = makeStaffUser({ id: 'user-2', user_roles: [{ role: { slug: 'org-staff', role_grants: [] } }] });
    const updated = makeStaffUser({ id: 'user-2', user_roles: [{ role: { slug: 'org-admin', role_grants: [] } }] });
    mockUserFindUnique.mockResolvedValueOnce(target);
    mockRoleFindFirst.mockResolvedValueOnce({ id: 'role-org-admin', slug: 'org-admin', role_grants: [{ pattern: 'user:read:org' }] });
    mockTxUserFindUniqueOrThrow.mockResolvedValueOnce(updated);

    await UserService.assignRoles(adminUser as never, 'user-2', ['org-admin']);
    await flushImmediate();

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff.updated', id: 'user-2', roles: ['org-admin'] }),
    );
  });
});

// ── staff.deleted ─────────────────────────────────────────────────────────────

describe('UserService domain events — staff.deleted', () => {
  it('publishes staff.deleted when a staff user is soft-deleted', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeStaffUser({ id: 'user-2' }));

    await UserService.deleteUser(adminUser as never, 'user-2');

    expect(publishUserEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'staff.deleted',
        id: 'user-2',
        org_id: 'org-1',
        deleted_at: expect.any(String),
      }),
    );
  });

  it('does NOT publish staff.deleted for a passenger user', async () => {
    mockUserFindUnique.mockResolvedValueOnce(makeStaffUser({ id: 'user-2', user_type: 'passenger' }));

    await UserService.deleteUser(adminUser as never, 'user-2');

    expect(publishUserEvent).not.toHaveBeenCalled();
  });
});
