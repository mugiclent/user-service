# CONFIG.md — Configuration & Environment Conventions

## Principle: Fail fast at startup

All environment variables are validated with Joi when the process starts. If a required variable is missing or malformed, the service **crashes immediately** with a clear error — never silently falls back to a default in production.

## env.ts — the single source of truth

```ts
// src/config/env.ts
import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV:            Joi.string().valid('development', 'test', 'production').required(),
  PORT:                Joi.number().default(3000),

  DATABASE_URL:        Joi.string().uri().required(),
  TEST_DATABASE_URL:   Joi.string().uri().when('NODE_ENV', { is: 'test', then: Joi.required() }),

  REDIS_URL:           Joi.string().uri().required(),

  RABBITMQ_URL:        Joi.string().uri().required(),

  // RS256 asymmetric JWT — private key signs, public key verifies
  JWT_PRIVATE_KEY:     Joi.string().required(), // PEM RSA private key
  JWT_PUBLIC_KEY:      Joi.string().required(), // PEM RSA public key
  JWT_EXPIRES_IN:      Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(30),

  COOKIE_SECURE:       Joi.boolean().default(true),

  OTP_TTL_SECONDS:     Joi.number().default(300),
  OTP_LENGTH:          Joi.number().default(6),

  // S3-compatible object storage (SeaweedFS)
  S3_ENDPOINT:         Joi.string().uri().required(), // internal (Docker) — server-side deletes
  S3_PUBLIC_ENDPOINT:  Joi.string().uri().required(), // browser-reachable — embedded in presigned URLs
  S3_ACCESS_KEY:       Joi.string().required(),
  S3_SECRET_KEY:       Joi.string().required(),
  S3_BUCKET:           Joi.string().default('katisha'),
  S3_REGION:           Joi.string().default('us-east-1'),
  S3_PRESIGNED_EXPIRES_IN: Joi.number().integer().default(300), // seconds
}).unknown(false); // reject undeclared env vars in strict mode (set to true in prod)

const { error, value } = schema.validate(process.env, { allowUnknown: true });
if (error) throw new Error(`Config validation error: ${error.message}`);

export const env = value as { /* typed fields */ };
```

## config/index.ts — the exported config object

```ts
// src/config/index.ts
import { env } from './env';

export const config = {
  port:   env.PORT,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  db: {
    url: env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  },

  redis: { url: env.REDIS_URL },

  rabbitmq: { url: env.RABBITMQ_URL },

  jwt: {
    // PEM keys — replace literal \n from .env with real newlines
    privateKey: env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    publicKey:  env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
    expiresIn:  env.JWT_EXPIRES_IN,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  },

  cookie: {
    secure: env.COOKIE_SECURE,
  },

  otp: {
    ttlSeconds: env.OTP_TTL_SECONDS,
    length:     env.OTP_LENGTH,
  },

  s3: {
    endpoint:          env.S3_ENDPOINT,
    publicEndpoint:    env.S3_PUBLIC_ENDPOINT,
    accessKey:         env.S3_ACCESS_KEY,
    secretKey:         env.S3_SECRET_KEY,
    bucket:            env.S3_BUCKET,
    region:            env.S3_REGION,
    presignedExpiresIn: env.S3_PRESIGNED_EXPIRES_IN,
  },
} as const;
```

## Rules

- **`process.env` is only accessed inside `/src/config/env.ts`**. Everywhere else, import from `../config`.
- **`.env.example` is the source of truth** for what variables are needed. Keep it in sync with `env.ts` — add a new variable to both at the same time.
- **Never commit `.env`** — only `.env.example`.
- **Test DB** uses a separate `TEST_DATABASE_URL` — never run tests against the development database.

## .env.example

```env
NODE_ENV=development
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/katisha_users
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/katisha_users_test

# Redis (rate limiting + OTP TTL)
REDIS_URL=redis://localhost:6379

# RabbitMQ (audit logs + notification service events)
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# JWT — RS256 asymmetric signing
# Generate: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem
# Store PEM as single-line with literal \n separators
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_TTL_DAYS=30

# Cookies
COOKIE_SECURE=true

# OTP
OTP_TTL_SECONDS=300
OTP_LENGTH=6

# S3 / SeaweedFS
# S3_ENDPOINT = Docker-internal hostname (server-side deletes)
# S3_PUBLIC_ENDPOINT = browser-reachable hostname (embedded in presigned URLs)
S3_ENDPOINT=http://seaweedfs:8333
S3_PUBLIC_ENDPOINT=http://localhost:8333
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET=katisha
S3_REGION=us-east-1
S3_PRESIGNED_EXPIRES_IN=300
```

## Dockerfile (service only — no docker-compose)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Infrastructure (Postgres, Redis, RabbitMQ, SeaweedFS) is managed externally — this service only runs its own process.
