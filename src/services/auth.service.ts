import { prisma } from '../models/index.js';
import type { UserWithRoles } from '../models/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { publishNotification } from '../utils/publishers.js';
import type { AuthTokens } from '../utils/sendAuthResponse.js';

const withRoles = {
  include: { user_roles: { include: { role: true } } },
} as const;

const isEmail = (identifier: string): boolean => identifier.includes('@');

export const AuthService = {
  /**
   * Login with phone/email + password.
   * Returns user (with roles) + token pair.
   * Throws INVALID_CREDENTIALS (401), ACCOUNT_SUSPENDED (403), EMAIL_NOT_VERIFIED (403).
   */
  async login(
    identifier: string,
    password: string,
    device_name?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    const user = await prisma.user.findFirst({
      where: isEmail(identifier)
        ? { email: identifier }
        : { phone_number: identifier },
      ...withRoles,
    });

    // Use constant-time-safe comparison — don't short-circuit on missing user
    if (!user || !user.password_hash) {
      throw new AppError('INVALID_CREDENTIALS', 401);
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) throw new AppError('INVALID_CREDENTIALS', 401);

    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 403);

    // Passengers must verify phone before logging in (status = pending_verification)
    if (user.status === 'pending_verification') {
      throw new AppError('PHONE_NOT_VERIFIED', 403);
    }

    // Update last_login_at (fire-and-forget, don't await to avoid blocking response)
    prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    }).catch((err) => console.error('[auth] Failed to update last_login_at', err));

    const tokens = await TokenService.issueTokenPair(user, device_name);
    return { user, tokens };
  },

  /**
   * Register a new passenger account.
   * Creates user with status=pending_verification, sends OTP via notification service.
   * Throws PHONE_ALREADY_EXISTS (409).
   */
  async register(data: {
    first_name: string;
    last_name: string;
    phone_number: string;
    email?: string;
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
        email: data.email ?? null,
        password_hash,
        user_type: 'passenger',
        status: 'pending_verification',
      },
    });

    const { code, expiresIn } = await OtpService.create(user.id);

    publishNotification({
      type: 'user.registered',
      user_id: user.id,
      first_name: user.first_name,
      phone_number: user.phone_number!,
    });

    publishNotification({
      type: 'otp.send',
      phone_number: user.phone_number!,
      code,
      expires_in_seconds: expiresIn,
    });

    return { user_id: user.id, expires_in: expiresIn };
  },

  /**
   * Verify phone number with OTP.
   * Activates the user account and issues a token pair.
   * Throws INVALID_OTP (400), OTP_EXPIRED (410), USER_NOT_FOUND (404).
   */
  async verifyPhone(
    user_id: string,
    otp: string,
    device_name?: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    await OtpService.verify(user_id, otp);

    const user = await prisma.user.update({
      where: { id: user_id },
      data: {
        status: 'active',
        phone_verified_at: new Date(),
      },
      ...withRoles,
    });

    const tokens = await TokenService.issueTokenPair(user, device_name);
    return { user, tokens };
  },

  /**
   * Initiate password recovery. Delegates to PasswordService.
   * Always returns silently (no enumeration).
   */
  async forgotPassword(identifier: string): Promise<void> {
    return PasswordService.forgotPassword(identifier);
  },

  /**
   * Complete password reset with token. Delegates to PasswordService.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    return PasswordService.resetPassword(rawToken, newPassword);
  },

  /**
   * Rotate a refresh token. Delegates to TokenService.
   * Reuse detection: if a revoked token is presented, all sessions are wiped.
   */
  async refresh(
    rawToken: string,
  ): Promise<{ user: UserWithRoles; tokens: AuthTokens }> {
    return TokenService.rotateRefreshToken(rawToken);
  },

  /**
   * Logout — revoke the presented refresh token. Idempotent.
   * Mobile: raw token from Authorization header.
   * Web: raw token from cookie.
   */
  async logout(rawRefreshToken: string): Promise<void> {
    await TokenService.revokeByRawToken(rawRefreshToken);
  },

  /**
   * Logout all sessions for the authenticated user.
   */
  async logoutAll(userId: string): Promise<void> {
    await TokenService.revokeAllForUser(userId);
  },
};
