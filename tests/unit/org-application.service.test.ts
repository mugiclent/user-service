/**
 * Tests for src/services/org-application.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockTxOrgCreate = vi.fn();
const mockTxOrgDocCreateMany = vi.fn().mockResolvedValue({ count: 2 });

const mockOrgFindFirst = vi.fn();
const mockOrgFindUnique = vi.fn();
const mockOrgUpdate = vi.fn().mockResolvedValue({});
const mockUserFindMany = vi.fn().mockResolvedValue([
  { email: 'admin1@katisha.com' },
  { email: 'admin2@katisha.com' },
]);
const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    org: { create: mockTxOrgCreate },
    orgDocument: { createMany: mockTxOrgDocCreateMany },
  };
  return cb(tx);
});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: { findFirst: mockOrgFindFirst, findUnique: mockOrgFindUnique, update: mockOrgUpdate },
    user: { findMany: mockUserFindMany },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../src/utils/crypto.js', () => ({
  hashToken: vi.fn().mockReturnValue('hashed-otp'),
}));

vi.mock('../../src/utils/slugify.js', () => ({
  slugify: vi.fn().mockReturnValue('acme'),
}));

const mockPublishMail = vi.fn();
const mockPublishSms = vi.fn();
const mockPublishAudit = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishMail: mockPublishMail,
  publishSms: mockPublishSms,
  publishAudit: mockPublishAudit,
}));


const { OrgApplicationService } = await import('../../src/services/org-application.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const applyData = {
  name: 'Acme',
  org_type: 'company',
  contact_email: 'ops@acme.com',
  contact_phone: '+250788000001',
  business_certificate_path: 'org-docs/org-1/cert.pdf',
  rep_id_path: 'org-docs/org-1/id.jpg',
};

const futureExpiry = new Date(Date.now() + 60_000);
const pastExpiry = new Date(Date.now() - 60_000);

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  org_type: 'company',
  contact_email: 'ops@acme.com',
  contact_phone: '+250788000001',
  contact_email_verified_at: null,
  contact_otp_hash: 'hashed-otp',
  contact_otp_expires_at: futureExpiry,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ── apply ─────────────────────────────────────────────────────────────────────

describe('OrgApplicationService.apply', () => {
  it('throws ORG_ALREADY_EXISTS when name or slug is taken', async () => {
    mockOrgFindFirst.mockResolvedValueOnce({ id: 'existing-org' });
    await expect(OrgApplicationService.apply(applyData)).rejects.toMatchObject({
      code: 'ORG_ALREADY_EXISTS', status: 409,
    });
  });

  it('creates the org and documents in a transaction', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    const result = await OrgApplicationService.apply(applyData);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxOrgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Acme', slug: 'acme', status: 'pending', contact_otp_hash: 'hashed-otp' }),
      }),
    );
    expect(mockTxOrgDocCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ doc_type: 'business_certificate', s3_path: applyData.business_certificate_path }),
          expect.objectContaining({ doc_type: 'rep_id', s3_path: applyData.rep_id_path }),
        ]),
      }),
    );
    expect(result).toMatchObject({ org_id: 'org-1' });
  });

  it('sends OTP email to contact_email', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    await OrgApplicationService.apply(applyData);
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_otp', email: 'ops@acme.com' }),
    );
  });

  it('publishes an audit event', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    await OrgApplicationService.apply(applyData);
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apply', resource: 'Org', resource_id: 'org-1' }),
    );
  });

  it('returns org_id and a message string', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-99', name: 'Acme' });
    const result = await OrgApplicationService.apply(applyData);
    expect(result.org_id).toBe('org-99');
    expect(typeof result.message).toBe('string');
  });
});

// ── verifyContact ─────────────────────────────────────────────────────────────

describe('OrgApplicationService.verifyContact', () => {
  it('throws ORG_NOT_FOUND when org does not exist', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    await expect(OrgApplicationService.verifyContact('org-1', '123456')).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('throws CONTACT_ALREADY_VERIFIED when email already verified', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ contact_email_verified_at: new Date() }));
    await expect(OrgApplicationService.verifyContact('org-1', '123456')).rejects.toMatchObject({
      code: 'CONTACT_ALREADY_VERIFIED', status: 409,
    });
  });

  it('throws INVALID_OTP when no OTP hash stored', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ contact_otp_hash: null, contact_otp_expires_at: null }));
    await expect(OrgApplicationService.verifyContact('org-1', '123456')).rejects.toMatchObject({
      code: 'INVALID_OTP', status: 400,
    });
  });

  it('throws OTP_EXPIRED when OTP is past its expiry', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ contact_otp_expires_at: pastExpiry }));
    await expect(OrgApplicationService.verifyContact('org-1', '123456')).rejects.toMatchObject({
      code: 'OTP_EXPIRED', status: 410,
    });
  });

  it('throws INVALID_OTP when code hash does not match', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ contact_otp_hash: 'wrong-hash' }));
    await expect(OrgApplicationService.verifyContact('org-1', '000000')).rejects.toMatchObject({
      code: 'INVALID_OTP', status: 400,
    });
  });

  it('updates org with verified_at and clears OTP on success', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456');
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        contact_email_verified_at: expect.any(Date),
        contact_otp_hash: null,
        contact_otp_expires_at: null,
      },
    });
  });

  it('sends confirmation email and SMS to applicant', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456');
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_verified', email: 'ops@acme.com' }),
    );
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_verified', phone_number: '+250788000001' }),
    );
  });

  it('notifies all active Katisha admins by querying their role', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456');
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_roles: { some: { role: { slug: { in: ['katisha_admin', 'katisha_super_admin'] } } } },
          status: 'active',
          deleted_at: null,
        }),
      }),
    );
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.application_received', email: 'admin1@katisha.com' }),
    );
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.application_received', email: 'admin2@katisha.com' }),
    );
  });

  it('skips admins without an email address', async () => {
    mockUserFindMany.mockResolvedValueOnce([{ email: null }, { email: 'admin@katisha.com' }]);
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456');
    expect(mockPublishMail).toHaveBeenCalledTimes(2); // contact_verified + 1 admin (not the null one)
  });

  it('publishes an audit event', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'verify_contact', resource: 'Org', resource_id: 'org-1' }),
    );
  });
});
