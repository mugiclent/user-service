/**
 * Verifies that PasswordService publishes the correct messages for
 * forgot-password and reset-password flows (SMS path and email path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishSms   = vi.fn();
const publishMail  = vi.fn();
const publishAudit = vi.fn();

const notifyUser = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({ publishSms, publishMail, publishAudit, notifyUser }));

const mockOtpCreate = vi.fn().mockResolvedValue({ code: '654321', expiresIn: 600 });
const mockOtpVerify = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: mockOtpCreate, verify: mockOtpVerify },
}));

const phoneUser = {
  id: 'user-phone',
  first_name: 'Bob',
  last_name: 'Test',
  phone_number: '+250780000002',
  email: null,
};
const emailUser = {
  id: 'user-email',
  first_name: 'Carol',
  last_name: 'Test',
  phone_number: '+250780000003',
  email: 'carol@example.com',
};

const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockTransaction = vi.fn().mockImplementation(
  async (ops: unknown[]) => Promise.all((ops as Promise<unknown>[]))
);

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { findFirst: mockFindFirst, findUnique: mockFindUnique, update: mockUpdate },
    refreshToken: { updateMany: mockUpdateMany },
    $transaction: mockTransaction,
  },
}));

const { PasswordService } = await import('../../src/services/password.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockOtpCreate.mockResolvedValue({ code: '654321', expiresIn: 600 });
  mockOtpVerify.mockResolvedValue(undefined);
});

// ── forgotPassword — SMS path ─────────────────────────────────────────────────

describe('PasswordService.forgotPassword — phone identifier', () => {
  beforeEach(() => mockFindFirst.mockResolvedValue(phoneUser));

  it('publishes otp.sms with purpose password_reset', async () => {
    await PasswordService.forgotPassword('+250780000002');
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'otp.sms',
        purpose: 'password_reset',
        phone_number: '+250780000002',
        code: '654321',
        expires_in_seconds: 600,
      }),
    );
  });

  it('does NOT publish mail', async () => {
    await PasswordService.forgotPassword('+250780000002');
    expect(publishMail).not.toHaveBeenCalled();
  });

  it('does NOT publish audit (silent flow)', async () => {
    await PasswordService.forgotPassword('+250780000002');
    expect(publishAudit).not.toHaveBeenCalled();
  });

  it('creates OTP with password_reset purpose', async () => {
    await PasswordService.forgotPassword('+250780000002');
    expect(mockOtpCreate).toHaveBeenCalledWith('user-phone', 'password_reset');
  });
});

// ── forgotPassword — email path ───────────────────────────────────────────────

describe('PasswordService.forgotPassword — email identifier', () => {
  beforeEach(() => mockFindFirst.mockResolvedValue(emailUser));

  it('publishes otp.mail with purpose password_reset', async () => {
    await PasswordService.forgotPassword('carol@example.com');
    expect(publishMail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'otp.mail',
        purpose: 'password_reset',
        email: 'carol@example.com',
        first_name: 'Carol',
        code: '654321',
        expires_in_seconds: 600,
      }),
    );
  });

  it('does NOT publish SMS', async () => {
    await PasswordService.forgotPassword('carol@example.com');
    expect(publishSms).not.toHaveBeenCalled();
  });

  it('does NOT publish audit (silent flow)', async () => {
    await PasswordService.forgotPassword('carol@example.com');
    expect(publishAudit).not.toHaveBeenCalled();
  });

  it('creates OTP with password_reset purpose', async () => {
    await PasswordService.forgotPassword('carol@example.com');
    expect(mockOtpCreate).toHaveBeenCalledWith('user-email', 'password_reset');
  });
});

// ── forgotPassword — unknown identifier ──────────────────────────────────────

describe('PasswordService.forgotPassword — unknown identifier', () => {
  beforeEach(() => mockFindFirst.mockResolvedValue(null));

  it('is silent — no publish calls', async () => {
    await PasswordService.forgotPassword('+250780000099');
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
    expect(publishAudit).not.toHaveBeenCalled();
  });
});

// ── resetPassword ─────────────────────────────────────────────────────────────

describe('PasswordService.resetPassword', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(phoneUser);
    mockUpdate.mockResolvedValue(phoneUser);
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('publishes audit password_reset event', async () => {
    await PasswordService.resetPassword('+250780000002', '654321', 'NewPass123!');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'password_reset', resource: 'User', resource_id: 'user-phone' }),
    );
  });

  it('does NOT publish SMS or mail', async () => {
    await PasswordService.resetPassword('+250780000002', '654321', 'NewPass123!');
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
  });

  it('verifies OTP with password_reset purpose', async () => {
    await PasswordService.resetPassword('+250780000002', '654321', 'NewPass123!');
    expect(mockOtpVerify).toHaveBeenCalledWith('user-phone', '654321', 'password_reset');
  });
});
