import { randomInt } from 'node:crypto';
import { prisma } from '../models/index.js';
import { hashToken } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';

/** Generate a zero-padded N-digit numeric OTP. */
const generateCode = (length: number): string => {
  const max = Math.pow(10, length);
  return String(randomInt(0, max)).padStart(length, '0');
};

export const OtpService = {
  /**
   * Create a new OTP for a user.
   * Deletes any existing unused OTPs first.
   * Returns the raw code (to be sent via notification service) and its TTL.
   */
  async create(userId: string): Promise<{ code: string; expiresIn: number }> {
    // Delete previous unused OTPs for this user
    await prisma.otp.deleteMany({
      where: { user_id: userId, used_at: null },
    });

    const code = generateCode(config.otp.length);
    const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);

    await prisma.otp.create({
      data: {
        user_id: userId,
        code_hash: hashToken(code),
        expires_at: expiresAt,
      },
    });

    return { code, expiresIn: config.otp.ttlSeconds };
  },

  /**
   * Verify a 6-digit OTP for a user.
   * Throws INVALID_OTP (400) or OTP_EXPIRED (410) on failure.
   * Marks as used and deletes the record on success.
   */
  async verify(userId: string, code: string): Promise<void> {
    const codeHash = hashToken(code);

    const otp = await prisma.otp.findFirst({
      where: { user_id: userId, code_hash: codeHash, used_at: null },
    });

    if (!otp) throw new AppError('INVALID_OTP', 400);

    if (otp.expires_at < new Date()) {
      await prisma.otp.delete({ where: { id: otp.id } });
      throw new AppError('OTP_EXPIRED', 410);
    }

    // Single-use: delete immediately after verification
    await prisma.otp.delete({ where: { id: otp.id } });
  },
};
