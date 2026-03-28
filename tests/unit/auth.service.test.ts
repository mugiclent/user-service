/**
 * Tests for src/services/auth.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────

const mockUserFindFirst = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn().mockResolvedValue({});
const mockRefreshTokenFindFirst = vi.fn().mockResolvedValue(null);

const mockTxUserCreate = vi.fn();
const mockTxRoleFindFirst = vi.fn();
const mockTxUserRoleCreate = vi.fn().mockResolvedValue({});
const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    user: { create: mockTxUserCreate },
    role: { findFirst: mockTxRoleFindFirst },
    userRole: { create: mockTxUserRoleCreate },
  };
  return cb(tx);
});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: { findFirst: mockUserFindFirst, findUnique: mockUserFindUnique, update: mockUserUpdate },
    refreshToken: { findFirst: mockRefreshTokenFindFirst },
    $transaction: mockTransaction,
  },
}));

const mockIssueTokenPair = vi.fn().mockResolvedValue({ access: 'access-tok', refresh: 'refresh-tok' });
const mockRotateRefreshToken = vi.fn();
const mockRevokeByRawToken = vi.fn().mockResolvedValue(undefined);
const mockRevokeAllForUser = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/token.service.js', () => ({
  TokenService: {
    issueTokenPair: mockIssueTokenPair,
    rotateRefreshToken: mockRotateRefreshToken,
    revokeByRawToken: mockRevokeByRawToken,
    revokeAllForUser: mockRevokeAllForUser,
  },
}));

const mockOtpCreate = vi.fn().mockResolvedValue({ code: '123456', expiresIn: 300 });
const mockOtpVerify = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: mockOtpCreate, verify: mockOtpVerify },
}));

const mockForgotPassword = vi.fn().mockResolvedValue(undefined);
const mockResetPassword = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/password.service.js', () => ({
  PasswordService: { forgotPassword: mockForgotPassword, resetPassword: mockResetPassword },
}));

const mockHashPassword = vi.fn().mockResolvedValue('hashed-password');
const mockVerifyPassword = vi.fn();

vi.mock('../../src/utils/crypto.js', () => ({
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}));

const mockPublishAudit = vi.fn();
const mockPublishSms = vi.fn();
const mockNotifyUser = vi.fn();

vi.mock('../../src/utils/publishers.js', () => ({
  publishAudit: mockPublishAudit,
  publishSms: mockPublishSms,
  notifyUser: mockNotifyUser,
}));

const { AuthService } = await import('../../src/services/auth.service.js');

// ── helpers ──────────────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Jane',
  last_name: 'Doe',
  phone_number: '+250788000001',
  email: null,
  password_hash: 'stored-hash',
  user_type: 'passenger',
  status: 'active',
  two_factor_enabled: false,
  deleted_at: null,
  org_id: null,
  user_roles: [],
  user_permissions: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue({});
  mockRefreshTokenFindFirst.mockResolvedValue(null);
  mockVerifyPassword.mockResolvedValue(true);
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  it('throws INVALID_CREDENTIALS when user not found', async () => {
    mockUserFindFirst.mockResolvedValueOnce(null);
    await expect(AuthService.login('u@e.com', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when no password_hash', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ password_hash: null }));
    await expect(AuthService.login('+250788000001', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws INVALID_CREDENTIALS when password is wrong', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    mockVerifyPassword.mockResolvedValueOnce(false);
    await expect(AuthService.login('+250788000001', 'bad')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', status: 401,
    });
  });

  it('throws ACCOUNT_SUSPENDED for suspended users', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ status: 'suspended' }));
    await expect(AuthService.login('+250788000001', 'pass')).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED', status: 403,
    });
  });

  it('throws PHONE_NOT_VERIFIED for pending_verification users', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ status: 'pending_verification' }));
    await expect(AuthService.login('+250788000001', 'pass')).rejects.toMatchObject({
      code: 'PHONE_NOT_VERIFIED', status: 403,
    });
  });

  it('returns requires_2fa: true when 2FA is enabled', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser({ two_factor_enabled: true }));
    const result = await AuthService.login('+250788000001', 'pass');
    expect(result).toMatchObject({ requires_2fa: true, user_id: 'user-1', expires_in: 300 });
    expect(mockOtpCreate).toHaveBeenCalledWith('user-1', '2fa');
    expect(mockPublishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'otp.sms', purpose: '2fa' }),
    );
  });

  it('returns requires_2fa: false with user and tokens on normal login', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    const result = await AuthService.login('+250788000001', 'pass');
    expect(result).toMatchObject({
      requires_2fa: false,
      user: expect.objectContaining({ id: 'user-1' }),
      tokens: { access: 'access-tok', refresh: 'refresh-tok' },
    });
    expect(mockIssueTokenPair).toHaveBeenCalled();
  });

  it('looks up by email when identifier contains @', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await AuthService.login('user@example.com', 'pass');
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'user@example.com' } }),
    );
  });

  it('looks up by phone when identifier has no @', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await AuthService.login('+250788000001', 'pass');
    expect(mockUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone_number: '+250788000001' } }),
    );
  });

  it('publishes an audit event on successful login', async () => {
    mockUserFindFirst.mockResolvedValueOnce(makeUser());
    await AuthService.login('+250788000001', 'pass', undefined, '1.2.3.4');
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', resource: 'User', resource_id: 'user-1' }),
    );
  });
});

// ── verify2fa ─────────────────────────────────────────────────────────────────

describe('AuthService.verify2fa', () => {
  it('delegates OTP check to OtpService.verify', async () => {
    mockOtpVerify.mockRejectedValueOnce({ code: 'INVALID_OTP', status: 400 });
    await expect(AuthService.verify2fa('user-1', 'bad', '2fa')).rejects.toMatchObject({
      code: 'INVALID_OTP',
    });
  });

  it('throws USER_NOT_FOUND when user does not exist after OTP check', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    await expect(AuthService.verify2fa('ghost-id', '123456')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });

  it('returns user and tokens on success', async () => {
    const user = makeUser();
    mockUserFindUnique.mockResolvedValueOnce(user);
    const result = await AuthService.verify2fa('user-1', '123456');
    expect(result).toMatchObject({
      user,
      tokens: { access: 'access-tok', refresh: 'refresh-tok' },
    });
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login_2fa' }),
    );
  });
});

// ── register ──────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  const regData = { first_name: 'Jane', last_name: 'Doe', phone_number: '+250788000001', password: 'pass1234' };

  it('throws PHONE_ALREADY_EXISTS when phone is taken', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'existing' });
    await expect(AuthService.register(regData)).rejects.toMatchObject({
      code: 'PHONE_ALREADY_EXISTS', status: 409,
    });
  });

  it('creates user in a transaction and assigns passenger role', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000001', first_name: 'Jane' });
    mockTxRoleFindFirst.mockResolvedValueOnce({ id: 'role-passenger' });
    const result = await AuthService.register(regData);
    expect(mockTxUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_type: 'passenger',
          status: 'pending_verification',
          password_hash: 'hashed-password',
        }),
      }),
    );
    expect(mockTxUserRoleCreate).toHaveBeenCalledWith({
      data: { user_id: 'new-user', role_id: 'role-passenger' },
    });
    expect(result).toMatchObject({ user_id: 'new-user', expires_in: 300 });
  });

  it('skips role assignment when passenger role not found', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000001', first_name: 'Jane' });
    mockTxRoleFindFirst.mockResolvedValueOnce(null);
    await AuthService.register(regData);
    expect(mockTxUserRoleCreate).not.toHaveBeenCalled();
  });

  it('sends welcome SMS and OTP SMS', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000001', first_name: 'Jane' });
    mockTxRoleFindFirst.mockResolvedValueOnce(null);
    await AuthService.register(regData);
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'welcome.sms' }));
    expect(mockPublishSms).toHaveBeenCalledWith(expect.objectContaining({ type: 'otp.sms', purpose: 'phone_verification' }));
  });

  it('publishes an audit event', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockTxUserCreate.mockResolvedValueOnce({ id: 'new-user', phone_number: '+250788000001', first_name: 'Jane' });
    mockTxRoleFindFirst.mockResolvedValueOnce(null);
    await AuthService.register(regData);
    expect(mockPublishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'register', resource: 'User' }),
    );
  });
});

// ── verifyPhone ───────────────────────────────────────────────────────────────

describe('AuthService.verifyPhone', () => {
  it('updates user status to active and returns tokens', async () => {
    const user = makeUser({ status: 'active' });
    mockUserUpdate.mockResolvedValueOnce(user);
    const result = await AuthService.verifyPhone('user-1', '123456');
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'active', phone_verified_at: expect.any(Date) }),
      }),
    );
    expect(result).toMatchObject({ user, tokens: { access: 'access-tok', refresh: 'refresh-tok' } });
    expect(mockPublishAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'verify_phone' }));
  });
});

// ── delegation ────────────────────────────────────────────────────────────────

describe('AuthService.forgotPassword', () => {
  it('delegates to PasswordService.forgotPassword', async () => {
    await AuthService.forgotPassword('user@example.com');
    expect(mockForgotPassword).toHaveBeenCalledWith('user@example.com');
  });
});

describe('AuthService.resetPassword', () => {
  it('delegates to PasswordService.resetPassword', async () => {
    await AuthService.resetPassword('user@example.com', '123456', 'NewPass1!');
    expect(mockResetPassword).toHaveBeenCalledWith('user@example.com', '123456', 'NewPass1!');
  });
});

describe('AuthService.refresh', () => {
  it('delegates to TokenService.rotateRefreshToken', async () => {
    const result = { user: makeUser(), tokens: { access: 'a', refresh: 'r' } };
    mockRotateRefreshToken.mockResolvedValueOnce(result);
    const out = await AuthService.refresh('raw-token');
    expect(mockRotateRefreshToken).toHaveBeenCalledWith('raw-token');
    expect(out).toBe(result);
  });
});

describe('AuthService.logout', () => {
  it('delegates to TokenService.revokeByRawToken', async () => {
    await AuthService.logout('raw-token');
    expect(mockRevokeByRawToken).toHaveBeenCalledWith('raw-token');
  });
});

describe('AuthService.logoutAll', () => {
  it('delegates to TokenService.revokeAllForUser', async () => {
    await AuthService.logoutAll('user-1');
    expect(mockRevokeAllForUser).toHaveBeenCalledWith('user-1');
  });
});
