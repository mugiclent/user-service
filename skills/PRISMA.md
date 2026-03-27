# PRISMA.md — Prisma & Database Conventions

## Schema conventions

- **Field names**: `snake_case` always. Prisma maps to camelCase in the client automatically.
- **Primary keys**: `id  String  @id @default(uuid()) @db.Uuid` — UUIDs everywhere, no auto-increment integers.
- **Timestamps**: every table gets `created_at DateTime @default(now())` and `updated_at DateTime @updatedAt`.
- **Soft deletes**: use `deleted_at DateTime?` — never hard-delete user or org records.
- **Enums**: define in schema as Prisma enums, not DB strings. Keeps TypeScript types tight.

## Core models

```prisma
// prisma/schema.prisma

model User {
  id            String    @id @default(uuid()) @db.Uuid
  first_name    String    @db.VarChar(100)
  last_name     String    @db.VarChar(100)
  phone_number  String?   @unique @db.VarChar(20)
  email         String?   @unique @db.VarChar(255)
  password_hash String
  user_type     UserType
  status        UserStatus @default(pending_verification)
  avatar_path   String?    // S3 object key only — e.g. "avatars/user-id/uuid.jpg"
                           // Frontend builds URL: CDN_URL + "/" + avatar_path
  two_factor_enabled Boolean @default(false)
  org_id        String?   @db.Uuid  // null for passengers
  org           Org?      @relation(fields: [org_id], references: [id])
  user_roles    UserRole[]
  user_permissions UserPermission[]
  refresh_tokens RefreshToken[]
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  deleted_at    DateTime?

  @@map("users")
}

model Org {
  id            String    @id @default(uuid()) @db.Uuid
  name          String
  slug          String    @unique
  org_type      String
  status        OrgStatus @default(pending)
  logo_path     String?   // S3 object key only — e.g. "logos/org-id/uuid.png"
  contact_email String?
  contact_phone String?
  parent_org_id String?   @db.Uuid
  parent_org    Org?      @relation("OrgToOrg", fields: [parent_org_id], references: [id])
  child_orgs    Org[]     @relation("OrgToOrg")
  approved_by   String?
  approved_at   DateTime?
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  deleted_at    DateTime?

  @@map("organizations")
}

model RefreshToken {
  id          String    @id @default(uuid()) @db.Uuid
  token_hash  String    @unique          // SHA-256 of raw token — never store raw
  user_id     String    @db.Uuid
  user        User      @relation(fields: [user_id], references: [id])
  device_name String?
  expires_at  DateTime
  revoked_at  DateTime?
  created_at  DateTime  @default(now())

  @@map("refresh_tokens")
}
```

## IAM models

```prisma
enum PermissionLevel {
  manage  // CASL 'manage' — covers all actions including delete
  write   // expands to: create, read, update
  read    // read only
}

enum PermissionSubject {
  User
  Org
  Role
  all   // wildcard — used by super_admin
}

model Permission {
  id      String            @id @default(uuid()) @db.Uuid
  level   PermissionLevel
  subject PermissionSubject

  role_permissions RolePermission[]
  user_permissions UserPermission[]

  @@unique([level, subject])
  @@map("permissions")
}

model Role {
  id    String   @id @default(uuid()) @db.Uuid
  name  String
  slug  String   @unique
  org_id String? @db.Uuid  // null = platform role; set = org-specific role

  user_roles       UserRole[]
  role_permissions RolePermission[]

  @@map("roles")
}

model UserRole {
  user_id String @db.Uuid
  role_id String @db.Uuid
  user    User   @relation(fields: [user_id], references: [id], onDelete: Cascade)
  role    Role   @relation(fields: [role_id], references: [id], onDelete: Cascade)

  @@id([user_id, role_id])
  @@map("user_roles")
}

model RolePermission {
  role_id       String @db.Uuid
  permission_id String @db.Uuid
  role          Role       @relation(fields: [role_id], references: [id], onDelete: Cascade)
  permission    Permission @relation(fields: [permission_id], references: [id], onDelete: Cascade)

  @@id([role_id, permission_id])
  @@map("role_permissions")
}

model UserPermission {
  user_id       String @db.Uuid
  permission_id String @db.Uuid
  user          User       @relation(fields: [user_id], references: [id], onDelete: Cascade)
  permission    Permission @relation(fields: [permission_id], references: [id], onDelete: Cascade)

  @@id([user_id, permission_id])
  @@map("user_permissions")
}
```

## UserWithRoles — include shape for token building

Used in `token.service.ts`, `auth.service.ts`, `user.service.ts`, and `passport.ts`:

```ts
const withRoles = {
  include: {
    user_roles: {
      include: {
        role: {
          include: {
            role_permissions: { include: { permission: true } },
          },
        },
      },
    },
    user_permissions: { include: { permission: true } },
  },
} as const;
```

## Migrations

```bash
# Always provide a descriptive name
npx prisma migrate dev --name add_refresh_tokens
npx prisma migrate dev --name add_iam_permissions

# Regenerate client after every schema change
npx prisma generate

# Seed pre-set roles and permissions
npm run db:seed
```

- One migration per logical change. Don't bundle unrelated schema changes.
- Never edit a migration file after it has been applied to any environment.
- Seed data goes in `prisma/seed.ts`, run via `npx prisma db seed`.

## Pre-set roles (seeded)

| Role | Permissions | DB conditions |
|---|---|---|
| `katisha_super_admin` | manage: all | none |
| `katisha_admin` | manage: all | none |
| `katisha_support` | read: User, Org | none |
| `org_admin` | manage: User, write: Org | User→`{org_id}`, Org→`{id:orgId}` |
| `dispatcher` | write: User, read: Org | User→`{org_id}`, Org→`{id:orgId}` |
| `driver` | read+update: User (no create) | `{id:userId}` |
| `passenger` | read+update: User (no create) | `{id:userId}` |

Conditions are applied at runtime in `buildRulesForUser` (not stored in DB).

## DO NOT

- No raw SQL (`prisma.$queryRaw`) unless genuinely unavoidable — document why with a comment.
- No `@default(autoincrement())` on PKs — UUIDs only.
- No nullable required fields — use `?` only for truly optional data.
- No direct Prisma import in controllers or routes — import from `../models` in services only.
- Do not store full URLs in DB (avatar_path, logo_path) — store S3 object keys only.
