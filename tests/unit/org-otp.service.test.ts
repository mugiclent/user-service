/**
 * Tests for src/services/org-otp.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as CryptoModule from '../../src/utils/crypto.js';
import type * as NodeCrypto from 'node:crypto';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockOrgOtpDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
const mockOrgOtpCreate = vi.fn().mockResolvedValue({});
const mockOrgOtpFindFirst = vi.fn().mockResolvedValue(null);
const mockOrgOtpDelete = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    orgOtp: {
      deleteMany: mockOrgOtpDeleteMany,
      create: mockOrgOtpCreate,
      findFirst: mockOrgOtpFindFirst,
      delete: mockOrgOtpDelete,
    },
  },
  Prisma: {},
}));

vi.mock('../../src/utils/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return { ...actual, hashToken: vi.fn((t: string) => `hashed:${t}`) };
});

vi.mock('../../src/config/index.js', () => ({
  config: { otp: { length: 6, ttlSeconds: 300 } },
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(() => 123456) };
});

const { OrgOtpService } = await import('../../src/services/org-otp.service.js');

beforeEach(() => vi.clearAllMocks());

// ── create ────────────────────────────────────────────────────────────────────

describe('OrgOtpService.create', () => {
  it('deletes existing unused OTPs for the same org+purpose before creating', async () => {
    await OrgOtpService.create('org-1', 'phone_verification');
    expect(mockOrgOtpDeleteMany).toHaveBeenCalledWith({
      where: { org_id: 'org-1', purpose: 'phone_verification', used_at: null },
    });
  });

  it('creates a new OTP record with hashed code', async () => {
    await OrgOtpService.create('org-1', 'phone_verification');
    expect(mockOrgOtpCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org-1',
          purpose: 'phone_verification',
          code_hash: 'hashed:123456',
        }),
      }),
    );
  });

  it('returns the plaintext code and expiresIn', async () => {
    const result = await OrgOtpService.create('org-1', 'phone_verification');
    expect(result.code).toBe('123456');
    expect(result.expiresIn).toBe(300);
  });
});

// ── verify ────────────────────────────────────────────────────────────────────

describe('OrgOtpService.verify', () => {
  it('throws INVALID_OTP when no matching OTP is found', async () => {
    mockOrgOtpFindFirst.mockResolvedValueOnce(null);
    await expect(OrgOtpService.verify('org-1', '000000', 'phone_verification')).rejects.toMatchObject({
      code: 'INVALID_OTP', status: 400,
    });
  });

  it('throws OTP_EXPIRED and deletes the record when OTP is expired', async () => {
    mockOrgOtpFindFirst.mockResolvedValueOnce({
      id: 'otp-1',
      expires_at: new Date(Date.now() - 1000),
    });
    await expect(OrgOtpService.verify('org-1', '123456', 'phone_verification')).rejects.toMatchObject({
      code: 'OTP_EXPIRED', status: 410,
    });
    expect(mockOrgOtpDelete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
  });

  it('deletes the OTP record on successful verification', async () => {
    mockOrgOtpFindFirst.mockResolvedValueOnce({
      id: 'otp-1',
      expires_at: new Date(Date.now() + 60_000),
    });
    await OrgOtpService.verify('org-1', '123456', 'phone_verification');
    expect(mockOrgOtpDelete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
  });
});

// ── hasExisting ───────────────────────────────────────────────────────────────

describe('OrgOtpService.hasExisting', () => {
  it('returns true when an unused OTP exists', async () => {
    mockOrgOtpFindFirst.mockResolvedValueOnce({ id: 'otp-1' });
    expect(await OrgOtpService.hasExisting('org-1', 'phone_verification')).toBe(true);
  });

  it('returns false when no unused OTP exists', async () => {
    mockOrgOtpFindFirst.mockResolvedValueOnce(null);
    expect(await OrgOtpService.hasExisting('org-1', 'phone_verification')).toBe(false);
  });
});
