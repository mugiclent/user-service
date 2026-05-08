import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';

let connection: ChannelModel;
let publishChannel: Channel;
let consumerChannel: Channel;

export const initRabbitMQ = async (): Promise<void> => {
  connection = await amqplib.connect(config.rabbitmq.url);
  publishChannel = await connection.createChannel();

  await publishChannel.assertExchange('logs', 'topic', { durable: true });
  await publishChannel.assertExchange('notifications', 'topic', { durable: true });
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
