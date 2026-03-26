import { prisma } from '../models/index.js';
import { hashToken, generateRawToken, hashPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { publishNotification } from '../utils/publishers.js';

// Reset tokens: 15 min for SMS codes, 1 hour for email links (per contract)
const SMS_TTL_MS   = 15 * 60 * 1000;
const EMAIL_TTL_MS = 60 * 60 * 1000;

const isEmail = (identifier: string): boolean => identifier.includes('@');

export const PasswordService = {
  /**
   * Initiate a password recovery flow.
   * Always returns silently — never reveals whether the account exists (prevents enumeration).
   * Invalidates any existing reset tokens for the user before creating a new one.
   */
  async forgotPassword(identifier: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: isEmail(identifier)
        ? { email: identifier }
        : { phone_number: identifier },
    });

    // Silently succeed even if user not found — prevents enumeration
    if (!user) return;

    // Invalidate any existing reset tokens
    await prisma.passwordReset.updateMany({
      where: { user_id: user.id, used_at: null },
      data: { used_at: new Date() },
    });

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const viaEmail = isEmail(identifier);
    const expiresAt = new Date(Date.now() + (viaEmail ? EMAIL_TTL_MS : SMS_TTL_MS));

    await prisma.passwordReset.create({
      data: { user_id: user.id, token_hash: tokenHash, expires_at: expiresAt },
    });

    publishNotification({
      type: 'password_reset.send',
      identifier,
      reset_url: rawToken, // notification service builds the full URL / SMS
      expires_in_seconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    });
  },

  /**
   * Complete password reset.
   * Validates the raw token, hashes the new password, revokes all sessions.
   * Does NOT auto-login — client must redirect to /auth/login.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    const record = await prisma.passwordReset.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!record || record.used_at) throw new AppError('INVALID_TOKEN', 400);

    if (record.expires_at < new Date()) {
      await prisma.passwordReset.delete({ where: { token_hash: tokenHash } });
      throw new AppError('TOKEN_EXPIRED', 410);
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction([
      // 1. Delete the reset token
      prisma.passwordReset.delete({ where: { token_hash: tokenHash } }),
      // 2. Update password
      prisma.user.update({
        where: { id: record.user_id },
        data: { password_hash: passwordHash },
      }),
      // 3. Revoke ALL refresh tokens — force re-login on all devices
      prisma.refreshToken.updateMany({
        where: { user_id: record.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);
  },
};
