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

  JWT_SECRET:          Joi.string().min(32).required(),
  JWT_EXPIRES_IN:      Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(30),

  COOKIE_SECURE:       Joi.boolean().default(true),

  OTP_TTL_SECONDS:     Joi.number().default(300),
  OTP_LENGTH:          Joi.number().default(6),
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
    secret:     env.JWT_SECRET,
    expiresIn:  env.JWT_EXPIRES_IN,
    refreshTtl: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000, // ms
  },

  cookie: {
    secure: env.COOKIE_SECURE,
  },

  otp: {
    ttl:    env.OTP_TTL_SECONDS,
    length: env.OTP_LENGTH,
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

# JWT
JWT_SECRET=change_me_to_at_least_32_random_characters
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_TTL_DAYS=30

# Cookies
COOKIE_SECURE=true

# OTP
OTP_TTL_SECONDS=300
OTP_LENGTH=6
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

Infrastructure (Postgres, Redis, RabbitMQ) is managed externally — this service only runs its own process.
