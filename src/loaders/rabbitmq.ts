import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';

let connection: ChannelModel;
let channel: Channel;

/**
 * Topology:
 *
 *  logs exchange (topic)
 *    └── audit queue  ←── routing key: audit.logs
 *
 *  notifications exchange (topic)
 *    ├── sms  queue   ←── routing key: sms.notifications  (DLX → notifications.dlx)
 *    └── mail queue   ←── routing key: mail.notifications (DLX → notifications.dlx)
 *
 *  notifications.dlx exchange (fanout) — dead-letter sink
 *    └── notifications.dead queue  ←── all rejected/expired messages land here
 *
 * NOTE: If sms/mail queues already exist without the x-dead-letter-exchange argument,
 * delete them in the RabbitMQ management UI before restarting — queue arguments are
 * immutable once declared.
 */
export const initRabbitMQ = async (): Promise<void> => {
  connection = await amqplib.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // ── logs exchange ──────────────────────────────────────────────────────────
  await channel.assertExchange('logs', 'topic', { durable: true });
  await channel.assertQueue('audit', { durable: true });
  await channel.bindQueue('audit', 'logs', 'audit.logs');

  // ── dead-letter exchange (fanout — all failed notifications land here) ──────
  await channel.assertExchange('notifications.dlx', 'fanout', { durable: true });
  await channel.assertQueue('notifications.dead', { durable: true });
  await channel.bindQueue('notifications.dead', 'notifications.dlx', '');

  // ── notifications exchange ─────────────────────────────────────────────────
  await channel.assertExchange('notifications', 'topic', { durable: true });
  await channel.assertQueue('sms', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'notifications.dlx' },
  });
  await channel.bindQueue('sms', 'notifications', 'sms.notifications');
  await channel.assertQueue('mail', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'notifications.dlx' },
  });
  await channel.bindQueue('mail', 'notifications', 'mail.notifications');
};

export const getRabbitMQChannel = (): Channel => {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
};

export const closeRabbitMQ = async (): Promise<void> => {
  await channel?.close();
  await connection?.close();
};
