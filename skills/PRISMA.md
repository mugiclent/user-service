# PRISMA.md — Prisma & Database Conventions

## Version

**Prisma 7** (`prisma` + `@prisma/client` + `@prisma/adapter-pg`).  
`prisma` CLI must be in **`dependencies`** (not `devDependencies`) so it
survives `npm prune --omit=dev` and is available in the production container
for `migrate deploy`.

---

## Schema conventions

- **Field names**: `snake_case` always. Prisma maps to camelCase in the client automatically.
- **Primary keys**: `id  String  @id @default(uuid())` — UUIDs everywhere, no auto-increment integers.
- **Timestamps**: every table gets `created_at DateTime @default(now())`. Tables that change get `updated_at DateTime @updatedAt`.
- **Soft deletes**: use `deleted_at DateTime?` — never hard-delete user or org records.
- **Enums**: define in schema as Prisma enums, not DB strings. Keeps TypeScript types tight.
- **No `url` in datasource block**: Prisma 7 does not require it. Connection is configured in `prisma.config.ts`.

---

## prisma.config.ts

Every service that uses Prisma must have this file at the project root:

```typescript
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

// Prisma 7: connection config lives here, not in schema.prisma.
// DIRECT_DATABASE_URL (db:5432) bypasses PgBouncer — required for migrations
// which use advisory locks and DDL that break under transaction-mode pooling.
// The app runtime uses DATABASE_URL (PgBouncer) via src/models/index.ts.
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env['DIRECT_DATABASE_URL']!,
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
```

### Why two connection strings?

| Variable | Points to | Used by |
|---|---|---|
| `DATABASE_URL` | `pgbouncer:6432` (transaction mode) | App runtime (`src/models/index.ts`) |
| `DIRECT_DATABASE_URL` | `db:5432` (direct PostgreSQL) | Prisma CLI (`migrate dev`, `migrate deploy`) |
| `SHADOW_DATABASE_URL` | `db:5432/{{db_name}}_shadow` | `migrate dev` shadow DB (local only) |

PgBouncer transaction mode breaks migrations — it releases advisory locks between
statements. Migrations must go direct to the DB.

### Shadow database setup

`migrate dev` needs a shadow database to diff against. Pre-create it instead of
granting `CREATEDB` to the app user:

1. Add to `db/init/NN-{{service}}.sql` (alongside the main DB creation):

```sql
SELECT 'CREATE DATABASE {{db_name}}_shadow OWNER {{db_user}}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '{{db_name}}_shadow')\gexec

GRANT ALL PRIVILEGES ON DATABASE {{db_name}}_shadow TO {{db_user}};
```

2. Add to `.env`:
```
SHADOW_DATABASE_URL=postgresql://{{db_user}}:{{password}}@localhost:5432/{{db_name}}_shadow
```

This is idempotent — any new dev machine gets the shadow DB automatically on
first `docker compose up` in the `db/` directory.

---

## Runtime client (src/models/index.ts)

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';

const adapter = new PrismaPg({ connectionString: config.db.url }); // DATABASE_URL
export const prisma = new PrismaClient({ adapter });
```

The adapter goes here, not in `prisma.config.ts`. The config file is CLI-only.

---

## Migration workflow

### Local development

```bash
# After changing schema.prisma — creates a new migration file and applies it
npx prisma migrate dev --name describe_the_change

# Just regenerate the TypeScript client (no DB changes)
npx prisma generate
```

### Production (CI)

```bash
# Apply all pending migration files — no drift detection, no shadow DB
npx prisma migrate deploy
```

`migrate deploy` is what CI runs. It reads pre-committed `.sql` files from
`prisma/migrations/` and applies the ones not yet recorded in `_prisma_migrations`.

### First production deploy (one-time baseline)

If the production DB already has the schema (set up before migrations were
introduced), baseline it so `migrate deploy` doesn't try to recreate tables:

```bash
# Mark the init migration as already applied — does not run any SQL
npx prisma migrate resolve --applied {{migration_name}}
```

In CI, run this with `|| true` before `migrate deploy` — it succeeds on first
deploy, fails harmlessly (already recorded) on subsequent ones:

```yaml
docker run --rm --network katisha-net \
  -e DIRECT_DATABASE_URL="postgresql://..." \
  image:tag \
  npx prisma migrate resolve --applied {{init_migration_name}} || true

docker run --rm --network katisha-net \
  -e DIRECT_DATABASE_URL="postgresql://..." \
  image:tag \
  npm run db:deploy
```

### package.json scripts

```json
"db:migrate":  "prisma migrate dev",
"db:deploy":   "prisma migrate deploy",
"db:generate": "prisma generate"
```

`db:migrate` is local-only. `db:deploy` is what CI calls.

---

## Bootstrap vs seed

| Mechanism | When it runs | What it's for |
|---|---|---|
| `src/loaders/bootstrap.ts` | Every service startup (idempotent upserts) | Canonical platform data — permissions, managed roles, default admin user |
| `prisma/seed.ts` | Manually via `npx prisma db seed` | Local dev fixtures only (fake orgs, sample users, etc.) |

Most services only need `bootstrap.ts`. Only create a `seed.ts` if you need
rich fixture data for local development.

---

## DO NOT

- Do not add `url` to the datasource block in `schema.prisma` — Prisma 7 reads it from `prisma.config.ts`.
- No raw SQL (`prisma.$queryRaw`) unless genuinely unavoidable — document why with a comment.
- No `@default(autoincrement())` on PKs — UUIDs only.
- No nullable required fields — use `?` only for truly optional data.
- No direct Prisma import in controllers or routes — import from `../models` in services only.
- Do not store full URLs in DB (avatar_path, logo_path) — store S3 object keys only.
- Do not run `prisma db push` in production — it has no history, no rollback, and `--accept-data-loss` silently drops columns.
- Do not run `prisma migrate dev` in CI or production — it requires a shadow DB and interactive prompts.
- Do not put `prisma` in `devDependencies` — it must survive `npm prune --omit=dev` for `migrate deploy` to work in the container.
- Never edit a migration file after it has been applied to any environment.
- One migration per logical change — don't bundle unrelated schema changes.
