import type { Channel } from 'amqplib';
import type { Redis } from 'ioredis';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';
import { topupConfirmedMessage, topupFailedMessage } from '../utils/wallet-format.js';
import { topupStatusKey, TOPUP_STATUS_TTL } from '../utils/topup-status.js';

// Translate a top-up outcome into the SSE contract, persist it for late/reconnecting
// subscribers (replay), then publish it for any client already streaming.
const emitTopupOutcome = async (
  redis: Redis,
  topupId: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const body = JSON.stringify(payload);
  await redis.set(topupStatusKey(topupId), body, 'EX', TOPUP_STATUS_TTL);
  await redis.publish(`topup:${topupId}`, body);
};

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
  method?: 'mtn' | 'airtel' | null; // payment-svc method; mapped to payment_method (top-ups)
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

interface TopupConfirmed { topupId: string; userId: string; amount: string; newBalance: string; method?: 'mtn' | 'airtel' | null }
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

        // Top-up outcome → translate the payment-svc event into the user-service
        // SSE contract, then BOTH persist it (so a client that connects after the
        // outcome can replay it — fixes the lost-event race) and publish it (for a
        // client already streaming). Balance is handled by passenger.transaction above.
        case 'topup.confirmed': {
          const e = JSON.parse(msg.content.toString()) as TopupConfirmed;
          await emitTopupOutcome(redis, e.topupId, {
            status: 'confirmed',
            amount: Number(e.amount),
            currency: 'RWF',
            new_balance: Number(e.newBalance),
            message: topupConfirmedMessage(e.method),
          });
          break;
        }

        case 'topup.failed': {
          const e = JSON.parse(msg.content.toString()) as TopupFailed;
          await emitTopupOutcome(redis, e.topupId, {
            status: 'failed',
            reason: e.reason,
            message: topupFailedMessage(e.reason),
            retryable: true, // top-ups are always retryable (client mints a fresh topup_id)
          });
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
      payment_method: e.type === 'passenger.transaction' ? (e.method ?? null) : null,
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
