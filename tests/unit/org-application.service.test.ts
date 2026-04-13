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
  { email: 'admin1@katisha.com', phone_number: '+250788000010', notif_channel: ['sms', 'email'], fcm_token: null, locale: 'rw' },
  { email: 'admin2@katisha.com', phone_number: '+250788000011', notif_channel: ['email'], fcm_token: null, locale: 'rw' },
]);
const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    org: { create: mockTxOrgCreate },
    orgDocument: { createMany: mockTxOrgDocCreateMany },
  };
  return cb(tx);
});

const mockUserFindUnique = vi.fn().mockResolvedValue(null);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    org: { findFirst: mockOrgFindFirst, findUnique: mockOrgFindUnique, update: mockOrgUpdate },
    user: { findUnique: mockUserFindUnique, findMany: mockUserFindMany },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../src/utils/slugify.js', () => ({
  slugify: vi.fn().mockReturnValue('acme'),
}));

const mockPublishMail = vi.fn();
const mockPublishSms = vi.fn();
const mockPublishAudit = vi.fn();
const mockNotifyUser = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishMail: mockPublishMail,
  publishSms: mockPublishSms,
  publishAudit: mockPublishAudit,
  notifyUser: mockNotifyUser,
}));

const mockOrgOtpCreate = vi.fn().mockResolvedValue({ code: '123456', expiresIn: 300 });
const mockOrgOtpVerify = vi.fn().mockResolvedValue(undefined);
const mockOrgOtpHasExisting = vi.fn().mockResolvedValue(true);

vi.mock('../../src/services/org-otp.service.js', () => ({
  OrgOtpService: {
    create: mockOrgOtpCreate,
    verify: mockOrgOtpVerify,
    hasExisting: mockOrgOtpHasExisting,
  },
}));

const { OrgApplicationService } = await import('../../src/services/org-application.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const applyData = {
  name: 'Acme',
  org_type: 'company',
  contact_first_name: 'Jane',
  contact_last_name: 'Doe',
  contact_email: 'ops@acme.com',
  contact_phone: '+250788000001',
  tin: '123456789',
  business_certificate_path: 'org-docs/org-1/cert.pdf',
  rep_id_path: 'org-docs/org-1/id.jpg',
};

const makeOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  org_type: 'company',
  status: 'unverified',
  contact_first_name: 'Jane',
  contact_last_name: 'Doe',
  contact_email: 'ops@acme.com',
  contact_phone: '+250788000001',
  contact_email_verified_at: null,
  contact_phone_verified_at: null,
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

  it('creates the org and documents in a transaction with unverified status', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    const result = await OrgApplicationService.apply(applyData);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockTxOrgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Acme', slug: 'acme', status: 'unverified' }),
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

  it('creates OTPs for both phone and email channels', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    await OrgApplicationService.apply(applyData);
    expect(mockOrgOtpCreate).toHaveBeenCalledWith('org-1', 'phone_verification');
    expect(mockOrgOtpCreate).toHaveBeenCalledWith('org-1', 'email_verification');
  });

  it('sends OTP SMS to contact_phone', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    await OrgApplicationService.apply(applyData);
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_otp', phone_number: 'ops@acme.com' !== applyData.contact_phone ? applyData.contact_phone : applyData.contact_phone }),
    );
  });

  it('sends OTP email to contact_email', async () => {
    mockOrgFindFirst.mockResolvedValueOnce(null);
    mockTxOrgCreate.mockResolvedValueOnce({ id: 'org-1', name: 'Acme' });
    await OrgApplicationService.apply(applyData);
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_otp', email: applyData.contact_email }),
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
    await expect(OrgApplicationService.verifyContact('org-1', '123456', 'phone')).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('throws CONTACT_ALREADY_VERIFIED when org is not unverified', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ status: 'pending' }));
    await expect(OrgApplicationService.verifyContact('org-1', '123456', 'phone')).rejects.toMatchObject({
      code: 'CONTACT_ALREADY_VERIFIED', status: 409,
    });
  });

  it('throws CONTACT_ALREADY_VERIFIED when specified channel already verified', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ contact_phone_verified_at: new Date() }));
    await expect(OrgApplicationService.verifyContact('org-1', '123456', 'phone')).rejects.toMatchObject({
      code: 'CONTACT_ALREADY_VERIFIED', status: 409,
    });
  });

  it('verifies OTP via OrgOtpService for the correct purpose', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'phone');
    expect(mockOrgOtpVerify).toHaveBeenCalledWith('org-1', '123456', 'phone_verification');
  });

  it('verifies email OTP with email_verification purpose', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'email');
    expect(mockOrgOtpVerify).toHaveBeenCalledWith('org-1', '123456', 'email_verification');
  });

  it('updates org: sets verified_at and upgrades status to pending', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'phone');
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: expect.objectContaining({
        contact_phone_verified_at: expect.any(Date),
        status: 'pending',
      }),
    });
  });

  it('sends confirmation SMS to applicant', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'phone');
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_verified', phone_number: '+250788000001' }),
    );
  });

  it('notifies platform notification recipients via their preferences', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'phone');
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active', deleted_at: null }),
      }),
    );
    expect(mockNotifyUser).toHaveBeenCalledTimes(2);
  });

  it('publishes an audit event', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.verifyContact('org-1', '123456', 'phone');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'verify_contact', resource: 'Org', resource_id: 'org-1' }),
    );
  });
});

// ── resendContactOtp ──────────────────────────────────────────────────────────

describe('OrgApplicationService.resendContactOtp', () => {
  it('throws ORG_NOT_FOUND when org does not exist', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    await expect(OrgApplicationService.resendContactOtp('org-1', 'phone')).rejects.toMatchObject({
      code: 'ORG_NOT_FOUND', status: 404,
    });
  });

  it('throws CONTACT_ALREADY_VERIFIED when org is not unverified', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg({ status: 'pending' }));
    await expect(OrgApplicationService.resendContactOtp('org-1', 'phone')).rejects.toMatchObject({
      code: 'CONTACT_ALREADY_VERIFIED', status: 409,
    });
  });

  it('throws OTP_FLOW_NOT_INITIATED when no existing OTP for channel', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    mockOrgOtpHasExisting.mockResolvedValueOnce(false);
    await expect(OrgApplicationService.resendContactOtp('org-1', 'phone')).rejects.toMatchObject({
      code: 'OTP_FLOW_NOT_INITIATED', status: 400,
    });
  });

  it('creates new OTP and sends SMS for phone channel', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.resendContactOtp('org-1', 'phone');
    expect(mockOrgOtpCreate).toHaveBeenCalledWith('org-1', 'phone_verification');
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_otp', phone_number: '+250788000001' }),
    );
  });

  it('creates new OTP and sends mail for email channel', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    await OrgApplicationService.resendContactOtp('org-1', 'email');
    expect(mockOrgOtpCreate).toHaveBeenCalledWith('org-1', 'email_verification');
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.contact_otp', email: 'ops@acme.com' }),
    );
  });

  it('returns expires_in', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(makeOrg());
    const result = await OrgApplicationService.resendContactOtp('org-1', 'phone');
    expect(result).toMatchObject({ expires_in: 300 });
  });
});
