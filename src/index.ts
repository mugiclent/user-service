import 'dotenv/config';
import { config } from './config/index.js';
import { createApp } from './loaders/express.js';
import { initPrisma } from './loaders/prisma.js';
import { initRedis } from './loaders/redis.js';
import { initRabbitMQ, closeRabbitMQ } from './loaders/rabbitmq.js';
import { prisma } from './models/index.js';

const start = async (): Promise<void> => {
  // Initialize infrastructure
  await initPrisma();
  initRedis();
  await initRabbitMQ();

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port} (${config.isProd ? 'production' : 'development'})`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[server] ${signal} received — shutting down`);
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
