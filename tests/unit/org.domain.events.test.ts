/**
 * Tests that OrgService publishes org domain events on updateOrg.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishOrgEvent = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: vi.fn(),
  publishSms: vi.fn(),
  publishMail: vi.fn(),
  notifyUser: vi.fn(),
  publishOrgEvent,
}));

vi.mock('../../src/utils/crypto.js', () => ({
  generateRawToken: vi.fn(() => 'raw-tok'),
  hashToken: vi.fn((t: string) => `h:${t}`),
}));

vi.mock('../../src/config/index.js', () => ({
  config: { appUrl: 'https://staff.katisha.com' },
}));

vi.mock('../../src/utils/s3.js', () => ({ keyFromPublicUrl: vi.fn(() => null), deleteFromS3: vi.fn() }));
vi.mock('../../src/loaders/redis.js', () => ({ getRedisClient: () => ({ set: vi.fn().mockResolvedValue('OK') }) }));
vi.mock('../../src/utils/slugify.js', () => ({ slugify: vi.fn((n: string) => n.toLowerCase().replace(/\s/g, '-')) }));

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockRoleFindFirst = vi.fn().mockResolvedValue(null);
const mockInvitationCreate = vi.fn().mockResolvedValue({});
const mockUserFindMany = vi.fn().mockResolvedValue([]);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: { findUnique: mockFindUnique, findFirst: vi.fn().mockResolvedValue(null), update: mockUpdate },
    role: { findFirst: mockRoleFindFirst },
    invitation: { create: mockInvitationCreate },
    user: { findUnique: vi.fn().mockResolvedValue(null), findMany: mockUserFindMany },
  },
  Prisma: {},
}));

const { OrgService } = await import('../../src/services/org.service.js');

const flushImmediate = () => new Promise<void>((r) => setImmediate(r));

// ── fixtures ──────────────────────────────────────────────────────────────────

const baseOrg = {
  id: 'org-1',
  name: 'Acme Bus',
  slug: 'acme-bus',
  org_type: 'company',
  status: 'pending',
  contact_email: 'ops@acme.com',
  contact_phone: '+250780000010',
  contact_first_name: 'Jane',
  contact_last_name: 'Doe',
  address: null,
  story: null,
  logo_path: null,
  parent_org_id: null,
  tin: null,
  license_number: null,
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  cooperative_approved_at: null,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  parent_org: null,
  child_orgs: [],
};

const adminUser = {
  id: 'admin-1',
  org_id: null,
  user_type: 'staff',
  role_slugs: ['platform-admin'],
  rules: [{ action: 'manage', subject: 'all' }],
};

beforeEach(() => vi.clearAllMocks());

// ── org.activated ─────────────────────────────────────────────────────────────

describe('OrgService domain events — org.activated', () => {
  it('publishes org.activated when status set to active', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg });
    mockUpdate.mockResolvedValue({ ...baseOrg, status: 'active' });

    await OrgService.updateOrg(adminUser as never, 'org-1', { status: 'active' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.activated', id: 'org-1', status: 'active' }),
    );
  });

  it('does NOT publish org.activated when status is not active', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg });
    mockUpdate.mockResolvedValue({ ...baseOrg, contact_phone: '+250788000002' });

    await OrgService.updateOrg(adminUser as never, 'org-1', { contact_phone: '+250788000002' });
    await flushImmediate();

    expect(publishOrgEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.activated' }),
    );
  });
});

// ── org.updated ───────────────────────────────────────────────────────────────

describe('OrgService domain events — org.updated', () => {
  it('publishes org.updated when name changes', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg, name: 'Old Name' });
    mockUpdate.mockResolvedValue({
      ...baseOrg,
      name: 'New Name',
      slug: 'new-name',
      updated_at: updatedAt,
    });

    await OrgService.updateOrg(adminUser as never, 'org-1', { name: 'New Name' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'org.updated',
        id: 'org-1',
        name: 'New Name',
        updated_at: updatedAt.toISOString(),
      }),
    );
  });

  it('publishes org.updated when logo_path changes', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg, logo_path: null });
    mockUpdate.mockResolvedValue({
      ...baseOrg,
      logo_path: 'orgs/org-1/logo.png',
      updated_at: new Date(),
    });

    await OrgService.updateOrg(adminUser as never, 'org-1', { logo_path: 'orgs/org-1/logo.png' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.updated', id: 'org-1' }),
    );
  });

  it('publishes org.updated when parent_org_id changes', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg, parent_org_id: null });
    mockFindUnique.mockResolvedValueOnce({ org_type: 'cooperative' }); // parent-is-cooperative check
    mockUpdate.mockResolvedValue({
      ...baseOrg,
      parent_org_id: 'coop-1',
      updated_at: new Date(),
    });

    await OrgService.updateOrg(adminUser as never, 'org-1', { parent_org_id: 'coop-1' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.updated', id: 'org-1', parent_org_id: 'coop-1' }),
    );
  });

  it('publishes org.updated when story changes', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg, story: null });
    mockUpdate.mockResolvedValue({
      ...baseOrg,
      story: 'We connect Rwanda.',
      updated_at: new Date(),
    });

    await OrgService.updateOrg(adminUser as never, 'org-1', { story: 'We connect Rwanda.' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.updated', id: 'org-1', story: 'We connect Rwanda.' }),
    );
  });

  it('does NOT publish org.updated when other fields change', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg });
    mockUpdate.mockResolvedValue({ ...baseOrg, contact_phone: '+250788000002' });

    await OrgService.updateOrg(adminUser as never, 'org-1', { contact_phone: '+250788000002' });
    await flushImmediate();

    expect(publishOrgEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.updated' }),
    );
  });
});

// ── org.suspended ─────────────────────────────────────────────────────────────

describe('OrgService domain events — org.suspended', () => {
  it('publishes org.suspended when status set to suspended', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg });
    mockUpdate.mockResolvedValue({ ...baseOrg, status: 'suspended' });

    await OrgService.updateOrg(adminUser as never, 'org-1', { status: 'suspended' });
    await flushImmediate();

    expect(publishOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.suspended', id: 'org-1', status: 'suspended' }),
    );
  });

  it('does NOT publish org.suspended when status is not suspended', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseOrg });
    mockUpdate.mockResolvedValue({ ...baseOrg, contact_phone: '+250788000002' });

    await OrgService.updateOrg(adminUser as never, 'org-1', { contact_phone: '+250788000002' });
    await flushImmediate();

    expect(publishOrgEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.suspended' }),
    );
  });
});
