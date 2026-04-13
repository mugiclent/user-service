import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { OtpService, type OtpPurpose } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { publishAudit, publishSms, publishMail, notifyUser } from '../utils/publishers.js';
import type { Locale } from '../utils/publishers.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';
import { normalizePhone, displayPhone } from '../utils/phone.js';
import { DELETION_GRACE_DAYS } from '../utils/constants.js';

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
  | { requires_2fa: false; requires_verification: false; user: UserWithRoles; tokens: AuthTokens }
  | { requires_2fa: true;  requires_verification: false; user_id: string; expires_in: number }
  | { requires_2fa: false; requires_verification: true;  user_id: string; channel: 'phone' | 'email'; expires_in: number };

export const AuthService = {
  /**
   * Login with phone/email + password.
   *
   * If account is pending_verification (login_channel is null):
   *   → sends OTP to the entered channel, returns { requires_verification: true, user_id, channel, expires_in }
   *   → client must call POST /auth/verify-login to complete login
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

    // Account permanently anonymized — PII is gone, credentials won't match anyway
    if (user.status === 'deleted') throw new AppError('INVALID_CREDENTIALS', 401);

    // Account pending deletion — restore if still within grace period, otherwise reject
    if (user.status === 'pending_deletion' || user.deleted_at) {
      const graceCutoff = new Date(user.deleted_at!.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
      if (new Date() > graceCutoff) throw new AppError('ACCOUNT_DELETED', 403);

      // Within grace period — restore the account and continue login normally
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'active', deleted_at: null },
      });
      user.status = 'active';
      user.deleted_at = null;
    }

    // Account not yet verified by any channel — send OTP to the entered channel
    if (user.status === 'pending_verification') {
      const channel = isEmail(identifier) ? 'email' : 'phone';
      if (channel === 'email' && !user.email) {
        throw new AppError('EMAIL_NOT_FOUND', 422);
      }
      const purpose = channel === 'email' ? 'email_verification' : 'phone_verification';
      const { code, expiresIn } = await OtpService.create(user.id, purpose);
      const locale = user.locale as Locale;
      if (channel === 'email') {
        publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email!, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
      } else {
        publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
      }
      return { requires_2fa: false, requires_verification: true, user_id: user.id, channel, expires_in: expiresIn };
    }

    // Enforce login_channel — only the verified channel may be used
    if (user.login_channel === 'email' && !isEmail(identifier)) {
      throw new AppError('EMAIL_LOGIN_REQUIRED', 403);
    }
    if (user.login_channel === 'phone' && isEmail(identifier)) {
      throw new AppError('PHONE_LOGIN_REQUIRED', 403);
    }

    // 2FA: send OTP via the user's login_channel, defer token issuance to verify-2fa step
    if (user.two_factor_enabled) {
      const { code, expiresIn } = await OtpService.create(user.id, '2fa');
      if (user.login_channel === 'email' && user.email) {
        publishMail({ type: 'otp.mail', purpose: '2fa', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale: user.locale as Locale });
      } else {
        publishSms({ type: 'otp.sms', purpose: '2fa', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale: user.locale as Locale });
      }
      return { requires_2fa: true, requires_verification: false, user_id: user.id, expires_in: expiresIn };
    }

    prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } })
      .catch((err) => console.error('[auth] Failed to update last_login_at', err));

    publishAudit({ actor_id: user.id, action: 'login', resource: 'User', resource_id: user.id, ip });

    // Detect login from a new device
    if (user_agent) {
      prisma.refreshToken.findFirst({
        where: { user_id: user.id, revoked_at: null, expires_at: { gt: new Date() } },
      }).then((anyToken) => {
        if (!anyToken) return;
        return prisma.refreshToken.findFirst({
          where: { user_id: user.id, user_agent, revoked_at: null, expires_at: { gt: new Date() } },
        }).then((sameDevice) => {
          if (!sameDevice) {
            notifyUser(user, {
              sms: user.phone_number ? { type: 'security.login_new_device', phone_number: user.phone_number, first_name: user.first_name, device: device_name } : undefined,
              mail: user.email ? { type: 'security.login_new_device', email: user.email, first_name: user.first_name, device: device_name } : undefined,
              push: { type: 'security.login_new_device', data: device_name ? { device: device_name } : undefined },
            });
          }
        });
      }).catch((err) => console.error('[auth] Failed to check new device', err));
    }

    const tokens = await TokenService.issueTokenPair(user, device_name, ip, user_agent);
    return { requires_2fa: false, requires_verification: false, user, tokens };
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
   * Creates separate OTP records for phone (always) and email (if provided).
   * Welcome message is deferred until verify-phone or verify-login succeeds.
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

    const locale = (data.locale as Locale | undefined) ?? 'rw';

    // Phone OTP — always
    const { code: phoneCode, expiresIn } = await OtpService.create(user.id, 'phone_verification');
    publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number!, code: phoneCode, expires_in_seconds: expiresIn, locale });

    // Email OTP — only when email provided (separate code)
    if (data.email) {
      const { code: emailCode } = await OtpService.create(user.id, 'email_verification');
      publishMail({ type: 'otp.mail', purpose: 'email_verification', email: data.email, first_name: user.first_name, code: emailCode, expires_in_seconds: expiresIn, locale });
    }

    publishAudit({ actor_id: user.id, action: 'register', resource: 'User', resource_id: user.id });

    return { user_id: user.id, expires_in: expiresIn };
  },

  /**
   * Verify phone number OTP (standalone — not part of a login flow).
   * On first verification: activates the account, sets login_channel to 'phone', sends welcome.
   * On subsequent verification (account already active): only stamps phone_verified_at.
   * Does NOT issue tokens — user is directed to log in.
   */
  async verifyPhone(user_id: string, otp: string): Promise<{ login_identifier: string }> {
    await OtpService.verify(user_id, otp, 'phone_verification');

    const user = await prisma.user.findUnique({ where: { id: user_id } });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);

    const isFirst = user.status === 'pending_verification';

    const updated = await prisma.user.update({
      where: { id: user_id },
      data: {
        phone_verified_at: new Date(),
        ...(isFirst ? { status: 'active', login_channel: 'phone' } : {}),
      },
      ...withRoles,
    });

    if (isFirst) {
      notifyUser(updated, {
        sms: updated.phone_number ? { type: 'welcome.sms', phone_number: updated.phone_number, first_name: updated.first_name } : undefined,
        mail: updated.email ? { type: 'welcome.mail', email: updated.email, first_name: updated.first_name } : undefined,
      });
    }

    publishAudit({ actor_id: user_id, action: 'verify_phone', resource: 'User', resource_id: user_id });

    return { login_identifier: displayPhone(updated.phone_number!) };
  },

  /**
   * Verify email address OTP (standalone — not part of a login flow).
   * On first verification: activates the account, sets login_channel to 'email', sends welcome.
   * On subsequent verification (account already active): only stamps email_verified_at.
   * Does NOT issue tokens — user is directed to log in.
   */
  async verifyEmail(user_id: string, otp: string): Promise<{ login_identifier: string }> {
    const user = await prisma.user.findUnique({ where: { id: user_id } });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);
    if (!user.email) throw new AppError('EMAIL_NOT_FOUND', 422);
    if (user.email_verified_at) throw new AppError('EMAIL_ALREADY_VERIFIED', 409);

    await OtpService.verify(user_id, otp, 'email_verification');

    const isFirst = user.status === 'pending_verification';

    const updated = await prisma.user.update({
      where: { id: user_id },
      data: {
        email_verified_at: new Date(),
        ...(isFirst ? { status: 'active', login_channel: 'email' } : {}),
      },
      ...withRoles,
    });

    if (isFirst) {
      notifyUser(updated, {
        sms: updated.phone_number ? { type: 'welcome.sms', phone_number: updated.phone_number, first_name: updated.first_name } : undefined,
        mail: updated.email ? { type: 'welcome.mail', email: updated.email, first_name: updated.first_name } : undefined,
      });
    }

    publishAudit({ actor_id: user_id, action: 'verify_email', resource: 'User', resource_id: user_id });

    return { login_identifier: updated.email! };
  },

  /**
   * Verify OTP during a login-triggered verification flow (pending_verification account).
   * Activates the account, sets login_channel, stamps _verified_at, sends welcome, issues tokens.
   * This is the ONLY verify path that returns tokens.
   */
  async verifyLogin(
    user_id: string,
    otp: string,
    channel: 'phone' | 'email',
    device_name?: string,
    ip?: string,
    user_agent?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    const user = await prisma.user.findUnique({ where: { id: user_id } });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);
    if (user.status !== 'pending_verification') {
      throw new AppError('INVALID_STATUS', 409);
    }

    const purpose = channel === 'email' ? 'email_verification' : 'phone_verification';
    await OtpService.verify(user_id, otp, purpose);

    const updated = await prisma.user.update({
      where: { id: user_id },
      data: {
        status: 'active',
        login_channel: channel,
        last_login_at: new Date(),
        ...(channel === 'phone'
          ? { phone_verified_at: new Date() }
          : { email_verified_at: new Date() }),
      },
      ...withRoles,
    });

    notifyUser(updated, {
      sms: updated.phone_number ? { type: 'welcome.sms', phone_number: updated.phone_number, first_name: updated.first_name } : undefined,
      mail: updated.email ? { type: 'welcome.mail', email: updated.email, first_name: updated.first_name } : undefined,
    });

    publishAudit({ actor_id: user_id, action: 'verify_login', resource: 'User', resource_id: user_id, ip });

    const tokens = await TokenService.issueTokenPair(updated, device_name, ip, user_agent);
    return { user: updated, tokens };
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
   * Central resend-OTP handler. Supports all OTP purposes.
   *
   * phone_verification / email_verification: registration flow, user must be pending_verification.
   * 2fa:                  mid-login flow, user must have 2FA enabled, sent via login_channel.
   * password_reset:       mid-reset flow, channel determines delivery (phone or email).
   * login_channel_change: mid-channel-switch flow, channel is the target channel.
   *
   * For flow-gated purposes (2fa, password_reset, login_channel_change) resend is only allowed
   * when an unused OTP already exists — this includes expired-but-unused OTPs, so users who
   * missed the window can still get a new code without restarting the whole flow.
   */
  async resendOtp(
    user_id: string,
    purpose: OtpPurpose,
    channel: 'phone' | 'email' = 'phone',
  ): Promise<{ expires_in: number }> {
    const user = await prisma.user.findUnique({ where: { id: user_id } });
    if (!user || user.deleted_at) throw new AppError('USER_NOT_FOUND', 404);

    const locale = user.locale as Locale;

    // For purposes tied to an initiated flow, require an existing unused OTP as proof.
    // used_at: null covers both still-valid and expired-but-not-yet-used OTPs.
    const flowGated: OtpPurpose[] = ['2fa', 'password_reset', 'login_channel_change'];
    if (flowGated.includes(purpose)) {
      const existing = await prisma.otp.findFirst({ where: { user_id: user.id, purpose, used_at: null } });
      if (!existing) throw new AppError('OTP_FLOW_NOT_INITIATED', 400);
    }

    switch (purpose) {
      case 'phone_verification': {
        if (user.status !== 'pending_verification') throw new AppError('ALREADY_VERIFIED', 409);
        if (user.phone_verified_at) throw new AppError('CHANNEL_ALREADY_VERIFIED', 409);
        const { code, expiresIn } = await OtpService.create(user.id, purpose);
        publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
        return { expires_in: expiresIn };
      }

      case 'email_verification': {
        if (user.status !== 'pending_verification') throw new AppError('ALREADY_VERIFIED', 409);
        if (!user.email) throw new AppError('EMAIL_NOT_FOUND', 422);
        if (user.email_verified_at) throw new AppError('CHANNEL_ALREADY_VERIFIED', 409);
        const { code, expiresIn } = await OtpService.create(user.id, purpose);
        publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
        return { expires_in: expiresIn };
      }

      case '2fa': {
        if (!user.two_factor_enabled) throw new AppError('TWO_FACTOR_NOT_ENABLED', 409);
        const { code, expiresIn } = await OtpService.create(user.id, purpose);
        if (user.login_channel === 'email' && user.email) {
          publishMail({ type: 'otp.mail', purpose: '2fa', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
        } else {
          publishSms({ type: 'otp.sms', purpose: '2fa', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
        }
        return { expires_in: expiresIn };
      }

      case 'password_reset': {
        const { code, expiresIn } = await OtpService.create(user.id, purpose);
        if (channel === 'email') {
          if (!user.email) throw new AppError('EMAIL_NOT_FOUND', 422);
          publishMail({ type: 'otp.mail', purpose: 'password_reset', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
        } else {
          publishSms({ type: 'otp.sms', purpose: 'password_reset', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
        }
        return { expires_in: expiresIn };
      }

      case 'login_channel_change': {
        if (user.login_channel === channel) throw new AppError('ALREADY_ACTIVE_CHANNEL', 409);
        if (channel === 'phone' && user.phone_verified_at) throw new AppError('CHANNEL_ALREADY_VERIFIED', 409);
        if (channel === 'email') {
          if (!user.email) throw new AppError('EMAIL_NOT_FOUND', 422);
          if (user.email_verified_at) throw new AppError('CHANNEL_ALREADY_VERIFIED', 409);
          const { code, expiresIn } = await OtpService.create(user.id, purpose);
          publishMail({ type: 'otp.mail', purpose: 'email_verification', email: user.email, first_name: user.first_name, code, expires_in_seconds: expiresIn, locale });
          return { expires_in: expiresIn };
        }
        const { code, expiresIn } = await OtpService.create(user.id, purpose);
        publishSms({ type: 'otp.sms', purpose: 'phone_verification', phone_number: user.phone_number!, code, expires_in_seconds: expiresIn, locale });
        return { expires_in: expiresIn };
      }
    }
  },
};
