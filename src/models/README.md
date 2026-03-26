# src/models/

Prisma client singleton and any model-level helpers (serializers, type guards).
This is the only place in `src/` that imports `@prisma/client` directly.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Exports the shared `prisma` client instance |
| `serializers.ts` | `serializeUser()` and other functions that strip sensitive fields before sending to clients |

## Conventions

See [`skills/PRISMA.md`](../../skills/PRISMA.md).

Key rules:
- Import `prisma` from here (`../models/index.js`), never directly from `@prisma/client`
- `serializeUser()` must always omit `password_hash`, `deleted_at`, and internal fields
- The Prisma `$use` middleware for `org_id` scoping is registered in `src/loaders/prisma.ts`,
  not here

## Example

```ts
// src/models/index.ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();

// usage in a service
import { prisma } from '../models/index.js';
const user = await prisma.user.findFirst({ where: { id } });
```

## Do not

- Instantiate `new PrismaClient()` anywhere outside `src/models/index.ts`
- Return raw Prisma model objects to controllers — always serialize first
