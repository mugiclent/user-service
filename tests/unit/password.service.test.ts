/**
 * Tests for src/services/password.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockUserFindFirst = vi.fn();
const mockUserUpdate = vi.fn().mockResolvedValue({ id: 'user-1' });
const mockRefreshTokenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockTransaction = vi.fn().mockResolvedValue([]);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { findFirst: mockUserFindFirst, update: mockUserUpdate },
    refreshToken: { updateMany: mockRefreshTokenUpdateMany },
    $transaction: mockTransaction,
  },
}));

const mockHashPassword = vi.fn().mockResolvedValue('new-hash');

vi.mock('../../src/utils/crypto.js', () => ({
  hashPassword: mockHashPassword,
}));

const mockOtpCreate = vi.fn().mockResolvedValue({ code: '654321', expiresIn: 300 });
const mockOtpVerify = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: mockOtpCreate, verify: mockOtpVerify },
}));

const mockPublishSms = vi.fn();
const mockPublishMail = vi.fn();
const mockPublishAudit = vi.fn();
const mockNotifyUser = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishSms: mockPublishSms,
  publishMail: mockPublishMail,
  publishAudit: mockPublishAudit,
  notifyUser: mockNotifyUser,
}));

const { PasswordService } = await import('../../src/services/password.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  phone_number: '+250788000001',
  email: null,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

// ── forgotPassword ────────────────────────────────────────────────────────────

describe('PasswordService.forgotPassword', () => {
  it('returns silently when user not found (no enumeration)', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    await expect(PasswordService.forgotPassword('+250788000001')).resolves.toBeUndefined();
    expect(mockOtpCreate).not.toHaveBeenCalled();
  });

  it('sends OTP via SMS for phone identifier', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await PasswordService.forgotPassword('+250788000001');
    expect(mockOtpCreate).toHaveBeenCalledWith('user-1', 'password_reset');
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'otp.sms', purpose: 'password_reset', phone_number: '+250788000001' }),
    );
    expect(mockPublishMail).not.toHaveBeenCalled();
  });

  it('sends OTP via email for email identifier', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ email: 'jane@example.com' }));
    await PasswordService.forgotPassword('jane@example.com');
    expect(mockPublishMail).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'otp.mail', purpose: 'password_reset', email: 'jane@example.com' }),
    );
    expect(mockPublishSms).not.toHaveBeenCalled();
  });

  it('sends OTP via SMS for email identifier when email field is null', async () => {
    // identifier has @ but user.email is null — falls through to SMS
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ email: null }));
    await PasswordService.forgotPassword('jane@example.com');
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'otp.sms', purpose: 'password_reset' }),
    );
  });

  it('looks up by email when identifier contains @', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    await PasswordService.forgotPassword('jane@example.com');
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'jane@example.com' } }),
    );
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('PasswordService.resetPassword', () => {
  it('throws INVALID_OTP when user not found', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    await expect(PasswordService.resetPassword('+250788000001', '123456', 'NewPass1!')).rejects.toMatchObject({
      code: 'INVALID_OTP', status: 400,
    });
  });

  it('delegates OTP verification to OtpService.verify', async () => {
    mockOtpVerify.mockRejectedValueOnce({ code: 'INVALID_OTP', status: 400 });
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await expect(PasswordService.resetPassword('+250788000001', 'badcode', 'NewPass1!')).rejects.toMatchObject({
      code: 'INVALID_OTP',
    });
  });

  it('updates password and revokes all sessions on success', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await PasswordService.resetPassword('+250788000001', '123456', 'NewPass1!');
    expect(mockHashPassword).toHaveBeenCalledWith('NewPass1!');
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { password_hash: 'new-hash' } }),
    );
    expect(mockRefreshTokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revoked_at: expect.any(Date) } }),
    );
  });

  it('notifies the user after password change', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await PasswordService.resetPassword('+250788000001', '123456', 'NewPass1!');
    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sms: expect.objectContaining({ type: 'security.password_changed' }) }),
    );
  });

  it('publishes an audit event', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await PasswordService.resetPassword('+250788000001', '123456', 'NewPass1!');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'password_reset', resource: 'User' }),
    );
  });

  it('includes mail notification when user has email', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ email: 'jane@example.com' }));
    await PasswordService.resetPassword('+250788000001', '123456', 'NewPass1!');
    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mail: expect.objectContaining({ type: 'security.password_changed', email: 'jane@example.com' }),
      }),
    );
  });
});
