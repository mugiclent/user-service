import Redis from 'ioredis';
import { config } from '../config/index.js';

let redisClient: Redis;

export const initRedis = (): void => {
  redisClient = new Redis(config.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  redisClient.on('error', (err) => {
    console.error('[redis] Connection error', err);
  });
};

export const getRedisClient = (): Redis => {
  if (!redisClient) throw new Error('Redis client not initialized');
  return redisClient;
};
