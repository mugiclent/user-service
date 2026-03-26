/**
 * Verifies that OrgService publishes audit events for create, update,
 * and approve actions — and publishes org_approved notifications.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishAudit = vi.fn();
const publishSms   = vi.fn();
const publishMail  = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({ publishAudit, publishSms, publishMail }));

vi.mock('../../src/utils/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/crypto.js')>();
  return { ...actual, generateRawToken: vi.fn(() => 'org-raw-token'), hashToken: vi.fn((t: string) => `hashed:${t}`) };
});

vi.mock('../../src/config/index.js', () => ({ config: { appUrl: 'https://app.katisha.com' } }));

const mockSet = vi.fn().mockResolvedValue('OK');
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: mockSet }),
}));

const baseOrg = {
  id: 'org-1',
  name: 'Acme Bus',
  slug: 'acme-bus',
  org_type: 'company',
  status: 'pending',
  tin: null,
  license_number: null,
  contact_email: 'ops@acme.com',
  contact_phone: '+250780000010',
  address: null,
  logo_url: null,
  parent_org_id: null,
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  cooperative_approved_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  parent_org: null,
  child_orgs: [],
};

const adminUser = {
  id: 'admin-1',
  user_roles: [{ role: { slug: 'katisha_super_admin' } }],
  org_id: null,
};

const mockCreate = vi.fn().mockResolvedValue(baseOrg);
const mockFindFirst = vi.fn().mockResolvedValue(null);
const mockFindUnique = vi.fn().mockResolvedValue({ ...baseOrg, parent_org: null, child_orgs: [] });
const mockUpdate = vi.fn().mockResolvedValue({ ...baseOrg, parent_org: null, child_orgs: [] });
const mockRoleFindFirst = vi.fn().mockResolvedValue(null);
const mockInvitationCreate = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: {
      create:     mockCreate,
      findFirst:  mockFindFirst,
      findUnique: mockFindUnique,
      update:     mockUpdate,
    },
    role: {
      findFirst: mockRoleFindFirst,
    },
    invitation: {
      create: mockInvitationCreate,
    },
  },
  Prisma: {},
}));

const { OrgService } = await import('../../src/services/org.service.js');

beforeEach(() => vi.clearAllMocks());

// ── createOrg ─────────────────────────────────────────────────────────────────

describe('OrgService.createOrg', () => {
  it('publishes audit create event', async () => {
    await OrgService.createOrg(adminUser as never, {
      name: 'Acme Bus',
      org_type: 'company',
      contact_email: 'ops@acme.com',
      contact_phone: '+250780000010',
    });
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', resource: 'Org', resource_id: 'org-1' }),
    );
  });

  it('publishes exactly 1 audit event', async () => {
    await OrgService.createOrg(adminUser as never, {
      name: 'Acme Bus',
      org_type: 'company',
      contact_email: 'ops@acme.com',
      contact_phone: '+250780000010',
    });
    expect(publishAudit).toHaveBeenCalledTimes(1);
  });
});

// ── updateOrg ─────────────────────────────────────────────────────────────────

describe('OrgService.updateOrg', () => {
  beforeEach(() => {
    mockFindUnique
      .mockResolvedValueOnce(baseOrg)                                          // existence check
      .mockResolvedValue({ ...baseOrg, parent_org: null, child_orgs: [] });    // after update
  });

  it('publishes audit update event', async () => {
    await OrgService.updateOrg(adminUser as never, 'org-1', { contact_phone: '+250788000001' });
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', resource: 'Org', resource_id: 'org-1' }),
    );
  });

  it('publishes exactly 1 audit event on normal update', async () => {
    await OrgService.updateOrg(adminUser as never, 'org-1', { contact_phone: '+250788000001' });
    expect(publishAudit).toHaveBeenCalledTimes(1);
  });

  it('blacklists org in Redis when status set to suspended', async () => {
    await OrgService.updateOrg(adminUser as never, 'org-1', { status: 'suspended' });
    expect(mockSet).toHaveBeenCalledWith('blacklist:org:org-1', '1', 'EX', 900);
  });
});

// ── approveChildOrg — no org_admin role found ─────────────────────────────────

describe('OrgService.approveChildOrg — no org_admin role in DB', () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ ...baseOrg, status: 'pending', org_type: 'company', cooperative_approved_at: null });
    mockUpdate.mockResolvedValue({ ...baseOrg, status: 'active', parent_org: null, child_orgs: [] });
    mockRoleFindFirst.mockResolvedValue(null); // no org_admin role
  });

  it('publishes audit approve event', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approve', resource: 'Org', resource_id: 'org-1' }),
    );
  });

  it('publishes exactly 1 audit event and no notifications when org_admin role missing', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(publishAudit).toHaveBeenCalledTimes(1);
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
  });
});

// ── approveChildOrg — org_approved notifications ──────────────────────────────

describe('OrgService.approveChildOrg — org_approved notifications', () => {
  const approvedOrg = {
    ...baseOrg,
    status: 'active',
    contact_email: 'ops@acme.com',
    contact_phone: '+250780000010',
    name: 'Acme Bus',
    parent_org: null,
    child_orgs: [],
  };

  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ ...baseOrg, status: 'pending', org_type: 'company', cooperative_approved_at: null });
    mockUpdate.mockResolvedValue(approvedOrg);
    mockRoleFindFirst.mockResolvedValue({ id: 'role-org-admin', slug: 'org_admin' });
    mockInvitationCreate.mockResolvedValue({});
  });

  it('publishes org_approved.sms to the contact phone', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'org_approved.sms',
        phone_number: '+250780000010',
        org_name: 'Acme Bus',
        invite_link: expect.stringContaining('org-raw-token'),
      }),
    );
  });

  it('publishes org_approved.mail to the contact email', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(publishMail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'org_approved.mail',
        email: 'ops@acme.com',
        org_name: 'Acme Bus',
        invite_link: expect.stringContaining('org-raw-token'),
      }),
    );
  });

  it('invite_link uses the correct base URL', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    const smsCall = publishSms.mock.calls[0][0] as { invite_link: string };
    expect(smsCall.invite_link).toMatch(/^https:\/\/app\.katisha\.com/);
  });

  it('creates an invitation record for the org contact', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(mockInvitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'ops@acme.com',
          phone_number: '+250780000010',
          org_id: 'org-1',
        }),
      }),
    );
  });

  it('publishes audit approve + exactly 1 SMS + 1 mail', async () => {
    await OrgService.approveChildOrg(adminUser as never, 'org-1');
    expect(publishAudit).toHaveBeenCalledTimes(1);
    expect(publishSms).toHaveBeenCalledTimes(1);
    expect(publishMail).toHaveBeenCalledTimes(1);
  });
});
