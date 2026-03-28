/**
 * Tests for src/services/otp.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockCreate = vi.fn().mockResolvedValue({});
const mockFindFirst = vi.fn();
const mockDelete = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    otp: { deleteMany: mockDeleteMany, create: mockCreate, findFirst: mockFindFirst, delete: mockDelete },
  },
}));

vi.mock('../../src/config/index.js', () => ({
  config: { otp: { ttlSeconds: 300, length: 6 } },
}));

const { OtpService } = await import('../../src/services/otp.service.js');

beforeEach(() => vi.clearAllMocks());

// ── create ─────────────────────────────────────────────────────────────────────

describe('OtpService.create', () => {
  it('deletes existing unused OTPs for same user+purpose', async () => {
    await OtpService.create('user-1', 'phone_verification');
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', purpose: 'phone_verification', used_at: null },
    });
  });

  it('creates a new OTP record', async () => {
    await OtpService.create('user-1', '2fa');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'user-1', purpose: '2fa', code_hash: expect.any(String) }),
      }),
    );
  });

  it('returns a 6-digit code and expiresIn', async () => {
    const { code, expiresIn } = await OtpService.create('user-1', 'password_reset');
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresIn).toBe(300);
  });
});

// ── verify ─────────────────────────────────────────────────────────────────────

describe('OtpService.verify', () => {
  it('deletes the OTP record on success', async () => {
    const futureExpiry = new Date(Date.now() + 60_000);
    mockFindFirst.mockResolvedValueOnce({ id: 'otp-1', expires_at: futureExpiry });
    await OtpService.verify('user-1', '123456', 'phone_verification');
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
  });

  it('throws INVALID_OTP when not found', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await expect(OtpService.verify('user-1', 'badcode', '2fa')).rejects.toMatchObject({
      code: 'INVALID_OTP', status: 400,
    });
  });

  it('deletes expired OTP and throws OTP_EXPIRED', async () => {
    const pastExpiry = new Date(Date.now() - 1000);
    mockFindFirst.mockResolvedValueOnce({ id: 'otp-1', expires_at: pastExpiry });
    await expect(OtpService.verify('user-1', '123456', 'phone_verification')).rejects.toMatchObject({
      code: 'OTP_EXPIRED', status: 410,
    });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
  });
});
