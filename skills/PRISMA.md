# PRISMA.md — Prisma & Database Conventions

## Schema conventions

- **Field names**: `snake_case` always. Prisma maps to camelCase in the client automatically.
- **Primary keys**: `id  String  @id @default(uuid())` — UUIDs everywhere, no auto-increment integers.
- **Timestamps**: every table gets `created_at DateTime @default(now())` and `updated_at DateTime @updatedAt`.
- **Soft deletes**: use `deleted_at DateTime?` — never hard-delete user or org records.
- **Enums**: define in schema as Prisma enums, not DB strings. Keeps TypeScript types tight.

## Example: core models

```prisma
// prisma/schema.prisma

model User {
  id            String    @id @default(uuid())
  first_name    String    @db.VarChar(100)
  last_name     String    @db.VarChar(100)
  phone_number  String    @unique @db.VarChar(20)
  email         String?   @unique @db.VarChar(255)
  password_hash String
  user_type     UserType
  status        UserStatus @default(pending_verification)
  avatar_url    String?
  org_id        String?   // null for passengers
  org           Org?      @relation(fields: [org_id], references: [id])
  refresh_tokens RefreshToken[]
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  deleted_at    DateTime?
}

model RefreshToken {
  id          String    @id @default(uuid())
  token_hash  String    @unique          // SHA-256 of raw token — never store raw
  user_id     String
  user        User      @relation(fields: [user_id], references: [id])
  device_name String?
  expires_at  DateTime
  revoked_at  DateTime?
  created_at  DateTime  @default(now())
}

enum UserType   { passenger staff }
enum UserStatus { active pending_verification suspended }
```

## org_id scoping via Prisma middleware

Staff queries must always be scoped to their org. Apply via Prisma `$use` middleware in the loader.

```ts
// src/loaders/prisma.ts
import { prisma } from '../models';

export const applyOrgScope = (orgId: string | null, userType: string) => {
  if (!orgId || userType === 'passenger') return; // passengers: no scope
  // Attach org scope to the Prisma client instance for this request
  // Use AsyncLocalStorage to pass orgId into the middleware
};

// In the middleware:
prisma.$use(async (params, next) => {
  const orgId = getOrgIdFromContext(); // AsyncLocalStorage
  if (!orgId) return next(params);     // global admin or passenger

  const scopedOps = ['findMany', 'updateMany', 'deleteMany', 'count'];
  if (scopedOps.includes(params.action) && params.model !== 'User') {
    params.args.where = { ...params.args.where, org_id: orgId };
  }
  return next(params);
});
```

**Never** manually add `where: { org_id }` in service code — let the middleware handle it.

## Migrations

```bash
# Always provide a descriptive name
npx prisma migrate dev --name add_refresh_tokens
npx prisma migrate dev --name add_password_reset_tokens
npx prisma migrate dev --name add_org_table
```

- One migration per logical change. Don't bundle unrelated schema changes.
- Never edit a migration file after it has been applied to any environment.
- Run `npx prisma generate` after every schema change to regenerate the client.
- Seed data goes in `prisma/seed.ts`, run via `npx prisma db seed`.

## DO NOT

- No raw SQL (`prisma.$queryRaw`) unless genuinely unavoidable — document why with a comment.
- No `@default(autoincrement())` on PKs — UUIDs only.
- No nullable required fields — use `?` only for truly optional data.
- No direct Prisma import in controllers or routes — import from `../models` in services only.
