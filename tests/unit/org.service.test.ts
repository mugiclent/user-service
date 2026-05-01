/**
 * Tests for src/services/org.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockOrgFindFirst = vi.fn();
const mockOrgFindUnique = vi.fn();
const mockOrgCreate = vi.fn();
const mockOrgUpdate = vi.fn();
const mockOrgFindMany = vi.fn().mockResolvedValue([]);
const mockOrgCount = vi.fn().mockResolvedValue(0);
const mockUserFindUnique = vi.fn().mockResolvedValue(null);
const mockUserFindMany = vi.fn().mockResolvedValue([]);
const mockRoleFindFirst = vi.fn();
const mockInvitationCreate = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: {
      findFirst: mockOrgFindFirst,
      findUnique: mockOrgFindUnique,
      create: mockOrgCreate,
      update: mockOrgUpdate,
      findMany: mockOrgFindMany,
      count: mockOrgCount,
    },
    user: { findUnique: mockUserFindUnique, findMany: mockUserFindMany },
    role: { findFirst: mockRoleFindFirst },
    invitation: { create: mockInvitationCreate },
  },
}));

const mockRedisSet = vi.fn().mockResolvedValue('OK');
vi.mock('../../src/loaders/redis.js', () => ({
  getRedisClient: () => ({ set: mockRedisSet }),
}));

vi.mock('../../src/utils/slugify.js', () => ({
  slugify: vi.fn().mockReturnValue('acme'),
}));

vi.mock('../../src/utils/crypto.js', () => ({
  generateRawToken: vi.fn().mockReturnValue('raw-token'),
  hashToken: vi.fn().mockReturnValue('hashed-token'),
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
  publishOrgEvent: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: { appUrl: 'https://app.katisha.rw' },
}));

const mockDeleteFromS3 = vi.fn();
vi.mock('../../src/utils/s3.js', () => ({
  deleteFromS3: mockDeleteFromS3,
}));

const mockSerializeOrgForList = vi.fn().mockImplementation((o: { id: string }) => ({ id: o.id }));
const mockSerializeOrgCreated = vi.fn().mockImplementation((o: { id: string }) => ({ id: o.id, created: true }));
const mockSerializeOrgFull = vi.fn().mockImplementation((o: { id: string }) => ({ id: o.id, full: true }));

vi.mock('../../src/models/serializers.js', () => ({
  serializeOrgForList: mockSerializeOrgForList,
  serializeOrgCreated: mockSerializeOrgCreated,
  serializeOrgFull: mockSerializeOrgFull,
}));

const { OrgService } = await import('../../src/services/org.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_RULES = [{ action: 'manage', subject: 'all' }];
const orgAdminRules = (orgId: string) => [{ action: 'manage', subject: 'Org', conditions: { id: orgId } }];

const makeAuthUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-admin',
  org_id: null as string | null,
  user_type: 'staff',
  role_slugs: ['platform-admin'] as string[],
  rules: PLATFORM_RULES as unknown[],
  ...overrides,
});

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  org_type: 'company',
  status: 'pending',
  contact_email: 'ops@acme.com',
  contact_phone: '+250788000001',
  parent_org_id: null as string | null,
  cooperative_approved_at: null,
  logo_path: null as string | null,
  address: null,
  rejection_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
  parent_org: null,
  child_orgs: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgUpdate.mockResolvedValue(makeOrg());
  mockUserFindMany.mockResolvedValue([]);
});

// ── createOrg ─────────────────────────────────────────────────────────────────

describe('OrgService.createOrg', () => {
  it('throws ORG_ALREADY_EXISTS when name or slug is taken', async () => {
    mockOrgFindFirst.mockResolvedValueOnce({ id: 'existing' });
    const authUser = makeAuthUser();
    await expect(OrgService.createOrg(authUser as never, { name: 'Acme', org_type: 'company', contact_email: 'a@b.com', contact_phone: '+250788000001' })).rejects.toMatchObject({
      code: 'ORG_ALREADY_EXISTS', status: 409,
    });
  });

  it('creates org and returns serialized result', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockOrgCreate.mockResolvedValueOnce(makeOrg());
    const authUser = makeAuthUser();
    const result = await OrgService.createOrg(authUser as never, { name: 'Acme', org_type: 'company', contact_email: 'a@b.com', contact_phone: '+250788000001' });
    expect(mockOrgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Acme', slug: 'acme' }) }),
    );
    expect(result).toMatchObject({ id: 'org-1', created: true });
  });

  it('publishes audit event', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockOrgCreate.mockResolvedValueOnce(makeOrg());
    await OrgService.createOrg(makeAuthUser() as never, { name: 'Acme', org_type: 'company', contact_email: 'a@b.com', contact_phone: '+250788000001' });
    expect(mockPublishAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resource: 'Org' }));
  });
});

// ── listOrgs ──────────────────────────────────────────────────────────────────

describe('OrgService.listOrgs', () => {
  it('admin can see all orgs', async () => {
    mockOrgFindMany.mockResolvedValueOnce([makeOrg()]);
    mockOrgCount.mockResolvedValueOnce(1);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    const result = await OrgService.listOrgs(authUser as never, {});
    const where = mockOrgFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('id');
    expect(result.total).toBe(1);
  });

  it('non-admin with org_id sees their org and child orgs', async () => {
    mockOrgFindMany.mockResolvedValueOnce([]);
    mockOrgCount.mockResolvedValueOnce(0);
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1', rules: orgAdminRules('org-1') });
    await OrgService.listOrgs(authUser as never, {});
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: 'org-1' }, { parent_org_id: 'org-1' }],
        }),
      }),
    );
  });

  it('applies status and org_type filters', async () => {
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.listOrgs(authUser as never, { status: 'active', org_type: 'company' });
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'active', org_type: 'company' }) }),
    );
  });

  it('returns pagination metadata', async () => {
    const authUser = makeAuthUser();
    const result = await OrgService.listOrgs(authUser as never, { page: 3, limit: 10 });
    expect(result).toMatchObject({ page: 3, limit: 10 });
  });
});

// ── getMyOrg ──────────────────────────────────────────────────────────────────

describe('OrgService.getMyOrg', () => {
  it('throws ORG_NOT_FOUND when requestingUser has no org_id', async () => {
    const authUser = makeAuthUser({ org_id: null });
    await expect(OrgService.getMyOrg(authUser as never)).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('throws ORG_NOT_FOUND when org not in DB', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ org_id: 'org-1' });
    await expect(OrgService.getMyOrg(authUser as never)).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('returns serialized org for org member', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    const authUser = makeAuthUser({ org_id: 'org-1', role_slugs: ['org-admin'], rules: orgAdminRules('org-1') });
    const result = await OrgService.getMyOrg(authUser as never);
    expect(result).toMatchObject({ id: 'org-1', full: true });
  });
});

// ── getOrgById ────────────────────────────────────────────────────────────────

describe('OrgService.getOrgById', () => {
  it('throws ORG_NOT_FOUND when org does not exist', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    await expect(OrgService.getOrgById(makeAuthUser() as never, 'org-99')).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('admin can view any org', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ id: 'org-2' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'], org_id: 'org-1', rules: PLATFORM_RULES });
    await OrgService.getOrgById(authUser as never, 'org-2');
    expect(mockSerializeOrgFull).toHaveBeenCalledWith(expect.objectContaining({ id: 'org-2' }), true);
  });

  it('non-admin cannot view a different org', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ id: 'org-2' }));
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1', rules: orgAdminRules('org-1') });
    await expect(OrgService.getOrgById(authUser as never, 'org-2')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('non-admin can view own org', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ id: 'org-1' }));
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1', rules: orgAdminRules('org-1') });
    await OrgService.getOrgById(authUser as never, 'org-1');
    expect(mockSerializeOrgFull).toHaveBeenCalled();
  });
});

// ── updateOrg ─────────────────────────────────────────────────────────────────

describe('OrgService.updateOrg', () => {
  it('throws FORBIDDEN for user without admin or org_admin role', async () => {
    const authUser = makeAuthUser({ role_slugs: ['dispatcher'], rules: [] });
    await expect(OrgService.updateOrg(authUser as never, 'org-1', {})).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws FORBIDDEN for org_admin updating a different org', async () => {
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1', rules: orgAdminRules('org-1') });
    await expect(OrgService.updateOrg(authUser as never, 'org-2', {})).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws FORBIDDEN when org_admin tries to change status', async () => {
    const authUser = makeAuthUser({ role_slugs: ['org-admin'], org_id: 'org-1', rules: orgAdminRules('org-1') });
    await expect(OrgService.updateOrg(authUser as never, 'org-1', { status: 'active' })).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ORG_NOT_FOUND when org does not exist', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(OrgService.updateOrg(authUser as never, 'org-99', {})).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('updates org and returns serialized result', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Old', contact_email: 'a@b.com', contact_phone: '+250788000001', address: null, status: 'pending', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'active' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    const result = await OrgService.updateOrg(authUser as never, 'org-1', { status: 'active' });
    expect(result).toMatchObject({ id: 'org-1', full: true });
  });

  it('deletes old S3 logo when logo_path changes and old path exists', async () => {
    const existing = { id: 'org-1', logo_path: 'logos/old.png', name: 'Acme', contact_email: 'a@b.com', contact_phone: '+1', address: null, status: 'active', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg());
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { logo_path: 'logos/new.png' });
    expect(mockDeleteFromS3).toHaveBeenCalledWith('logos/old.png');
  });

  it('sets Redis blacklist and sends notifications when status changed to suspended', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Acme', contact_email: 'ops@acme.com', contact_phone: '+250788000001', address: null, status: 'active', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'suspended', contact_email: 'ops@acme.com' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { status: 'suspended' });
    expect(mockRedisSet).toHaveBeenCalledWith('blacklist:org:org-1', '1', 'EX', 900);
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'org.suspended' }));
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'org.suspended' }));
  });

  it('fails open when Redis throws on suspension', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Acme', contact_email: 'a@b.com', contact_phone: '+1', address: null, status: 'active', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'suspended', contact_email: 'a@b.com' }));
    mockRedisSet.mockRejectedValueOnce(new Error('redis down'));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await expect(OrgService.updateOrg(authUser as never, 'org-1', { status: 'suspended' })).resolves.toBeDefined();
  });

  it('sends rejection notifications when status changed to rejected', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Acme', contact_email: 'ops@acme.com', contact_phone: '+250788000001', address: null, status: 'pending', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'rejected', contact_email: 'ops@acme.com' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { status: 'rejected', rejection_reason: 'Docs invalid' });
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'org.rejected' }));
    expect(mockPublishMail).toHaveBeenCalledWith(expect.objectContaining({ type: 'org.rejected' }));
  });

  it('sets approved_by and approved_at when activating', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Acme', contact_email: 'a@b.com', contact_phone: '+1', address: null, status: 'pending', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'active' }));
    const authUser = makeAuthUser({ id: 'admin-user', role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { status: 'active' });
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approved_by: 'admin-user', approved_at: expect.any(Date) }),
      }),
    );
  });

  it('updates name and slug when name is provided', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Old Name', contact_email: 'a@b.com', contact_phone: '+1', address: null, status: 'active', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ name: 'New Name' }));
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { name: 'New Name' });
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'New Name', slug: 'acme' }),
      }),
    );
  });

  it('fans out notifications to active org users on suspension', async () => {
    const existing = { id: 'org-1', logo_path: null, name: 'Acme', contact_email: 'ops@acme.com', contact_phone: '+250788000001', address: null, status: 'active', rejection_reason: null };
    mockOrgFindUnique.mockResolvedValueOnce(existing);
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ status: 'suspended', contact_email: 'ops@acme.com' }));
    const activeUser = { id: 'u1', phone_number: '+250788000002', email: null, fcm_token: null, notif_channel: 'sms' };
    mockUserFindMany.mockResolvedValueOnce([activeUser]);
    const authUser = makeAuthUser({ role_slugs: ['platform-admin'] });
    await OrgService.updateOrg(authUser as never, 'org-1', { status: 'suspended' });
    // flush the fire-and-forget promise
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockNotifyUser).toHaveBeenCalledWith(
      activeUser,
      expect.objectContaining({ sms: expect.objectContaining({ type: 'org.suspended' }) }),
    );
  });
});

// ── cooperativeApprove ────────────────────────────────────────────────────────

describe('OrgService.cooperativeApprove', () => {
  const coopOrg = (overrides: Record<string, unknown> = {}) => makeOrg({
    org_type: 'coop_member',
    parent_org_id: 'coop-1',
    status: 'pending',
    cooperative_approved_at: null,
    ...overrides,
  });
  const coopAdmin = () => makeAuthUser({ org_id: 'coop-1', role_slugs: ['org-admin'], rules: orgAdminRules('coop-1') });

  it('throws FORBIDDEN when caller has no org_id', async () => {
    await expect(OrgService.cooperativeApprove(makeAuthUser() as never, 'org-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ORG_NOT_FOUND when org does not exist', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    await expect(OrgService.cooperativeApprove(coopAdmin() as never, 'org-99')).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('throws NOT_COOP_MEMBER when org type is not coop_member', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ parent_org_id: 'coop-1' })); // org_type: 'company'
    await expect(OrgService.cooperativeApprove(coopAdmin() as never, 'org-1')).rejects.toMatchObject({
      code: 'NOT_COOP_MEMBER', status: 400,
    });
  });

  it('throws FORBIDDEN when org_admin is not the parent cooperative', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(coopOrg({ parent_org_id: 'other-coop' }));
    await expect(OrgService.cooperativeApprove(coopAdmin() as never, 'org-1')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });
  });

  it('throws ORG_NOT_PENDING when org is not pending', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(coopOrg({ status: 'active' }));
    await expect(OrgService.cooperativeApprove(coopAdmin() as never, 'org-1')).rejects.toMatchObject({
      code: 'ORG_NOT_PENDING', status: 400,
    });
  });

  it('throws ALREADY_COOP_APPROVED when already stamped', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(coopOrg({ cooperative_approved_at: new Date() }));
    await expect(OrgService.cooperativeApprove(coopAdmin() as never, 'org-1')).rejects.toMatchObject({
      code: 'ALREADY_COOP_APPROVED', status: 409,
    });
  });

  it('stamps cooperative_approved_at and publishes audit', async () => {
    mockOrgFindUnique
      .mockResolvedValueOnce(coopOrg())          // org lookup
      .mockResolvedValueOnce({ name: 'Test Coop' }); // parentCoop name lookup
    mockOrgUpdate.mockResolvedValueOnce(makeOrg({ cooperative_approved_at: new Date() }));
    await OrgService.cooperativeApprove(coopAdmin() as never, 'org-1');
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cooperative_approved_at: expect.any(Date) }) }),
    );
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cooperative_approve', resource: 'Org' }),
    );
  });
});
