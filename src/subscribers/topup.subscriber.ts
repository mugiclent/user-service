import { getConsumerChannel } from '../loaders/rabbitmq.js';
import { getRedisClient } from '../loaders/redis.js';

const QUEUE = 'topup-user-svc';
const EXCHANGE = 'logs';
const ROUTING_KEY = 'payment.events';

interface TopupCompletedEvent {
  type: 'topup.completed';
  topup_id: string;
  user_id: string;
  amount: number;
  new_balance: number;
}

interface TopupFailedEvent {
  type: 'topup.failed';
  topup_id: string;
  user_id: string;
  reason: string;
}

type TopupPaymentEvent = TopupCompletedEvent | TopupFailedEvent;

export const initTopupSubscriber = async (): Promise<void> => {
  const ch = await getConsumerChannel();

  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString()) as TopupPaymentEvent;

      if (event.type === 'topup.completed' || event.type === 'topup.failed') {
        await getRedisClient().publish(`topup:${event.topup_id}`, JSON.stringify(event));
      }

      ch.ack(msg);
    } catch (err) {
      console.error('[topup-subscriber] Failed to process message', err);
      ch.nack(msg, false, false);
    }
  });

  console.warn(`[topup-subscriber] Listening on ${QUEUE}`);
};
