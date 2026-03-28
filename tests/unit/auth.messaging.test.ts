/**
 * Verifies that AuthService publishes the correct messages to the correct
 * queues for every flow that involves a notification or audit event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword } from '../../src/utils/crypto.js';

// ── mocks ─────────────────────────────────────────────────────────────────────

const publishSms  = vi.fn();
const publishMail = vi.fn();
const publishAudit = vi.fn();

const notifyUser = vi.fn();
vi.mock('../../src/utils/publishers.js', () => ({ publishSms, publishMail, publishAudit, notifyUser }));

const mockOtpCreate = vi.fn().mockResolvedValue({ code: '123456', expiresIn: 600 });
const mockOtpVerify = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/otp.service.js', () => ({
  OtpService: { create: mockOtpCreate, verify: mockOtpVerify },
}));

const mockIssueTokenPair = vi.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
vi.mock('../../src/services/token.service.js', () => ({
  TokenService: { issueTokenPair: mockIssueTokenPair },
}));

// Minimal user fixtures
const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  first_name: 'Alice',
  last_name: 'Test',
  phone_number: '+250780000001',
  email: null,
  password_hash: null as string | null,
  user_type: 'passenger',
  status: 'active',
  two_factor_enabled: false,
  org_id: null,
  avatar_path: null,
  phone_verified_at: null,
  email_verified_at: null,
  driver_license_number: null,
  driver_license_verified_at: null,
  last_login_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  user_roles: [],
  rules: [],
  ...overrides,
});

const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

const mockRoleFindFirst = vi.fn().mockResolvedValue(null);
const mockUserRoleCreate = vi.fn().mockResolvedValue({});

vi.mock('../../src/models/index.js', () => ({
  prisma: {
    user: {
      findFirst:  mockFindFirst,
      findUnique: mockFindUnique,
      create:     mockCreate,
      update:     mockUpdate,
    },
    role: {
      findFirst: mockRoleFindFirst,
    },
    userRole: {
      create: mockUserRoleCreate,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { create: mockCreate },
        role: { findFirst: mockRoleFindFirst },
        userRole: { create: mockUserRoleCreate },
      };
      return fn(tx);
    }),
  },
}));

// ── import service AFTER mocks ────────────────────────────────────────────────
const { AuthService } = await import('../../src/services/auth.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockOtpCreate.mockResolvedValue({ code: '123456', expiresIn: 600 });
  mockOtpVerify.mockResolvedValue(undefined);
  mockIssueTokenPair.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
});

// ── register ──────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  const registerData = {
    first_name: 'Alice',
    last_name: 'Test',
    phone_number: '+250780000001',
    password: 'password123',
  };

  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null);        // no existing user
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      makeUser({ ...data, id: 'user-new' }),
    );
  });

  it('publishes welcome.sms to notifications/sms.notifications', async () => {
    await AuthService.register(registerData);
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'welcome.sms', phone_number: '+250780000001' }),
    );
  });

  it('publishes otp.sms with purpose phone_verification', async () => {
    await AuthService.register(registerData);
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'otp.sms',
        purpose: 'phone_verification',
        phone_number: '+250780000001',
        code: '123456',
        expires_in_seconds: 600,
      }),
    );
  });

  it('publishes audit event with action register', async () => {
    await AuthService.register(registerData);
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'register', resource: 'User' }),
    );
  });

  it('publishes exactly 2 SMS messages and 1 audit event', async () => {
    await AuthService.register(registerData);
    expect(publishSms).toHaveBeenCalledTimes(2);
    expect(publishMail).not.toHaveBeenCalled();
    expect(publishAudit).toHaveBeenCalledTimes(1);
  });
});

// ── login (no 2FA) ────────────────────────────────────────────────────────────

describe('AuthService.login — 2FA disabled', () => {
  beforeEach(async () => {
    const hash = await hashPassword('password123');
    mockFindFirst.mockResolvedValue(
      makeUser({ password_hash: hash, status: 'active', two_factor_enabled: false }),
    );
    mockUpdate.mockResolvedValue(makeUser());
  });

  it('publishes audit login event', async () => {
    await AuthService.login('+250780000001', 'password123', undefined, '1.2.3.4');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login', resource: 'User', ip: '1.2.3.4' }),
    );
  });

  it('does NOT publish any SMS or mail', async () => {
    await AuthService.login('+250780000001', 'password123');
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
  });
});

// ── login (2FA enabled) ───────────────────────────────────────────────────────

describe('AuthService.login — 2FA enabled', () => {
  beforeEach(async () => {
    const hash = await hashPassword('password123');
    mockFindFirst.mockResolvedValue(
      makeUser({ password_hash: hash, status: 'active', two_factor_enabled: true }),
    );
  });

  it('publishes otp.sms with purpose 2fa', async () => {
    await AuthService.login('+250780000001', 'password123');
    expect(publishSms).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'otp.sms', purpose: '2fa', code: '123456' }),
    );
  });

  it('does NOT publish audit on the first step', async () => {
    await AuthService.login('+250780000001', 'password123');
    expect(publishAudit).not.toHaveBeenCalled();
  });

  it('does NOT publish mail', async () => {
    await AuthService.login('+250780000001', 'password123');
    expect(publishMail).not.toHaveBeenCalled();
  });
});

// ── verify2fa ─────────────────────────────────────────────────────────────────

describe('AuthService.verify2fa', () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue(makeUser());
    mockUpdate.mockResolvedValue(makeUser());
  });

  it('publishes audit login_2fa event', async () => {
    await AuthService.verify2fa('user-1', '123456', undefined, '5.6.7.8');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login_2fa', resource: 'User', ip: '5.6.7.8' }),
    );
  });

  it('does NOT publish any SMS or mail', async () => {
    await AuthService.verify2fa('user-1', '123456');
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
  });
});

// ── verifyPhone ───────────────────────────────────────────────────────────────

describe('AuthService.verifyPhone', () => {
  beforeEach(() => {
    mockUpdate.mockResolvedValue(makeUser({ status: 'active' }));
  });

  it('publishes audit verify_phone event', async () => {
    await AuthService.verifyPhone('user-1', '123456');
    expect(publishAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'verify_phone', resource: 'User' }),
    );
  });

  it('does NOT publish any SMS or mail', async () => {
    await AuthService.verifyPhone('user-1', '123456');
    expect(publishSms).not.toHaveBeenCalled();
    expect(publishMail).not.toHaveBeenCalled();
  });
});
