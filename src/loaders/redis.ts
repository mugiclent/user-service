import { Redis } from 'ioredis';
import { config } from '../config/index.js';

let redisClient: Redis;

type RedisHealth = { ok: boolean; error?: string };
let redisHealth: RedisHealth = { ok: false, error: 'not yet connected' };

export const getRedisHealth = (): RedisHealth => redisHealth;

export const initRedis = (): void => {
  redisClient = new Redis(config.redis.url, {
    lazyConnect: false,
    // null = buffer commands while reconnecting instead of throwing after N retries
    maxRetriesPerRequest: null,
  });

  redisClient.on('ready', () => {
    redisHealth = { ok: true };
    console.warn('[redis] Connected');
  });

  redisClient.on('error', (err: Error) => {
    redisHealth = { ok: false, error: err.message };
    console.warn('[redis] Error:', err.message);
  });

  redisClient.on('close', () => {
    redisHealth = { ok: false, error: 'connection closed — reconnecting' };
  });

  redisClient.on('end', () => {
    redisHealth = { ok: false, error: 'connection ended' };
    console.warn('[redis] Connection ended');
  });
};

export const getRedisClient = (): Redis => {
  if (!redisClient) throw new Error('Redis client not initialized');
  return redisClient;
};
