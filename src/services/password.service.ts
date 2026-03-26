import { prisma } from '../models/index.js';
import { hashPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { OtpService } from './otp.service.js';
import { publishSms, publishMail, publishAudit } from '../utils/publishers.js';

const isEmail = (identifier: string): boolean => identifier.includes('@');

export const PasswordService = {
  /**
   * Initiate password recovery via a 6-digit OTP.
   * SMS users receive otp.sms; email users receive otp.mail.
   * Always silent — never reveals whether account exists.
   */
  async forgotPassword(identifier: string): Promise<void> {
    const viaEmail = isEmail(identifier);

    const user = await prisma.user.findFirst({
      where: viaEmail ? { email: identifier } : { phone_number: identifier },
    });

    if (!user) return; // silent — no enumeration

    const { code, expiresIn } = await OtpService.create(user.id, 'password_reset');

    if (viaEmail && user.email) {
      publishMail({
        type: 'otp.mail',
        purpose: 'password_reset',
        email: user.email,
        first_name: user.first_name,
        code,
        expires_in_seconds: expiresIn,
      });
    } else {
      publishSms({
        type: 'otp.sms',
        purpose: 'password_reset',
        phone_number: user.phone_number,
        code,
        expires_in_seconds: expiresIn,
      });
    }
  },

  /**
   * Complete password reset using the 6-digit OTP.
   * Works for both SMS (phone identifier) and email identifiers.
   * Revokes all sessions on success.
   */
  async resetPassword(identifier: string, otp: string, newPassword: string): Promise<void> {
    const viaEmail = isEmail(identifier);

    const user = await prisma.user.findFirst({
      where: viaEmail ? { email: identifier } : { phone_number: identifier },
    });

    if (!user) throw new AppError('INVALID_OTP', 400);

    await OtpService.verify(user.id, otp, 'password_reset');

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    publishAudit({
      actor_id: user.id,
      action: 'password_reset',
      resource: 'User',
      resource_id: user.id,
    });
  },
};
