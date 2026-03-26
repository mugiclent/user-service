import { env } from './env.js';

export const config = {
  port: env.PORT,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  db: {
    url: env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  rabbitmq: {
    url: env.RABBITMQ_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  },

  trustProxy: env.TRUST_PROXY,

  cookie: {
    secure: env.COOKIE_SECURE,
  },

  otp: {
    ttlSeconds: env.OTP_TTL_SECONDS,
    length: env.OTP_LENGTH,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    windowSeconds: env.OTP_WINDOW_SECONDS,
  },

  appUrl: env.APP_URL,

  seaweedfs: {
    filerUrl: env.SEAWEEDFS_FILER_URL,
    publicUrl: env.SEAWEEDFS_PUBLIC_URL,
    maxFileSizeBytes: env.SEAWEEDFS_MAX_FILE_SIZE_MB * 1024 * 1024,
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
