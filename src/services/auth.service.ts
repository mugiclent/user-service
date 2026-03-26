import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { publishAudit, publishSms } from '../utils/publishers.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';

const withRoles = {
  include: { user_roles: { include: { role: true } } },
} as const;

const isEmail = (identifier: string): boolean => identifier.includes('@');

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type LoginResult =
  | { requires_2fa: false; user: UserWithRoles; tokens: AuthTokens }
  | { requires_2fa: true;  user_id: string; expires_in: number };

export const AuthService = {
  /**
   * Login with phone/email + password.
   *
   * If two_factor_enabled:
   *   → creates OTP, publishes SMS, returns { requires_2fa: true, user_id, expires_in }
   *   → client must call POST /auth/verify-2fa to complete login
   *
   * Otherwise:
   *   → issues token pair immediately
   */
  async login(
    identifier: string,
    password: string,
    device_name?: string,
    ip?: string,
  ): Promise<LoginResult> {
    const user = await prisma.user.findFirst({
      where: isEmail(identifier)
        ? { email: identifier }
        : { phone_number: identifier },
      ...withRoles,
    });

    if (!user || !user.password_hash) {
      throw new AppError('INVALID_CREDENTIALS', 401);
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) throw new AppError('INVALID_CREDENTIALS', 401);

    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403);
    if (user.status === 'pending_verification') throw new AppError('PHONE_NOT_VERIFIED', 403);

    // 2FA: send OTP, defer token issuance to verify-2fa step
    if (user.two_factor_enabled) {
      const { code, expiresIn } = await OtpService.create(user.id, '2fa');
      publishSms({ type: 'otp.sms', purpose: '2fa', phone_number: user.phone_number, code, expires_in_seconds: expiresIn });
      return { requires_2fa: true, user_id: user.id, expires_in: expiresIn };
    }

    prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } })
      .catch((err) => console.error('[auth] Failed to update last_login_at', err));

    publishAudit({ actor_id: user.id, action: 'login', resource: 'User', resource_id: user.id, ip });

    const tokens = await TokenService.issueTokenPair(user, device_name);
    return { requires_2fa: false, user, tokens };
  },

  /**
   * Complete a 2FA login by verifying the OTP sent after password check.
   * Issues the full token pair on success.
   */
  async verify2fa(
    user_id: string,
    otp: string,
    device_name?: string,
    ip?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    await OtpService.verify(user_id, otp, '2fa');

    const user = await prisma.user.findUnique({
      where: { id: user_id },
      ...withRoles,
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } })
      .catch((err) => console.error('[auth] Failed to update last_login_at', err));

    publishAudit({ actor_id: user.id, action: 'login_2fa', resource: 'User', resource_id: user.id, ip });

    const tokens = await TokenService.issueTokenPair(user, device_name);
    return { user, tokens };
  },

  /**
   * Register a new passenger account.
   * Passengers have phone only — no email accepted.
   * Sends welcome SMS + OTP for phone verification.
   */
  async register(data: {
    first_name: string;
    last_name: string;
    phone_number: string;
    password: string;
  }): Promise<{ user_id: string; expires_in: number }> {
    const existing = await prisma.user.findUnique({
      where: { phone_number: data.phone_number },
    });
    if (existing) throw new AppError('PHONE_ALREADY_EXISTS', 409);

    const password_hash = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        first_name: data.first_name,
        last_name: data.last_name,
        phone_number: data.phone_number,
        password_hash,
        user_type: 'passenger',
        status: 'pending_verification',
      },
    });

    const { code, expiresIn } = await OtpService.create(user.id, 'phone_verification');

    publishSms({ type: 'welcome.sms', phone_number: user.phone_number, first_name: user.first_name });
    publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number, code, expires_in_seconds: expiresIn });
    publishAudit({ actor_id: user.id, action: 'register', resource: 'User', resource_id: user.id });

    return { user_id: user.id, expires_in: expiresIn };
  },

  /**
   * Verify phone number with OTP.
   * Activates the account and issues the first token pair.
   */
  async verifyPhone(
    user_id: string,
    otp: string,
    device_name?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    await OtpService.verify(user_id, otp, 'phone_verification');

    const user = await prisma.user.update({
      where: { id: user_id },
      data: { status: 'active', phone_verified_at: new Date() },
      ...withRoles,
    });

    publishAudit({ actor_id: user.id, action: 'verify_phone', resource: 'User', resource_id: user.id });

    const tokens = await TokenService.issueTokenPair(user, device_name);
    return { user, tokens };
  },

  /** Initiate password recovery. Always silent — no enumeration. */
  async forgotPassword(identifier: string): Promise<void> {
    return PasswordService.forgotPassword(identifier);
  },

  /** Complete password reset using the 6-digit OTP. */
  async resetPassword(identifier: string, otp: string, newPassword: string): Promise<void> {
    return PasswordService.resetPassword(identifier, otp, newPassword);
  },

  /** Rotate refresh token. Reuse detection wipes all sessions. */
  async refresh(rawToken: string): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    return TokenService.rotateRefreshToken(rawToken);
  },

  /** Revoke one refresh token. Idempotent. */
  async logout(rawRefreshToken: string): Promise<void> {
    await TokenService.revokeByRawToken(rawRefreshToken);
  },

  /** Revoke all sessions for user. */
  async logoutAll(userId: string): Promise<void> {
    await TokenService.revokeAllForUser(userId);
  },
};
