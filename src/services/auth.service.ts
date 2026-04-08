import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { publishAudit, publishSms, publishMail, notifyUser } from '../utils/publishers.js';
import type { Locale } from '../utils/publishers.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';
import { normalizePhone } from '../utils/phone.js';

const withRoles = {
  include: {
    user_roles: { include: { role: { include: { role_grants: true } } } },
    user_grants: true,
  },
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
    user_agent?: string,
  ): Promise<LoginResult> {
    let phoneQuery = identifier;
    if (!isEmail(identifier)) {
      try { phoneQuery = normalizePhone(identifier); } catch { /* invalid format — will not match */ }
    }

    const user = await prisma.user.findFirst({
      where: isEmail(identifier)
        ? { email: identifier }
        : { phone_number: phoneQuery },
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
      publishSms({ type: 'otp.sms', purpose: '2fa', phone_number: user.phone_number, code, expires_in_seconds: expiresIn, locale: user.locale as Locale });
      return { requires_2fa: true, user_id: user.id, expires_in: expiresIn };
    }

    prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } })
      .catch((err) => console.error('[auth] Failed to update last_login_at', err));

    publishAudit({ actor_id: user.id, action: 'login', resource: 'User', resource_id: user.id, ip });

    // Detect login from a new device: user has existing tokens but none match this user-agent
    if (user_agent) {
      prisma.refreshToken.findFirst({
        where: { user_id: user.id, revoked_at: null, expires_at: { gt: new Date() } },
      }).then((anyToken) => {
        if (!anyToken) return; // first ever login — no alert needed
        return prisma.refreshToken.findFirst({
          where: { user_id: user.id, user_agent, revoked_at: null, expires_at: { gt: new Date() } },
        }).then((sameDevice) => {
          if (!sameDevice) {
            notifyUser(user, {
              sms: { type: 'security.login_new_device', phone_number: user.phone_number, first_name: user.first_name, device: device_name },
              mail: user.email ? { type: 'security.login_new_device', email: user.email, first_name: user.first_name, device: device_name } : undefined,
              push: { type: 'security.login_new_device', data: device_name ? { device: device_name } : undefined },
            });
          }
        });
      }).catch((err) => console.error('[auth] Failed to check new device', err));
    }

    const tokens = await TokenService.issueTokenPair(user, device_name, ip, user_agent);
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
    user_agent?: string,
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

    const tokens = await TokenService.issueTokenPair(user, device_name, ip, user_agent);
    return { user, tokens };
  },

  /**
   * Register a new passenger account.
   * Sends a 6-digit OTP to phone_number (always) and to email if provided.
   * Welcome message is deferred until POST /auth/verify-phone succeeds.
   */
  async register(data: {
    first_name: string;
    last_name: string;
    phone_number: string;
    email?: string;
    locale?: string;
    password: string;
  }): Promise<{ user_id: string; expires_in: number }> {
    const [existingPhone, existingEmail] = await Promise.all([
      prisma.user.findUnique({ where: { phone_number: data.phone_number } }),
      data.email ? prisma.user.findUnique({ where: { email: data.email } }) : null,
    ]);
    if (existingPhone) throw new AppError('PHONE_ALREADY_EXISTS', 409);
    if (existingEmail) throw new AppError('EMAIL_ALREADY_EXISTS', 409);

    const password_hash = await hashPassword(data.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          phone_number: data.phone_number,
          ...(data.email ? { email: data.email } : {}),
          notif_channel: data.email ? ['sms', 'email'] : ['sms'],
          locale: data.locale ?? 'rw',
          password_hash,
          user_type: 'passenger',
          status: 'pending_verification',
        },
      });
      const passengerRole = await tx.role.findFirst({ where: { slug: 'passenger', org_id: null } });
      if (passengerRole) {
        await tx.userRole.create({ data: { user_id: created.id, role_id: passengerRole.id } });
      }
      return created;
    });

    const { code, expiresIn } = await OtpService.create(user.id, 'phone_verification');

    const locale = (data.locale as 'rw' | 'en' | 'fr' | undefined) ?? 'rw';
    publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number, code, expires_in_seconds: expiresIn, locale });
    if (data.email) {
      publishMail({ type: 'otp.mail', purpose: 'email_verification', email: data.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
    }
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
    ip?: string,
    user_agent?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    await OtpService.verify(user_id, otp, 'phone_verification');

    const user = await prisma.user.update({
      where: { id: user_id },
      data: { status: 'active', phone_verified_at: new Date() },
      ...withRoles,
    });

    publishAudit({ actor_id: user.id, action: 'verify_phone', resource: 'User', resource_id: user.id });

    notifyUser(user, {
      sms: { type: 'welcome.sms', phone_number: user.phone_number, first_name: user.first_name },
      mail: user.email ? { type: 'welcome.mail', email: user.email, first_name: user.first_name } : undefined,
    });

    const tokens = await TokenService.issueTokenPair(user, device_name, ip, user_agent);
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

  /**
   * Resend a phone verification OTP to a user still in pending_verification status.
   * Idempotent — OtpService.create deletes any previous OTP for the same purpose.
   */
  async resendOtp(user_id: string): Promise<{ expires_in: number }> {
    const user = await prisma.user.findUnique({ where: { id: user_id } });

    if (!user || user.deleted_at) throw new AppError('USER_NOT_FOUND', 404);
    if (user.status !== 'pending_verification') throw new AppError('ALREADY_VERIFIED', 409);

    const { code, expiresIn } = await OtpService.create(user.id, 'phone_verification');

    const locale = user.locale as Locale;
    publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number, code, expires_in_seconds: expiresIn, locale });
    if (user.email) {
      publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
    }

    return { expires_in: expiresIn };
  },
};
