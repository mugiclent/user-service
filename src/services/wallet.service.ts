import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getRedisClient } from '../loaders/redis.js';
import { publishWalletEvent } from '../utils/publishers.js';
import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { normalizePhone } from '../utils/phone.js';
import { describeTransaction, sourceToType, typeToSource } from '../utils/wallet-format.js';

const TOPUP_TTL = 360;
const MIN_TOPUP_AMOUNT = 100;
const MAX_TOPUP_AMOUNT = 5_000_000;

export const WalletService = {
  async initiateTopup(
    userId: string,
    data: { amount: number; phone?: string; payment_method: 'mtn' | 'airtel' },
  ): Promise<{ topup_id: string }> {
    if (!Number.isInteger(data.amount) || data.amount < MIN_TOPUP_AMOUNT || data.amount > MAX_TOPUP_AMOUNT) {
      throw new AppError('INVALID_AMOUNT', 400);
    }

    // Resolve the MoMo phone: explicit input or the caller's profile phone.
    let rawPhone = data.phone;
    if (!rawPhone) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone_number: true } });
      if (!user?.phone_number) throw new AppError('INVALID_PHONE', 422);
      rawPhone = user.phone_number;
    }

    let normalized: string;
    try {
      normalized = normalizePhone(rawPhone);
    } catch {
      throw new AppError('INVALID_PHONE', 422);
    }
    const phone = `+${normalized}`;
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

  async getWallet(userId: string): Promise<{ available: number; currency: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new AppError('USER_NOT_FOUND', 404);
    // `available` is the balance projection (set from payment-svc wallet.events).
    return { available: Number(user.balance), currency: 'RWF' };
  },

  // Served from the local wallet_transactions projection (fed by payment-service's
  // passenger.transaction events) — no synchronous call to payment-service.
  // The frontend contract uses `type` (= our `source`) + a derived `description`;
  // the DB row keeps the richer movement fields (CREDIT/DEBIT, balance_after, refs).
  async getTransactions(
    userId: string,
    opts: { page?: number; limit?: number; type?: string } = {},
  ): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WalletTransactionWhereInput = { owner_id: userId, owner_type: 'PASSENGER' };
    // Frontend `type` filter (topup | payment | refund) maps onto our `source`
    // (topup | ticket_payment | refund) — `payment` ⇄ `ticket_payment` at the boundary.
    if (opts.type) where.source = typeToSource(opts.type);

    const [rows, total] = await Promise.all([
      prisma.walletTransaction.findMany({ where, orderBy: { occurred_at: 'desc' }, skip, take: limit }),
      prisma.walletTransaction.count({ where }),
    ]);

    return {
      data: rows.map((t) => ({
        id: t.id,
        type: sourceToType(t.source),           // contract: topup | payment | refund
        amount: Number(t.amount),
        currency: 'RWF',
        description: describeTransaction(t.source, t.payment_method),
        created_at: t.occurred_at,
        // Extra impl fields kept — useful for the UI (deep-link, running balance).
        reference: t.reference,
        ticket_id: t.ticket_id,
        balance_after: Number(t.balance_after),
      })),
      total,
      page,
      limit,
    };
  },
};
