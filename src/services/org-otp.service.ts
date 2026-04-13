import { randomInt } from 'node:crypto';
import { prisma } from '../models/index.js';
import { hashToken } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';

export type OrgOtpPurpose = 'phone_verification' | 'email_verification';

const generateCode = (length: number): string => {
  const max = Math.pow(10, length);
  return String(randomInt(0, max)).padStart(length, '0');
};

export const OrgOtpService = {
  async create(orgId: string, purpose: OrgOtpPurpose): Promise<{ code: string; expiresIn: number }> {
    await prisma.orgOtp.deleteMany({
      where: { org_id: orgId, purpose, used_at: null },
    });

    const code = generateCode(config.otp.length);
    const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);

    await prisma.orgOtp.create({
      data: {
        org_id: orgId,
        purpose,
        code_hash: hashToken(code),
        expires_at: expiresAt,
      },
    });

    return { code, expiresIn: config.otp.ttlSeconds };
  },

  async verify(orgId: string, code: string, purpose: OrgOtpPurpose): Promise<void> {
    const codeHash = hashToken(code);

    const otp = await prisma.orgOtp.findFirst({
      where: { org_id: orgId, purpose, code_hash: codeHash, used_at: null },
    });

    if (!otp) throw new AppError('INVALID_OTP', 400);

    if (otp.expires_at < new Date()) {
      await prisma.orgOtp.delete({ where: { id: otp.id } });
      throw new AppError('OTP_EXPIRED', 410);
    }

    await prisma.orgOtp.delete({ where: { id: otp.id } });
  },

  async hasExisting(orgId: string, purpose: OrgOtpPurpose): Promise<boolean> {
    const otp = await prisma.orgOtp.findFirst({
      where: { org_id: orgId, purpose, used_at: null },
    });
    return !!otp;
  },
};
