import amqplib from 'amqplib';
import type { Channel, Connection } from 'amqplib';
import { config } from '../config/index.js';

let connection: Connection;
let channel: Channel;

export const initRabbitMQ = async (): Promise<void> => {
  connection = await amqplib.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // Declare the queues and exchanges this service uses
  await channel.assertQueue('audit-logs', { durable: true });
  await channel.assertExchange('notifications', 'topic', { durable: true });
};

export const getRabbitMQChannel = (): Channel => {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
};

export const closeRabbitMQ = async (): Promise<void> => {
  await channel?.close();
  await connection?.close();
};
