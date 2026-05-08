import { randomUUID } from 'node:crypto';
import { getRedisClient } from '../loaders/redis.js';
import { publishWalletEvent } from '../utils/publishers.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

// Ownership key TTL: 10 minutes — long enough for payment to complete and SSE to connect
const TOPUP_OWNER_TTL = 600;

export const WalletService = {
  async initiateTopup(
    userId: string,
    data: { amount: number; phone_number: string; provider: 'mtn_momo' | 'airtel_money' },
  ): Promise<{ topup_id: string }> {
    const topup_id = randomUUID();

    await getRedisClient().set(`topup_owner:${topup_id}`, userId, 'EX', TOPUP_OWNER_TTL);

    publishWalletEvent({
      type: 'wallet.topup.requested',
      topup_id,
      user_id: userId,
      amount: data.amount,
      phone_number: data.phone_number,
      provider: data.provider,
    });

    return { topup_id };
  },

  async verifyTopupOwner(topupId: string, userId: string): Promise<boolean> {
    const ownerId = await getRedisClient().get(`topup_owner:${topupId}`);
    return ownerId === userId;
  },

  async getWallet(userId: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${config.paymentServiceUrl}/wallet/${userId}`, {
        headers: { 'X-User-ID': userId },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new AppError('PAYMENT_SERVICE_UNAVAILABLE', 503);
    }

    const body = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      const code = (body['error'] as Record<string, unknown> | undefined)?.['code'] as string | undefined;
      throw new AppError(code ?? 'PAYMENT_SERVICE_ERROR', res.status);
    }

    return body;
  },
};
