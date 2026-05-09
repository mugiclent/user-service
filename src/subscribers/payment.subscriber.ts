import { getConsumerChannel } from '../loaders/rabbitmq.js';
import { getRedisClient } from '../loaders/redis.js';
import { prisma } from '../models/index.js';

const QUEUE = 'payment-user-svc';
const EXCHANGE = 'payment';
const ROUTING_KEY = '#';

interface TopupPaymentConfirmed {
  type: 'topup.payment.confirmed';
  topup_id: string;
  user_id: string;
  amount: number;
  currency: string;
  new_balance: number;
  mtn_transaction_id: string | null;
  mtn_absorbed: number;
}

interface TopupPaymentFailed {
  type: 'topup.payment.failed';
  topup_id: string;
  user_id: string;
  reason: string;
  message: string;
  retryable: boolean;
}

interface TicketPaymentConfirmed {
  type: 'ticket.payment.confirmed';
  ticket_id: string;
  amount: number;
  payment_method: string;
  user_id?: string;
  org_id: string;
}

interface RefundCompleted {
  type: 'refund.completed';
  ticket_id: string;
  amount: number;
  user_id: string;
}

type PaymentEvent = TopupPaymentConfirmed | TopupPaymentFailed | TicketPaymentConfirmed | RefundCompleted;

export const initPaymentSubscriber = async (): Promise<void> => {
  const ch = await getConsumerChannel();
  const redis = getRedisClient();

  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': 'payment.dlx' } });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString()) as PaymentEvent;

      switch (event.type) {
        case 'topup.payment.confirmed':
          await prisma.user.update({
            where: { id: event.user_id },
            data: { balance: { increment: event.amount } },
          });
          await redis.publish(`topup:${event.topup_id}`, JSON.stringify(event));
          break;

        case 'topup.payment.failed':
          await redis.publish(`topup:${event.topup_id}`, JSON.stringify(event));
          break;

        case 'ticket.payment.confirmed':
          if (event.payment_method === 'wallet') {
            await Promise.all([
              event.user_id
                ? prisma.user.update({ where: { id: event.user_id }, data: { balance: { decrement: event.amount } } })
                : Promise.resolve(),
              prisma.org.update({ where: { id: event.org_id }, data: { balance: { increment: event.amount } } }),
            ]);
          }
          break;

        case 'refund.completed':
          await prisma.user.update({
            where: { id: event.user_id },
            data: { balance: { increment: event.amount } },
          });
          break;
      }

      ch.ack(msg);
    } catch (err) {
      console.error('[payment-subscriber] Failed to process message', err);
      ch.nack(msg, false, false);
    }
  });

  console.warn(`[payment-subscriber] Listening on ${QUEUE}`);
};
