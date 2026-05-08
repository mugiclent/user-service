import { prisma } from '../models/index.js';
import { hashPassword } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { OtpService } from './otp.service.js';
import { publishSms, publishMail, publishAudit, notifyUser, publishUserDomainEvent } from '../utils/publishers.js';
import type { Locale } from '../utils/publishers.js';
import { normalizePhone } from '../utils/phone.js';

const isEmail = (identifier: string): boolean => identifier.includes('@');

export const PasswordService = {
  /**
   * Initiate password recovery via a 6-digit OTP.
   * SMS users receive otp.sms; email users receive otp.mail.
   * Always silent — never reveals whether account exists.
   */
  async forgotPassword(identifier: string): Promise<void> {
    const viaEmail = isEmail(identifier);
    const normalized = viaEmail ? identifier : normalizePhone(identifier);

    const user = await prisma.user.findFirst({
      where: viaEmail ? { email: normalized } : { phone_number: normalized },
    });

    if (!user) return; // silent — no enumeration

    const { code, expiresIn } = await OtpService.create(user.id, 'password_reset');

    const locale = user.locale as Locale;
    if (viaEmail && user.email) {
      publishMail({
        type: 'otp.mail',
        purpose: 'password_reset',
        email: user.email,
        first_name: user.first_name,
        code,
        expires_in_seconds: expiresIn,
        locale,
      });
    } else {
      publishSms({
        type: 'otp.sms',
        purpose: 'password_reset',
        phone_number: user.phone_number!,
        code,
        expires_in_seconds: expiresIn,
        locale,
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
    const normalized = viaEmail ? identifier : normalizePhone(identifier);

    const user = await prisma.user.findFirst({
      where: viaEmail ? { email: normalized } : { phone_number: normalized },
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

    notifyUser(user, {
      sms: user.phone_number ? { type: 'security.password_changed', phone_number: user.phone_number, first_name: user.first_name } : undefined,
      mail: user.email ? { type: 'security.password_changed', email: user.email, first_name: user.first_name } : undefined,
      push: { type: 'security.password_changed' },
    });

    publishUserDomainEvent({ type: 'user.password_changed', id: user.id, user_type: user.user_type });

    publishAudit({
      actor_id: user.id,
      action: 'password_reset',
      resource: 'User',
      resource_id: user.id,
    });
  },
};
