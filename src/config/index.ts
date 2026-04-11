// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import { createPublicKey } from 'node:crypto';
import { env } from './env.js';

export const config = {
  port: env.PORT,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  db: {
    url: env.NODE_ENV === 'test'
      ? env.TEST_DATABASE_URL
      : `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}?pgbouncer=true&connect_timeout=5&pool_timeout=5`,
  },

  redis: {
    url: `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}`,
  },

  rabbitmq: {
    url: `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}`,
  },

  jwt: {
    privateKey: env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    // Derived from private key — no need to store or inject the public key separately
    publicKey: createPublicKey(env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'))
      .export({ format: 'pem', type: 'spki' }) as string,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  },

  trustProxy: env.TRUST_PROXY,

  cookie: {
    secure: env.COOKIE_SECURE,
  },

  deletionGraceDays: env.DELETION_GRACE_DAYS,

  otp: {
    ttlSeconds: env.OTP_TTL_SECONDS,
    length: env.OTP_LENGTH,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    windowSeconds: env.OTP_WINDOW_SECONDS,
  },

  admin: {
    email:    env.ADMIN_EMAIL,
    phone:    env.ADMIN_PHONE,
    password: env.ADMIN_PASSWORD,
  },

  appUrl: env.APP_URL,
  staffAppUrl: env.STAFF_APP_URL,

  s3: {
    endpoint: env.S3_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    presignedExpiresIn: env.S3_PRESIGNED_EXPIRES_IN,
  },

  rateLimit: {
    login: {
      max: env.RATE_LIMIT_LOGIN_MAX,
      windowSeconds: env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
    },
    reset: {
      max: env.RATE_LIMIT_RESET_MAX,
      windowSeconds: env.RATE_LIMIT_RESET_WINDOW_SECONDS,
    },
  },
} as const;
