// Infrastructure bootstrap — excluded from unit test coverage (see vitest.config.ts)
import 'dotenv/config';
import { config } from './config/index.js';
import { createApp } from './loaders/express.js';
import { initPrisma } from './loaders/prisma.js';
import { initRedis } from './loaders/redis.js';
import { initRabbitMQ, closeRabbitMQ } from './loaders/rabbitmq.js';
import { initCleanup } from './loaders/cleanup.js';
import { bootstrap } from './loaders/bootstrap.js';
import { prisma } from './models/index.js';
import { initBillingSubscriber } from './subscribers/billing.subscriber.js';
import { initPaymentSubscriber } from './subscribers/payment.subscriber.js';

const start = async (): Promise<void> => {
  // Initialize infrastructure
  await initPrisma();
  await bootstrap();
  initRedis();
  await initRabbitMQ();
  await initBillingSubscriber();
  await initPaymentSubscriber();
  initCleanup();

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.warn(`[server] Listening on port ${config.port} (${config.isProd ? 'production' : 'development'})`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`[server] ${signal} received — shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      await closeRabbitMQ();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  console.error('[server] Failed to start', err);
  process.exit(1);
});
