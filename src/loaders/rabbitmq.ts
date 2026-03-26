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
 *    ├── sms  queue   ←── routing key: sms.notifications
 *    └── mail queue   ←── routing key: mail.notifications
 */
export const initRabbitMQ = async (): Promise<void> => {
  connection = await amqplib.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // ── logs exchange ──────────────────────────────────────────────────────────
  await channel.assertExchange('logs', 'topic', { durable: true });
  await channel.assertQueue('audit', { durable: true });
  await channel.bindQueue('audit', 'logs', 'audit.logs');

  // ── notifications exchange ─────────────────────────────────────────────────
  await channel.assertExchange('notifications', 'topic', { durable: true });
  await channel.assertQueue('sms', { durable: true });
  await channel.bindQueue('sms', 'notifications', 'sms.notifications');
  await channel.assertQueue('mail', { durable: true });
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
