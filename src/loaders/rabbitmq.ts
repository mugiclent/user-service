import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';

let connection: ChannelModel;
let publishChannel: Channel;
let consumerChannel: Channel | undefined;

const reconnectCallbacks: Array<() => Promise<void>> = [];

export const onRabbitMQReconnect = (cb: () => Promise<void>): void => {
  reconnectCallbacks.push(cb);
};

const connect = async (): Promise<void> => {
  connection = await amqplib.connect(config.rabbitmq.url);
  connection.on('error', (err) => console.error('[rabbitmq] Connection error:', err));
  connection.on('close', () => void scheduleReconnect());

  publishChannel = await connection.createChannel();
  await publishChannel.assertExchange('logs', 'topic', { durable: true });
  await publishChannel.assertExchange('notifications', 'topic', { durable: true });

  consumerChannel = undefined;
};

let reconnecting = false;

const scheduleReconnect = async (): Promise<void> => {
  if (reconnecting) return;
  reconnecting = true;
  console.warn('[rabbitmq] Connection lost — reconnecting...');

  let attempt = 0;
  while (true) {
    attempt++;
    console.warn(`[rabbitmq] Broker not ready (attempt ${attempt}) — retrying in 3s`);
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      await connect();
      for (const cb of reconnectCallbacks) await cb();
      reconnecting = false;
      console.warn('[rabbitmq] Reconnected');
      return;
    } catch { /* keep retrying */ }
  }
};

export const initRabbitMQ = async (): Promise<void> => {
  await connect();
};

export const getRabbitMQChannel = (): Channel => {
  if (!publishChannel) throw new Error('RabbitMQ channel not initialized');
  return publishChannel;
};

/**
 * Returns a dedicated channel for consumers.
 * Sets prefetch=1 so each message is processed before the next is delivered.
 * Called by subscriber init functions after initRabbitMQ().
 */
export const getConsumerChannel = async (): Promise<Channel> => {
  if (!consumerChannel) {
    consumerChannel = await connection.createChannel();
    await consumerChannel.prefetch(1);
  }
  return consumerChannel;
};

export const closeRabbitMQ = async (): Promise<void> => {
  await consumerChannel?.close();
  await publishChannel?.close();
  await connection?.close();
};
