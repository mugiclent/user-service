// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import Joi from 'joi';
import { normalizePhone } from '../utils/phone.js';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().default(3000),

  // Database
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_HOST: Joi.string().default('pgbouncer'),
  DB_PORT: Joi.number().default(6432),
  // Required only in test env — full URL for test runner (no pgbouncer)
  TEST_DATABASE_URL: Joi.string()
    .uri()
    .when('NODE_ENV', { is: 'test', then: Joi.required() }),

  // Redis
  REDIS_PASSWORD: Joi.string().required(),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().default(6379),

  // RabbitMQ
  RABBITMQ_USER: Joi.string().required(),
  RABBITMQ_PASSWORD: Joi.string().required(),
  RABBITMQ_HOST: Joi.string().default('rabbitmq'),
  RABBITMQ_PORT: Joi.number().default(5672),

  JWT_PRIVATE_KEY: Joi.string().required(), // PEM Ed25519 private key (-----BEGIN PRIVATE KEY-----)
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(7),

  COOKIE_SECURE: Joi.boolean().default(true),
  TRUST_PROXY: Joi.number().integer().min(0).default(1),

  DELETION_GRACE_DAYS: Joi.number().integer().min(1).default(30),

  OTP_TTL_SECONDS: Joi.number().default(300),
  OTP_LENGTH: Joi.number().default(6),
  OTP_MAX_ATTEMPTS: Joi.number().default(3),
  OTP_WINDOW_SECONDS: Joi.number().default(600),

  RATE_LIMIT_LOGIN_MAX: Joi.number().default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: Joi.number().default(900),
  RATE_LIMIT_RESET_MAX: Joi.number().default(3),
  RATE_LIMIT_RESET_WINDOW_SECONDS: Joi.number().default(3600),

  ADMIN_EMAIL: Joi.string().email().required(),
  ADMIN_PHONE: Joi.string().trim().custom((v: string, helpers) => { try { return normalizePhone(v); } catch { return helpers.error('any.invalid'); } }).required(),
  ADMIN_PASSWORD: Joi.string().min(12).required(),

  APP_URL: Joi.string().uri().required(),
  STAFF_APP_URL: Joi.string().uri().required(),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_INTERNAL_ENDPOINT: Joi.string().uri().optional(),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_BUCKET: Joi.string().default('katisha'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_PRESIGNED_EXPIRES_IN: Joi.number().integer().default(300),
});

const { error, value } = schema.validate(process.env, { allowUnknown: true });

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = value as {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  DB_HOST: string;
  DB_PORT: number;
  TEST_DATABASE_URL: string;
  REDIS_PASSWORD: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  RABBITMQ_USER: string;
  RABBITMQ_PASSWORD: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  JWT_PRIVATE_KEY: string;
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  COOKIE_SECURE: boolean;
  TRUST_PROXY: number;
  DELETION_GRACE_DAYS: number;
  OTP_TTL_SECONDS: number;
  OTP_LENGTH: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_WINDOW_SECONDS: number;
  RATE_LIMIT_LOGIN_MAX: number;
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: number;
  RATE_LIMIT_RESET_MAX: number;
  RATE_LIMIT_RESET_WINDOW_SECONDS: number;
  ADMIN_EMAIL: string;
  ADMIN_PHONE: string;
  ADMIN_PASSWORD: string;
  APP_URL: string;
  STAFF_APP_URL: string;
  S3_ENDPOINT: string;
  S3_INTERNAL_ENDPOINT: string | undefined;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_REGION: string;
  S3_PRESIGNED_EXPIRES_IN: number;
};
