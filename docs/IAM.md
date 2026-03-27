# IAM — Identity & Access Management

This document covers the permission system, how it is enforced at runtime, how to extend it when a new resource arrives, and architectural guidance for multi-service deployments.

---

## Table of Contents

1. [Overview](#overview)
2. [Permission Levels](#permission-levels)
3. [Pre-set Roles](#pre-set-roles)
4. [How Runtime Enforcement Works](#how-runtime-enforcement-works)
5. [Adding a New Resource](#adding-a-new-resource)
6. [Adding a New Role](#adding-a-new-role)
7. [Direct User Grants](#direct-user-grants)
8. [API Documentation Strategy](#api-documentation-strategy)
9. [IAM Across Microservices](#iam-across-microservices)
10. [Data Model](#data-model)

---

## Overview

The IAM system is inspired by AWS IAM. The core idea:

- **Permissions** are `(level, subject)` pairs stored in the database — e.g. `manage:User`, `read:Org`.
- **Roles** are named collections of permissions — e.g. `org_admin`, `passenger`.
- **Users** are assigned one or more roles. They can also receive direct permission grants (uncommon).
- At login, all permissions are collected, expanded into CASL rules, and packed into the JWT.
- On every authenticated request, Passport unpacks the rules from the JWT — no database hit for authorization.
- Routes declare the minimum required action+subject with `authorize(action, subject)` middleware. Services handle fine-grained object-level scope.

---

## Permission Levels

| Level | CASL expansion | What it allows |
|-------|---------------|----------------|
| `manage` | `manage` (CASL built-in — covers everything) | create, read, update, delete |
| `write` | `create`, `read`, `update` | create, read, update — **no delete** |
| `read` | `read` | read only |

The expansion happens in `src/utils/ability.ts` → `LEVEL_TO_ACTIONS`.

### Self-only roles (`driver`, `passenger`)

These roles have `write:User` in the DB, but the `create` action is **omitted** at expansion time because a passenger or driver cannot create new user accounts — only their own profile operations are permitted. This is controlled by the `SELF_ONLY_ROLES` set in `ability.ts`.

---

## Pre-set Roles

| Role slug | Permissions | Condition |
|-----------|-------------|-----------|
| `katisha_super_admin` | `manage:all` | None — unrestricted platform-wide |
| `katisha_admin` | `manage:all` | None — unrestricted platform-wide |
| `katisha_support` | `read:User`, `read:Org` | None — can read anything on the platform |
| `org_admin` | `manage:User`, `write:Org` | User: `{ org_id }` · Org: `{ id: orgId }` |
| `dispatcher` | `write:User`, `read:Org` | User: `{ org_id }` · Org: `{ id: orgId }` |
| `driver` | `read+update:User` (no create) | `{ id: userId }` — own profile only |
| `passenger` | `read+update:User` (no create) | `{ id: userId }` — own profile only |

Conditions are applied at rule-build time in `buildRulesForUser` (`src/utils/ability.ts`). They are baked into the JWT and evaluated by CASL against the object returned by the service.

---

## How Runtime Enforcement Works

### Step 1 — Login: rules are built and packed into the JWT

```
collectPermissions(user)           → PermissionEntry[]
buildRulesForUser(id, orgId, …)    → AppRule[]
packRules(rules)                   → compact JSON → JWT payload
```

### Step 2 — Authenticated request: Passport unpacks rules from JWT

```typescript
// src/loaders/passport.ts
const rules = unpackRules<AppRule>(payload.rules);
req.user.rules = rules;
```

No database query. Zero overhead beyond JWT verification.

### Step 3 — Route gate: `authorize(action, subject)`

```typescript
// src/middleware/authorize.ts
export const authorize = (action: Actions, subject: Subjects) =>
  (req, _res, next) => {
    const ability = buildAbilityFromRules(req.user.rules);
    if (!ability.can(action, subject)) return next(new AppError('FORBIDDEN', 403));
    next();
  };
```

`ability.can(action, subject)` returns `true` if **any** rule matches — even a conditioned one. This gate only asks "does this user have this action on this subject at all?". Object-level scoping is left to the service.

### Step 4 — Service: object-level scoping

Services translate CASL conditions into database `where` clauses:

```typescript
// org_admin listing users — scoped to their org
const where: Prisma.UserWhereInput = {};
if (requestingUser.org_id) where.org_id = requestingUser.org_id;
const users = await prisma.user.findMany({ where });
```

For direct object checks (e.g. `GET /organizations/:id`), the service reads the object and compares identity fields against `req.user.org_id`.

---

## Adding a New Resource

Follow these steps every time a new resource (Prisma model) arrives — e.g. `Trip`, `Vehicle`, `Route`.

### 1. Add the subject to the `PermissionSubject` enum

```prisma
// prisma/schema.prisma
enum PermissionSubject {
  User
  Org
  Role
  Trip    // ← new
  all
}
```

Run the migration:

```bash
npx prisma migrate dev --name add_trip_subject
npx prisma generate
```

### 2. Add permission rows to the seed

```typescript
// prisma/seed.ts — PERMISSIONS array
{ level: 'manage', subject: 'Trip' },
{ level: 'write',  subject: 'Trip' },
{ level: 'read',   subject: 'Trip' },
```

### 3. Assign the permissions to the right roles

Update the `ASSIGNMENTS` map in `prisma/seed.ts`:

```typescript
org_admin:  ['manage:User', 'write:Org', 'manage:Trip'],  // org admin manages trips
dispatcher: ['write:User',  'read:Org',  'write:Trip'],   // dispatcher creates/updates trips
driver:     ['write:User',  'read:Trip'],                 // driver reads trips (own, via condition)
passenger:  ['write:User',  'read:Trip'],                 // passenger reads trips (own, via condition)
```

Re-seed: `npm run db:seed`

### 4. Add conditions if the subject needs scoping

If `Trip` records belong to an org or a user, add a condition function in `ROLE_CONDITIONS` in `src/utils/ability.ts`:

```typescript
const ROLE_CONDITIONS = {
  // existing entries…
  org_admin: {
    // existing…
    Trip: (_, orgId) => orgId ? { org_id: orgId } : undefined,
  },
  dispatcher: {
    // existing…
    Trip: (_, orgId) => orgId ? { org_id: orgId } : undefined,
  },
  driver: {
    User: (userId) => ({ id: userId }),
    Trip: (userId) => ({ driver_id: userId }),   // ← driver sees only own trips
  },
  passenger: {
    User: (userId) => ({ id: userId }),
    Trip: (userId) => ({ passenger_id: userId }), // ← passenger sees only own trips
  },
};
```

No migration needed — conditions live in code, not in the database.

### 5. Add `authorize()` to the new routes

```typescript
// src/api/trip.routes.ts
import { authorize } from '../middleware/authorize.js';

router.post('/',    authenticate, authorize('create', 'Trip'), …);
router.get('/',     authenticate, authorize('read',   'Trip'), …);
router.get('/:id',  authenticate, authorize('read',   'Trip'), …);
router.patch('/:id',authenticate, authorize('update', 'Trip'), …);
router.delete('/:id',authenticate,authorize('delete', 'Trip'), …);
```

### 6. Scope queries in the service

Translate CASL conditions to SQL. The pattern used throughout this codebase:

```typescript
const where: Prisma.TripWhereInput = {};

const ability = buildAbilityFromRules(requestingUser.rules);
// Rule conditions give you the hint; apply them in the where clause
if (requestingUser.org_id && !ability.can('manage', 'all')) {
  where.org_id = requestingUser.org_id;
}
// For self-only roles, scope further:
// where.driver_id = requestingUser.id  (or read from the ability condition)

const trips = await prisma.trip.findMany({ where });
```

### 7. Update `Subjects` type in `src/utils/ability.ts`

```typescript
export type Subjects = InferSubjects<typeof User | typeof Org | typeof Trip> | 'all';
```

(Only needed if you use CASL's `subject()` helper with typed model instances. For string-based subjects this is optional.)

### Checklist summary

- [ ] `PermissionSubject` enum updated
- [ ] `prisma migrate dev` + `prisma generate` run
- [ ] New permissions added to `PERMISSIONS` in `seed.ts`
- [ ] Role assignments updated in `ASSIGNMENTS` in `seed.ts`
- [ ] `db:seed` run against dev DB
- [ ] `ROLE_CONDITIONS` updated in `ability.ts` (if scoping needed)
- [ ] `authorize()` added to every new route
- [ ] Service scopes queries to match conditions

---

## Adding a New Role

If a new role is needed (e.g. `finance_admin`):

1. Add it to the `ROLES` array in `prisma/seed.ts`.
2. Add its permission assignments to `ASSIGNMENTS`.
3. If it needs custom conditions, add an entry to `ROLE_CONDITIONS` in `ability.ts`.
4. Re-seed: `npm run db:seed`.

No route changes needed — the `authorize()` gates are permission-based, not role-based.

---

## Direct User Grants

A user can be given a permission directly via the `UserPermission` table, bypassing the role system.

```sql
INSERT INTO user_permissions (user_id, permission_id)
VALUES ('<user-id>', (SELECT id FROM permissions WHERE level = 'manage' AND subject = 'Org'));
```

These grants are:
- **Unconditional** — the `'__direct__'` sentinel in `collectPermissions` has no entry in `ROLE_CONDITIONS`, so the resulting rule carries no `conditions` object (platform-wide access).
- Not the recommended path — prefer assigning a role.
- Picked up at the next login (rules are built at token issuance time).

---

## API Documentation Strategy

**One OpenAPI spec per service.**

Each microservice owns its spec (`openapi.yaml` at the repo root or `docs/openapi.yaml`). An API gateway (Kong, AWS API GW, or a simple aggregator) merges all specs at the platform level — either at build time or via federation (e.g. Swagger UI configured with multiple `urls`).

**Why not a single shared spec?**

- Each service is deployed independently. Updating a shared spec would require cross-repo coordination on every endpoint change.
- Services may be in different languages or frameworks — a single file cannot be generated from one source of truth.
- A gateway-level aggregation (read-only merge) gives you the single developer portal without the coupling.

**Practical setup for Katisha:**

1. Each service has `docs/openapi.yaml` versioned with its code.
2. A lightweight aggregator service (or Kong's dev portal) fetches each spec and serves a unified UI.
3. When a new microservice ships, you add its spec URL to the aggregator — you never touch existing service specs.

The `openapi.yaml` for this service is at [docs/openapi.yaml](openapi.yaml).

---

## IAM Across Microservices

### The question

If a new microservice (e.g. `trip-service`) needs its own resources (`Trip`, `Route`, `Vehicle`), does it:

**A) Register its subjects in user-service** — centralized IAM, user-service knows about Trip, Route, etc.

**B) Build rules locally from role slugs** — each service has its own permission logic, only sharing role slugs from the JWT.

### Recommendation for Katisha: Option B (decentralized, role-slug-based)

The JWT already carries `user_type` and the packed CASL rules. However, the packed rules only cover subjects this service knows about. A `trip-service` cannot rely on rules packed by `user-service` for its own `Trip` subject.

Instead, each service:

1. Reads the **role slugs** or **user_type** from the JWT (these are stable, cross-service identifiers).
2. Maintains its own local `ROLE_CONDITIONS` and `ASSIGNMENTS` equivalent for its own subjects.
3. Seeds its own `Permission`, `Role`, `RolePermission` tables — OR uses a simpler approach of checking role slugs directly if the service is small.

```typescript
// trip-service: authorize based on role slugs from JWT
const roleSlugs: string[] = req.user.role_slugs; // from JWT payload
if (!roleSlugs.includes('org_admin') && !roleSlugs.includes('dispatcher')) {
  throw new AppError('FORBIDDEN', 403);
}
```

For a larger service that warrants the full CASL stack, it replicates the same `Permission`/`Role`/`RolePermission` schema and runs its own seed for its subjects. Role slugs are the shared contract — `org_admin` means the same thing everywhere.

### What user-service always owns

- User creation, authentication, and token issuance.
- The canonical list of role slugs.
- The `User` and `Org` subjects (since those records live here).

### What other services own

- Their own subjects and permission assignments.
- Their own `ROLE_CONDITIONS` for scoping queries.
- They never need to update user-service to add a new resource.

### The shared contract

The JWT payload contains:

```json
{
  "sub": "<user-id>",
  "org_id": "<org-id | null>",
  "user_type": "passenger | staff | driver",
  "role_slugs": ["org_admin"],
  "rules": "[packed CASL rules for user-service subjects only]"
}
```

Other services extract `role_slugs` (or `user_type`) and apply their own rule-building logic. The CASL rules in the JWT are only valid within user-service scope.

> Add `role_slugs` to the JWT payload when the first external microservice is built. It costs nothing and avoids a breaking JWT change later.

---

## Data Model

```
Permission          RolePermission         Role
──────────────      ──────────────────     ──────────────────
id (uuid)           role_id (FK)           id (uuid)
level               permission_id (FK)     name
subject                                    slug
                                           org_id (null = platform role)

UserPermission      UserRole               User
──────────────      ────────────────       ──────────────────
user_id (FK)        user_id (FK)           id (uuid)
permission_id (FK)  role_id (FK)           …
```

Permissions are immutable lookup rows. Role-permission and user-permission assignments are the join tables. Role slugs are the stable cross-service identifiers.
