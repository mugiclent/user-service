import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';
import { initBillingSubscriber } from '../subscribers/billing.subscriber.js';
import { initPaymentSubscriber } from '../subscribers/payment.subscriber.js';

const RETRY_DELAY_MS = 3_000;

let connection: ChannelModel;
let publishChannel: Channel;
let billingChannel: Channel;
let paymentChannel: Channel;
let isShuttingDown = false;
let isReconnecting = false;
let isReconnectingChannel = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Health state ──────────────────────────────────────────────────────────────

type RabbitHealth = { ok: boolean; error?: string };
let rabbitHealth: RabbitHealth = { ok: false, error: 'not yet connected' };

export const getRabbitMQHealth = (): RabbitHealth => rabbitHealth;

// ── Channel setup ─────────────────────────────────────────────────────────────

const setupChannels = async (): Promise<void> => {
  publishChannel  = await connection.createChannel();
  billingChannel  = await connection.createChannel();
  paymentChannel  = await connection.createChannel();

  await billingChannel.prefetch(1);
  await paymentChannel.prefetch(1);

  // All exchanges are pre-defined in definitions.json — verify, never re-declare.
  await publishChannel.checkExchange('logs');
  await publishChannel.checkExchange('notifications');
  await publishChannel.checkExchange('users');
  await billingChannel.checkExchange('billing');
  await paymentChannel.checkExchange('payment');

  await initBillingSubscriber(billingChannel);
  await initPaymentSubscriber(paymentChannel);

  rabbitHealth = { ok: true };
  console.warn('[rabbitmq] Connected — billingChannel and paymentChannel consuming');

  // Channel-level handlers — a broker-forced channel close kills the consumer
  // without closing the connection. Recreate all channels without a full reconnect.
  for (const [name, ch] of [
    ['billing', billingChannel],
    ['payment', paymentChannel],
    ['publish', publishChannel],
  ] as [string, Channel][]) {
    ch.on('error', (err: Error) => {
      console.warn(`[rabbitmq] ${name}Channel error:`, err.message);
    });
    ch.on('close', () => {
      if (isShuttingDown || isReconnecting || isReconnectingChannel) return;
      isReconnectingChannel = true;
      rabbitHealth = { ok: false, error: `${name}Channel closed — re-creating` };
      console.warn(`[rabbitmq] ${name}Channel closed — re-creating in ${RETRY_DELAY_MS / 1000}s`);
      setTimeout(() => {
        void setupChannels()
          .catch((err: Error) => {
            console.warn('[rabbitmq] Failed to re-create channels:', err.message);
          })
          .finally(() => {
            isReconnectingChannel = false;
          });
      }, RETRY_DELAY_MS);
    });
  }
};

// ── Connection setup ──────────────────────────────────────────────────────────

const setup = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      connection = await amqplib.connect(config.rabbitmq.url);
      break;
    } catch {
      console.warn(`[rabbitmq] Broker not ready (attempt ${attempt}) — retrying in ${RETRY_DELAY_MS / 1000}s`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  // Register BEFORE channel work — if setupChannels() throws, the connection
  // still has a close handler so scheduleReconnect fires correctly.
  connection.on('close', scheduleReconnect);
  connection.on('error', (err: Error) => {
    console.warn('[rabbitmq] Connection error:', err.message);
  });

  await setupChannels();
};

const scheduleReconnect = (): void => {
  if (isShuttingDown || isReconnecting) return;
  isReconnecting = true;
  rabbitHealth = { ok: false, error: 'connection lost — reconnecting' };
  console.warn('[rabbitmq] Connection lost — reconnecting...');

  void (async () => {
    for (;;) {
      await sleep(RETRY_DELAY_MS);
      try {
        await setup();
        isReconnecting = false;
        return;
      } catch (err) {
        console.warn('[rabbitmq] Reconnect attempt failed:', (err as Error).message);
        try { await connection?.close(); } catch { /* already closed */ }
      }
    }
  })();
};

// ── Public API ────────────────────────────────────────────────────────────────

export const getRabbitMQChannel = (): Channel => {
  if (!publishChannel) throw new Error('RabbitMQ channel not initialized');
  return publishChannel;
};

export const initRabbitMQ = async (): Promise<void> => {
  await setup();
};

export const closeRabbitMQ = async (): Promise<void> => {
  isShuttingDown = true;
  await billingChannel?.close();
  await paymentChannel?.close();
  await publishChannel?.close();
  await connection?.close();
};
