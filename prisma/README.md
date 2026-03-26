# prisma/

Database schema, migrations, and seed data.

## Files

| File | Purpose |
|---|---|
| `schema.prisma` | Canonical data model — source of truth for the DB schema and Prisma client types |
| `seed.ts` | Seeds development/test data (global admin user, test org) |
| `migrations/` | Auto-generated migration history — never edit manually |

## Common commands

```bash
npx prisma migrate dev --name <description>   # create and apply a new migration
npx prisma migrate deploy                      # apply pending migrations (production)
npx prisma generate                            # regenerate Prisma client after schema change
npx prisma db seed                             # run seed.ts
npx prisma studio                              # open Prisma Studio (DB browser)
```

## Conventions

See [`skills/PRISMA.md`](../skills/PRISMA.md) for the full schema ruleset.

Key rules:
- Migration names must be descriptive: `add_refresh_tokens`, `add_otp_table`
- Never edit a migration file after it has been applied to any environment
- Run `prisma generate` after every `schema.prisma` change
- `seed.ts` is idempotent — safe to run multiple times (use `upsert`)
