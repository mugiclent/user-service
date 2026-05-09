import { randomUUID } from 'node:crypto';
import { getRedisClient } from '../loaders/redis.js';
import { publishWalletEvent } from '../utils/publishers.js';
import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const TOPUP_TTL = 360;

export const WalletService = {
  async initiateTopup(
    userId: string,
    data: { amount: number; phone_number?: string; payment_method: 'mtn' | 'airtel' },
  ): Promise<{ topup_id: string }> {
    let rawPhone = data.phone_number;

    if (!rawPhone) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone_number: true } });
      if (!user?.phone_number) throw new AppError('PHONE_NOT_FOUND', 422);
      rawPhone = user.phone_number;
    }

    const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
    const topup_id = randomUUID();
    const payment_ref = randomUUID();

    await getRedisClient().set(`topup_owner:${topup_id}`, userId, 'EX', TOPUP_TTL);

    publishWalletEvent({
      type: 'wallet.topup.requested',
      topup_id,
      payment_ref,
      user_id: userId,
      amount: data.amount,
      currency: 'RWF',
      phone,
      payment_method: data.payment_method,
    });

    return { topup_id };
  },

  async verifyTopupOwner(topupId: string, userId: string): Promise<boolean> {
    const ownerId = await getRedisClient().get(`topup_owner:${topupId}`);
    return ownerId === userId;
  },

  async getWallet(userId: string): Promise<{ balance: number; currency: string; user_id: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);
    return { balance: Number(user.balance), currency: 'RWF', user_id: userId };
  },
};
