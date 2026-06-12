import type { Channel } from 'amqplib';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';

const QUEUE = 'payment-user-svc';
const EXCHANGE = 'payment';

// Routing keys we bind. payment-service emits passenger AND organisation wallet
// movements under `wallet.events` (discriminated by a `type` field); top-up
// outcomes drive the SSE stream.
const BINDINGS = ['wallet.events', 'topup.confirmed', 'topup.failed'];

// payment-service emits camelCase; bigints are serialized as strings.
interface PassengerTransaction {
  type: 'passenger.transaction';
  userId: string;
  newBalance: string;
  movement: 'CREDIT' | 'DEBIT';
  amount: string;
  occurredAt: string;
  source?: 'topup' | 'ticket_payment' | 'refund';
  reference?: string;
  ticketId?: string | null;
}
interface OrganisationTransaction {
  type: 'organisation.transaction';
  orgId: string;
  newBalance: string;
  movement: 'CREDIT' | 'DEBIT';
  amount: string;
  occurredAt: string;
  source?: 'ticket_payment' | 'refund';
  reference?: string;
  ticketId?: string | null;
}
type WalletEvent = PassengerTransaction | OrganisationTransaction;

interface TopupConfirmed { topupId: string; userId: string; amount: string; newBalance: string }
interface TopupFailed { topupId: string; userId: string; reason: string }

export const initPaymentSubscriber = async (ch: Channel): Promise<void> => {
  const redis = getRedisClient();

  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': 'payment.dlx' } });
  for (const key of BINDINGS) await ch.bindQueue(QUEUE, EXCHANGE, key);
  // Drop the legacy catch-all binding — we now bind the specific wallet/topup keys.
  await ch.unbindQueue(QUEUE, EXCHANGE, '#');

  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;

    try {
      switch (routingKey) {
        // Authoritative balance projection for BOTH owners. SET (not increment)
        // from newBalance so the display balance never drifts, and append a
        // ledger row tagged with the owner type.
        case 'wallet.events': {
          const e = JSON.parse(msg.content.toString()) as WalletEvent;
          if (e.type === 'passenger.transaction') {
            await projectMovement('PASSENGER', e.userId, e);
          } else if (e.type === 'organisation.transaction') {
            await projectMovement('ORGANISATION', e.orgId, e);
          }
          break;
        }

        // Top-up outcome → bridge to the per-topup Redis channel the SSE stream
        // (`GET /users/me/wallet/topup/:id/stream`) waits on. Balance is handled
        // by the passenger.transaction above.
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

// Mirror the owner's balance and append a ledger row, in one transaction.
const projectMovement = async (
  ownerType: 'PASSENGER' | 'ORGANISATION',
  ownerId: string,
  e: WalletEvent,
): Promise<void> => {
  const newBalance = BigInt(e.newBalance);
  const ledger = prisma.walletTransaction.create({
    data: {
      owner_id: ownerId,
      owner_type: ownerType,
      type: e.movement,
      source: e.source ?? null,
      reference: e.reference ?? null,
      ticket_id: e.ticketId ?? null,
      amount: BigInt(e.amount),
      balance_after: newBalance,
      occurred_at: new Date(e.occurredAt),
    },
  });

  const balanceUpdate = ownerType === 'PASSENGER'
    ? prisma.user.update({ where: { id: ownerId }, data: { balance: newBalance } })
    : prisma.org.update({ where: { id: ownerId }, data: { balance: newBalance } });

  await prisma.$transaction([balanceUpdate, ledger]);
};
