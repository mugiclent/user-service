/**
 * Verifies that UserService.inviteUser() and acceptInvite() publish
 * the correct notification and audit messages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishSms  = vi.fn();
const publishMail = vi.fn();
const publishAudit = vi.fn();

const notifyUser = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({ publishSms, publishMail, publishAudit, notifyUser }));

// Fixed token so we can assert on invite_link contents
vi.mock('../../src/utils/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/crypto.js')>();
  return {
    ...actual,
    generateRawToken: vi.fn(() => 'test-raw-token-abc'),
    hashToken: vi.fn((t: string) => `hashed:${t}`),
  };
});

vi.mock('../../src/config/index.js', () => ({
  config: { appUrl: 'https://app.katisha.com' },
}));

vi.mock('../../src/utils/s3.js', () => ({
  keyFromPublicUrl: vi.fn(() => null),
  deleteFromS3: vi.fn(),
}));

const mockRoleFindFirst = vi.fn();
const mockInvitationCreate = vi.fn().mockResolvedValue({});
const mockInvitationFindUnique = vi.fn();
const mockUserCreate = vi.fn();
const mockUserRoleCreate = vi.fn();
const mockInvitationUpdate = vi.fn();

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    role: {
      findFirst: mockRoleFindFirst,
    },
    invitation: {
      create:     mockInvitationCreate,
      findUnique: mockInvitationFindUnique,
      update:     mockInvitationUpdate,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          create:           mockUserCreate,
          findUniqueOrThrow: vi.fn().mockResolvedValue(makeAcceptedUser()),
        },
        userRole: { create: mockUserRoleCreate },
        invitation: { update: mockInvitationUpdate },
      };
      return fn(tx);
    }),
  },
  Prisma: {},
}));

// ── import service AFTER mocks ────────────────────────────────────────────────
const { UserService } = await import('../../src/services/user.service.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const makeAdmin = (overrides: Record<string, unknown> = {}) => ({
  id: 'admin-1',
  org_id: null,
  role_slugs: ['katisha_admin'],
  rules: [],
  user_type: 'staff',
  ...overrides,
});

const makeOrgAdmin = () => ({
  id: 'orgadmin-1',
  org_id: 'org-1',
  role_slugs: ['org_admin'],
  rules: [],
  user_type: 'staff',
});

const makeAcceptedUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-new-1',
  first_name: 'Bob',
  last_name: 'Invited',
  phone_number: '+250780000099',
  email: null,
  password_hash: 'hash',
  user_type: 'staff',
  status: 'active',
  two_factor_enabled: false,
  org_id: 'org-1',
  avatar_path: null,
  phone_verified_at: new Date(),
  email_verified_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  user_roles: [{ role: { slug: 'org_staff' } }],
  ...overrides,
});

const baseRole = { id: 'role-org-staff', slug: 'org_staff', org_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockRoleFindFirst.mockResolvedValue(baseRole);
  mockInvitationCreate.mockResolvedValue({});
  mockUserCreate.mockResolvedValue(makeAcceptedUser());
});

// ── inviteUser — phone only ───────────────────────────────────────────────────

describe('UserService.inviteUser — phone only', () => {
  const req = {
    phone_number: '+250780000099',
    first_name: 'Bob',
    last_name: 'Invited',
    role_slug: 'org_staff',
  };

  it('publishes invite.sms with correct fields', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invite.sms',
        phone_number: '+250780000099',
        first_name: 'Bob',
        invite_link: expect.stringContaining('test-raw-token-abc'),
      }),
    );
  });

  it('invite_link points to the correct base URL', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    const call = publishSms.mock.calls[0][0] as { invite_link: string };
    expect(call.invite_link).toMatch(/^https:\/\/app\.katisha\.com/);
  });

  it('does NOT publish mail when no email provided', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishMail).not.toHaveBeenCalled();
  });

  it('publishes audit event with action invite', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite', resource: 'User' }),
    );
  });

  it('publishes exactly 1 SMS and 1 audit event', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishSms).toHaveBeenCalledTimes(1);
    expect(publishAudit).toHaveBeenCalledTimes(1);
  });
});

// ── inviteUser — email only ───────────────────────────────────────────────────

describe('UserService.inviteUser — email only', () => {
  const req = {
    email: 'bob@example.com',
    first_name: 'Bob',
    last_name: 'Invited',
    role_slug: 'org_staff',
  };

  it('publishes invite.mail with correct fields', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishMail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invite.mail',
        email: 'bob@example.com',
        first_name: 'Bob',
        invite_link: expect.stringContaining('test-raw-token-abc'),
      }),
    );
  });

  it('does NOT publish SMS when no phone provided', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishSms).not.toHaveBeenCalled();
  });

  it('publishes audit event with action invite', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite', resource: 'User' }),
    );
  });
});

// ── inviteUser — both phone and email ─────────────────────────────────────────

describe('UserService.inviteUser — phone + email', () => {
  const req = {
    phone_number: '+250780000099',
    email: 'bob@example.com',
    first_name: 'Bob',
    last_name: 'Invited',
    role_slug: 'org_staff',
  };

  it('publishes both invite.sms and invite.mail', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.sms' }));
    expect(publishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.mail' }));
  });

  it('publishes exactly 1 SMS, 1 mail, 1 audit', async () => {
    await UserService.inviteUser(makeAdmin() as never, req);
    expect(publishSms).toHaveBeenCalledTimes(1);
    expect(publishMail).toHaveBeenCalledTimes(1);
    expect(publishAudit).toHaveBeenCalledTimes(1);
  });
});

// ── inviteUser — org_admin scopes to own org ──────────────────────────────────

describe('UserService.inviteUser — sent by org_admin', () => {
  it('publishes invite.sms from an org_admin', async () => {
    await UserService.inviteUser(makeOrgAdmin() as never, {
      phone_number: '+250780000099',
      first_name: 'Bob',
      last_name: 'Invited',
      role_slug: 'org_staff',
    });
    expect(publishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite.sms' }));
  });
});

// ── acceptInvite ──────────────────────────────────────────────────────────────

describe('UserService.acceptInvite', () => {
  beforeEach(() => {
    mockInvitationFindUnique.mockResolvedValue({
      token_hash: 'hashed:test-raw-token-abc',
      first_name: 'Bob',
      last_name: 'Invited',
      phone_number: '+250780000099',
      email: null,
      role_id: 'role-org-staff',
      org_id: 'org-1',
      accepted_at: null,
      expires_at: new Date(Date.now() + 3_600_000),
    });
  });

  it('publishes welcome.sms after accepting invite', async () => {
    await UserService.acceptInvite('test-raw-token-abc', 'NewPass!123');
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'welcome.sms', phone_number: '+250780000099' }),
    );
  });

  it('publishes audit accept_invite event', async () => {
    await UserService.acceptInvite('test-raw-token-abc', 'NewPass!123');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept_invite', resource: 'User' }),
    );
  });

  it('does NOT publish welcome.mail when no email on invitation', async () => {
    await UserService.acceptInvite('test-raw-token-abc', 'NewPass!123');
    expect(publishMail).not.toHaveBeenCalled();
  });

  it('publishes welcome.mail when invitation has email', async () => {
    mockInvitationFindUnique.mockResolvedValue({
      token_hash: 'hashed:test-raw-token-abc',
      first_name: 'Carol',
      last_name: 'Staff',
      phone_number: '+250780000088',
      email: 'carol@example.com',
      role_id: 'role-org-staff',
      org_id: 'org-1',
      accepted_at: null,
      expires_at: new Date(Date.now() + 3_600_000),
    });
    const acceptedUser = makeAcceptedUser({ email: 'carol@example.com', first_name: 'Carol' });
    // Override the $transaction mock for this specific test
    const { prisma } = await import('../../src/models/index.js');
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { create: mockUserCreate, findUniqueOrThrow: vi.fn().mockResolvedValue(acceptedUser) },
        userRole: { create: mockUserRoleCreate },
        invitation: { update: mockInvitationUpdate },
      };
      return fn(tx);
    });
    await UserService.acceptInvite('test-raw-token-abc', 'NewPass!123');
    expect(publishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'welcome.mail', email: 'carol@example.com' }),
    );
  });
});
