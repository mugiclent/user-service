import { prisma } from '../models/index.js';
import { hashToken, generateRawToken, hashPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { TokenService } from './token.service.js';
import { publishSms, publishMail, publishAudit } from '../utils/publishers.js';

// Passengers (phone-only): 15-min SMS token
// Staff with email: 1-hour email link
const SMS_TTL_MS   = 15 * 60 * 1000;
const EMAIL_TTL_MS = 60 * 60 * 1000;

const isEmail = (identifier: string): boolean => identifier.includes('@');

export const PasswordService = {
  /**
   * Initiate password recovery.
   * Routes to SMS queue (phone identifier or passenger) or mail queue (email identifier / staff).
   * Always silent — never reveals whether account exists.
   */
  async forgotPassword(identifier: string): Promise<void> {
    const viaEmail = isEmail(identifier);

    const user = await prisma.user.findFirst({
      where: viaEmail ? { email: identifier } : { phone_number: identifier },
    });

    if (!user) return; // silent — no enumeration

    // Invalidate any existing unused reset tokens
    await prisma.passwordReset.updateMany({
      where: { user_id: user.id, used_at: null },
      data: { used_at: new Date() },
    });

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (viaEmail ? EMAIL_TTL_MS : SMS_TTL_MS));

    await prisma.passwordReset.create({
      data: { user_id: user.id, token_hash: tokenHash, expires_at: expiresAt },
    });

    const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (viaEmail && user.email) {
      // Staff user identified by email → mail queue
      publishMail({
        type: 'password_reset.mail',
        email: user.email,
        first_name: user.first_name,
        reset_token: rawToken,
        expires_in_seconds: expiresInSeconds,
      });
    } else {
      // Passenger (or staff using phone) → SMS queue
      publishSms({
        type: 'password_reset.sms',
        phone_number: user.phone_number,
        reset_token: rawToken,
        expires_in_seconds: expiresInSeconds,
      });
    }
  },

  /**
   * Complete password reset.
   * Validates token, hashes new password, revokes all sessions.
   * Client must redirect to /auth/login after success.
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
      prisma.passwordReset.delete({ where: { token_hash: tokenHash } }),
      prisma.user.update({ where: { id: record.user_id }, data: { password_hash: passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { user_id: record.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    publishAudit({
      actor_id: record.user_id,
      action: 'password_reset',
      resource: 'User',
      resource_id: record.user_id,
    });
  },
};
