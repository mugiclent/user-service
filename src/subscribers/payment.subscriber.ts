import type { Channel } from 'amqplib';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';

const QUEUE = 'payment-user-svc';
const EXCHANGE = 'payment';
const ROUTING_KEY = '#';

// Events as emitted by payment-service (camelCase; bigints serialized as strings).
// We dispatch on the AMQP routing key — payment-service does not put a `type` in
// the body for these.
interface TopupConfirmed {
  topupId: string;
  topupRef: string;
  userId: string;
  amount: string;
  newBalance: string;
  confirmedAt: string;
}
interface TopupFailed {
  topupId: string;
  topupRef: string;
  userId: string;
  amount: string;
  reason: string;
  failedAt: string;
}
// CQRS projection — payment-service is the source of truth for the wallet
// balance; we mirror it onto the user record so reads never hit payment-service.
interface WalletTransactionCompleted {
  userId: string;
  newBalance: string;
  type: 'CREDIT' | 'DEBIT';
  amount: string;
  occurredAt: string;
}

export const initPaymentSubscriber = async (ch: Channel): Promise<void> => {
  const redis = getRedisClient();

  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': 'payment.dlx' } });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;

    try {
      switch (routingKey) {
        // Authoritative balance projection — set (not increment) so the display
        // balance can never drift from payment-service, and append a ledger row.
        case 'wallet.transaction.completed': {
          const e = JSON.parse(msg.content.toString()) as WalletTransactionCompleted;
          const newBalance = Number(e.newBalance);
          await prisma.$transaction([
            prisma.user.update({ where: { id: e.userId }, data: { balance: newBalance } }),
            prisma.walletTransaction.create({
              data: {
                user_id: e.userId,
                type: e.type,
                amount: Number(e.amount),
                balance_after: newBalance,
                occurred_at: new Date(e.occurredAt),
              },
            }),
          ]);
          break;
        }

        // Top-up outcome — bridge to the per-topup Redis channel the SSE stream
        // (`GET /users/me/wallet/topup/:id/stream`) is waiting on. Balance is
        // handled by wallet.transaction.completed above.
        case 'topup.confirmed': {
          const e = JSON.parse(msg.content.toString()) as TopupConfirmed;
          await redis.publish(`topup:${e.topupId}`, JSON.stringify({
            type: 'topup.payment.confirmed',
            topup_id: e.topupId,
            user_id: e.userId,
            amount: Number(e.amount),
            new_balance: Number(e.newBalance),
          }));
          break;
        }

        case 'topup.failed': {
          const e = JSON.parse(msg.content.toString()) as TopupFailed;
          await redis.publish(`topup:${e.topupId}`, JSON.stringify({
            type: 'topup.payment.failed',
            topup_id: e.topupId,
            user_id: e.userId,
            reason: e.reason,
          }));
          break;
        }

        // payment.confirmed / payment.failed (momo/cash ticket payments) and any
        // other payment events are not relevant to the user-service projection.
        default:
          break;
      }

      try { ch.ack(msg); } catch { /* channel closed; broker requeues */ }
    } catch (err) {
      console.error('[payment-subscriber] Failed to process message', routingKey, err);
      try { ch.nack(msg, false, false); } catch { /* channel closed; broker requeues */ }
    }
  });

  console.warn(`[payment-subscriber] Listening on ${QUEUE}`);
};
