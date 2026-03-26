# src/loaders/

Startup wiring. Each loader initializes one external concern and is called once
at boot time from `src/index.ts`. Keeping boot logic here prevents it from
scattering across the codebase.

## Files

| File | Purpose |
|---|---|
| `express.ts` | Creates and configures the Express app (middleware stack, routers, error handler) |
| `passport.ts` | Registers the `passport-jwt` strategy |
| `prisma.ts` | Connects the Prisma client and registers the `org_id` scoping `$use` middleware |
| `rabbitmq.ts` | Opens the AMQP connection and channel, exports them for publishers/subscribers |
| `redis.ts` | Creates and exports the ioredis client |

## Conventions

- Each loader exports an `async init*()` function called from `src/index.ts`
- Loaders do not contain business logic — only wiring and connectivity checks
- Connection errors at startup must throw (let the process crash and restart)
- Order in `index.ts`: config validation → DB → Redis → RabbitMQ → Express

## Example

```ts
// src/index.ts
import { initPrisma }   from './loaders/prisma.js';
import { initRedis }    from './loaders/redis.js';
import { initRabbitMQ } from './loaders/rabbitmq.js';
import { createApp }    from './loaders/express.js';

await initPrisma();
await initRedis();
await initRabbitMQ();
const app = createApp();
app.listen(config.port);
```

## Do not

- Import loaders from services or controllers — dependencies flow one way (index → loaders → rest)
- Swallow connection errors — let them bubble so the process exits and restarts
