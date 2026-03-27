import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().uri().required(),
  TEST_DATABASE_URL: Joi.string()
    .uri()
    .when('NODE_ENV', { is: 'test', then: Joi.required() }),

  REDIS_URL: Joi.string().uri().required(),

  RABBITMQ_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(30),

  COOKIE_SECURE: Joi.boolean().default(true),
  TRUST_PROXY: Joi.number().integer().min(0).default(1),

  OTP_TTL_SECONDS: Joi.number().default(300),
  OTP_LENGTH: Joi.number().default(6),
  OTP_MAX_ATTEMPTS: Joi.number().default(3),
  OTP_WINDOW_SECONDS: Joi.number().default(600),

  RATE_LIMIT_LOGIN_MAX: Joi.number().default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: Joi.number().default(900),
  RATE_LIMIT_RESET_MAX: Joi.number().default(3),
  RATE_LIMIT_RESET_WINDOW_SECONDS: Joi.number().default(3600),

  APP_URL: Joi.string().uri().default('http://localhost:3001'),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().required(),
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
  DATABASE_URL: string;
  TEST_DATABASE_URL: string;
  REDIS_URL: string;
  RABBITMQ_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  COOKIE_SECURE: boolean;
  TRUST_PROXY: number;
  OTP_TTL_SECONDS: number;
  OTP_LENGTH: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_WINDOW_SECONDS: number;
  RATE_LIMIT_LOGIN_MAX: number;
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: number;
  RATE_LIMIT_RESET_MAX: number;
  RATE_LIMIT_RESET_WINDOW_SECONDS: number;
  APP_URL: string;
  S3_ENDPOINT: string;
  S3_PUBLIC_ENDPOINT: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_REGION: string;
  S3_PRESIGNED_EXPIRES_IN: number;
};
