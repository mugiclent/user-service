
```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║        ██╗ █████╗ ███╗   ███╗    ██████╗ ███████╗███████╗██╗ ██████╗███╗  ██╗║
║        ██║██╔══██╗████╗ ████║    ██╔══██╗██╔════╝██╔════╝██║██╔════╝████╗ ██║║
║        ██║███████║██╔████╔██║    ██║  ██║█████╗  ███████╗██║██║  ███╗██╔██╗██║║
║   ██   ██║██╔══██║██║╚██╔╝██║    ██║  ██║██╔══╝  ╚════██║██║██║   ██║██║╚████║║
║   ╚█████╔╝██║  ██║██║ ╚═╝ ██║    ██████╔╝███████╗███████║██║╚██████╔╝██║ ╚███║║
║    ╚════╝ ╚═╝  ╚═╝╚═╝     ╚═╝    ╚═════╝ ╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝║
║                                                                               ║
║              Identity & Access Management — Katisha User Service              ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

> **The complete reference for how Katisha decides who can do what, on what, and how broadly.**

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Core Concepts](#2-core-concepts)
   - [Permissions — The Catalog](#21-permissions--the-catalog)
   - [Grants — The Rules](#22-grants--the-rules)
   - [Roles — The Bundles](#23-roles--the-bundles)
3. [The Full Permission Catalog](#3-the-full-permission-catalog)
4. [Scopes — How Broadly You Can See](#4-scopes--how-broadly-you-can-see)
5. [Grant Patterns — The Wildcard System](#5-grant-patterns--the-wildcard-system)
6. [Managed Roles](#6-managed-roles)
7. [How It All Flows at Runtime](#7-how-it-all-flows-at-runtime)
8. [JWT Payload — What Goes in the Token](#8-jwt-payload--what-goes-in-the-token)
9. [Privilege Escalation Prevention](#9-privilege-escalation-prevention)
10. [Adding a New Resource](#10-adding-a-new-resource)
11. [Creating Custom Org Roles](#11-creating-custom-org-roles)
12. [Direct User Grants](#12-direct-user-grants)
13. [IAM Across Microservices](#13-iam-across-microservices)
14. [Data Model](#14-data-model)

---

## 1. The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THE KATISHA IAM STACK                               │
│                                                                             │
│   WHAT can be done?          HOW BROADLY?            WHO does it?           │
│   ─────────────────          ───────────             ────────────           │
│                                                                             │
│   ┌─────────────┐    +    ┌────────────┐    =    ┌────────────────┐        │
│   │ PERMISSION  │         │   SCOPE    │         │    GRANT       │        │
│   │             │         │            │         │                │        │
│   │ user:read   │    +    │    org     │    =    │ user:read:org  │        │
│   │ org:approve │    +    │  platform  │    =    │org:approve:... │        │
│   └─────────────┘         └────────────┘         └────────────────┘        │
│                                                          │                  │
│                                                          │ bundled into     │
│                                                          ▼                  │
│                                                   ┌────────────┐           │
│                                                   │    ROLE    │           │
│                                                   │  org-admin │           │
│                                                   │  passenger │           │
│                                                   └────────────┘           │
│                                                          │                  │
│                                                          │ assigned to      │
│                                                          ▼                  │
│                                                   ┌────────────┐           │
│                                                   │    USER    │           │
│                                                   └────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

Think of it like a **building access system**:

- A **Permission** is a type of door: `read:User` = "can open the People Directory door"
- A **Scope** is the floor level: `own` = your office, `org` = your entire company, `platform` = the whole building
- A **Grant** is a specific key card: `user:read:org` = "People Directory door, company floor only"
- A **Role** is a key ring: `org-admin` = all the key cards an org admin needs
- **Assigning a Role** is giving someone that key ring on their first day

---

## 2. Core Concepts

### 2.1 Permissions — The Catalog

```
┌─────────────────────────────────────────────────────────┐
│                     PERMISSION                          │
│                                                         │
│   code:         user:read                               │
│   action:       read                ← the verb          │
│   subject:      User                ← the noun          │
│   display_name: "View users"                            │
│   group:        "User management"                       │
│                                                         │
│   Valid scopes: own | org | platform                    │
└─────────────────────────────────────────────────────────┘
```

A **Permission** answers: *"what action can be performed on what resource?"*

It is **scope-agnostic** — it does not say whether you can read one user or all users. That is the scope's job.

Permissions are seeded once at startup by `src/loaders/bootstrap.ts` and never change unless a new feature is built. **Only the platform (via code deployment) can add, change, or remove permissions.** Nobody with a database account can create new permission types.

---

### 2.2 Grants — The Rules

```
┌──────────────────────────────────────────────────────────────┐
│                         GRANT                                │
│                                                              │
│   pattern:    "user:read:org"                                │
│               ──── ──── ───                                  │
│               │    │    └── scope   (own | org | platform)   │
│               │    └─────── action  (read, update, *)        │
│               └──────────── subject (user, org, *, ...)      │
│                                                              │
│   is_managed: true   ← platform-seeded, cannot be deleted   │
│                                                              │
│   Lives on:  role_grants (role_id, pattern)                  │
│              user_grants (user_id, pattern)                  │
└──────────────────────────────────────────────────────────────┘
```

A **Grant** answers: *"what permission, and how broadly?"*

Grants support **wildcards** in the subject and action positions:

```
user:read:org      →  read users within your org           (specific)
user:*:org         →  do anything to users within your org (action wildcard)
*:*:org            →  do anything to anything within org   (full wildcard)
*:*:platform       →  do anything to anything, everywhere  (god mode)
```

> **Scope is never a wildcard.** You must always be explicit about how broadly a grant applies.

---

### 2.3 Roles — The Bundles

```
┌────────────────────────────────────────────────────────────────┐
│                           ROLE                                 │
│                                                                │
│   slug:       org-admin                                        │
│   org_id:     null        ← null = global template            │
│   is_managed: true        ← platform-seeded, cannot be edited  │
│                                                                │
│   Grants:                                                      │
│   ┌────────────────┐  ┌────────────────┐                       │
│   │  *:*:org       │  │  org:read:own  │                       │
│   └────────────────┘  └────────────────┘                       │
│         │                    │                                 │
│         └───── 2 rows in role_grants ────┘                     │
│                  (not 22 individual policy rows)                │
└────────────────────────────────────────────────────────────────┘
```

A **Role** answers: *"who gets which grants?"*

Roles with `org_id = null` are **global templates** — any org can assign them to their members. Orgs can also create their own **custom roles** with `org_id = their_id`, built from explicit grant patterns.

---

## 3. The Full Permission Catalog

> 26 permissions seeded at startup. Grouped by resource.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: User Management                                      ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `user:read` | read | View user profile information | `own` `org` `platform` |
| `user:update` | update | Edit user profile fields | `own` `org` `platform` |
| `user:delete` | delete | Soft-delete a user account | `own` `org` `platform` |
| `user:invite` | invite | Send invitations to new users | `org` `platform` |
| `user:suspend` | suspend | Suspend or reactivate a user account | `org` `platform` |
| `user:assign_role` | assign_role | Assign or revoke roles for a user | `org` `platform` |

> `user:invite` has no `own` scope — you cannot invite yourself. `user:delete:own` means a user can delete their own account.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Organisation Management                              ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `org:read` | read | View organisation profile | `own` `org` `platform` |
| `org:create` | create | Register a new organisation | `platform` |
| `org:update` | update | Edit organisation details | `org` `platform` |
| `org:delete` | delete | Soft-delete an organisation | `platform` |
| `org:approve` | approve | Approve or reject an org application | `org` `platform` |
| `org:suspend` | suspend | Suspend or reactivate an organisation | `org` `platform` |

> `org:create` and `org:delete` are **platform-only** — no org can self-register or self-delete through the permission system. `org:approve:org` allows a cooperative head to approve member companies within their cooperative.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Role Management                                      ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `role:read` | read | List and inspect roles and their grants | `org` `platform` |
| `role:create` | create | Define new custom roles | `org` `platform` |
| `role:update` | update | Modify role name or grant assignments | `org` `platform` |
| `role:delete` | delete | Remove a role definition | `org` `platform` |

> No `own` scope on roles — roles are never "yours personally", they belong to the org or platform.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Invitation Management                                ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `invitation:read` | read | List pending and accepted invitations | `org` `platform` |
| `invitation:update` | update | Resend or change role on a pending invitation | `org` `platform` |
| `invitation:delete` | delete | Cancel a pending invitation | `org` `platform` |

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Media                                                ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `media_asset:upload` | upload | Obtain a presigned URL to upload images or files | `own` `org` `platform` |
| `media_asset:delete` | delete | Remove a media asset | `own` `org` `platform` |

> Media assets are public by default — there is no `read` permission. `own` scope means you can upload/delete your own avatar. `org` scope means an org admin can manage media for their org members.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Org Documents                                        ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `org_document:read` | read | Obtain a presigned URL to download a sensitive org document | `org` `platform` |
| `org_document:upload` | upload | Obtain a presigned URL to upload an org document | `org` `platform` |
| `org_document:delete` | delete | Remove an org document record | `org` `platform` |

> Unlike media assets, org documents (business certificates, rep IDs) are **private by default** — hence the explicit `read` permission. No `own` scope because documents belong to the org, not an individual.

---

```
╔══════════════════════════════════════════════════════════════╗
║  GROUP: Audit                                                ║
╚══════════════════════════════════════════════════════════════╝
```

| Code | Action | Description | Valid Scopes |
|---|---|---|---|
| `audit_log:read` | read | Query the audit trail | `org` `platform` |
| `audit_log:export` | export | Download audit log data as CSV or JSON | `org` `platform` |

> `audit_log:export` is separated from `read` because exporting raw logs at scale is a sensitive operation — you might grant an org admin `read` but reserve `export` for platform-level compliance officers.

---

## 4. Scopes — How Broadly You Can See

```
                        SCOPE HIERARCHY
                        ───────────────

    platform ──────────────────────────────────────────────────────┐
    │  Can see and act on every record across the entire platform   │
    │                                                               │
    │   org ──────────────────────────────────────────────────┐    │
    │   │  Can see and act on records within your org only    │    │
    │   │                                                     │    │
    │   │   own ─────────────────────────────────────────┐   │    │
    │   │   │  Can only see and act on your own record   │   │    │
    │   │   └────────────────────────────────────────────┘   │    │
    │   └─────────────────────────────────────────────────────┘    │
    └──────────────────────────────────────────────────────────────┘

    Rank:   own = 0  <  org = 1  <  platform = 2
```

### How scope translates to database conditions

| Subject | `own` condition | `org` condition | `platform` condition |
|---|---|---|---|
| `User` | `{ id: userId }` | `{ org_id: orgId }` | *(none)* |
| `Org` | `{ id: orgId }` | `{ id: orgId }` | *(none)* |
| `Role` | — | `{ org_id: orgId }` | *(none)* |
| `Invitation` | — | `{ org_id: orgId }` | *(none)* |
| `MediaAsset` | `{ id: userId }` | `{ org_id: orgId }` | *(none)* |
| `OrgDocument` | — | `{ org_id: orgId }` | *(none)* |
| `AuditLog` | — | `{ org_id: orgId }` | *(none)* |

These conditions are baked into the **CASL rules inside the JWT**. When a service asks `ability.can('read', userRecord)`, CASL checks the record's fields against the condition automatically — no manual `if` statement needed.

---

## 5. Grant Patterns — The Wildcard System

```
╔═══════════════════════════════════════════════════════════════════╗
║                     PATTERN ANATOMY                               ║
║                                                                   ║
║    *  :  *  :  platform                                           ║
║    │     │     │                                                  ║
║    │     │     └── SCOPE  (always explicit: own | org | platform) ║
║    │     └──────── ACTION (specific action or * for all)          ║
║    └────────────── SUBJECT (snake_case subject or * for all)      ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### Wildcard expansion examples

| Pattern stored in DB | Expands to | CASL rules in JWT |
|---|---|---|
| `*:*:platform` | Every permission at platform scope | `can('manage', 'all')` — **1 rule** |
| `*:*:org` | Every permission at org scope | `can('manage', Subject, {org_id})` per subject — **7 rules** |
| `user:*:org` | All user permissions at org scope | `can('manage', 'User', {org_id})` — **1 rule** |
| `user:read:org` | Read users at org scope | `can('read', 'User', {org_id})` — **1 rule** |
| `audit_log:read:org` | Read audit logs at org scope | `can('read', 'AuditLog', {org_id})` — **1 rule** |
| `org:read:own` | Read own org | `can('read', 'Org', {id: orgId})` — **1 rule** |

### Why `manage` in CASL?

`manage` is CASL's built-in wildcard action — it covers every action. So instead of emitting 6 separate rules for `read`, `update`, `delete`, `invite`, `suspend`, `assign_role` on User, a single `can('manage', 'User', ...)` rule covers all of them. This is what keeps the JWT tiny.

```
Without wildcards:  26 rules in the JWT for platform-admin
With *:*:platform:   1 rule in the JWT  ← can('manage', 'all')

Without wildcards:  22 rules for org-admin
With *:*:org + org:read:own:  8 rules
```

### Wildcard validation rules

1. **Scope cannot be `*`** — you must always be explicit about how broadly something applies.
2. A pattern is only valid if it matches at least one entry in the permission catalog for the given scope.
   - `org:create:org` is **invalid** — `org:create` only has `platform` scope, not `org`.
   - `audit_log:*:own` is **invalid** — audit logs have no `own` scope.

---

## 6. Managed Roles

> **Managed roles** (`is_managed = true`) are global templates seeded by the platform. They cannot be edited or deleted via the API. They have `org_id = null` — no org owns them.

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ROLE: passenger                                                         ║
║  ─────────────────────────────────────────────────────────────────────  ║
║  For: every registered passenger                                         ║
║  Analogy: a library card — lets you browse, borrow, and manage your      ║
║           own shelf. Nothing more.                                       ║
║                                                                          ║
║  Grants:                                                                 ║
║    user:*:own          → read, update, delete your own account           ║
║    media_asset:*:own   → upload and delete your own avatar               ║
║                                                                          ║
║  JWT rules: 2 rules                                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  ROLE: driver                                                            ║
║  ─────────────────────────────────────────────────────────────────────  ║
║  For: transport company or cooperative drivers                           ║
║  Analogy: an employee badge — same self-service as a passenger, but also ║
║           lets you see your company's notice board (org profile).        ║
║                                                                          ║
║  Grants:                                                                 ║
║    user:*:own          → read, update, delete your own account           ║
║    media_asset:*:own   → upload and delete your own avatar               ║
║    org:read:own        → view your own organisation profile              ║
║                                                                          ║
║  JWT rules: 3 rules                                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  ROLE: dispatcher                                                        ║
║  ─────────────────────────────────────────────────────────────────────  ║
║  For: the person who assigns trips and manages the driver pool daily     ║
║  Analogy: a floor manager — can see the team, onboard new hires,         ║
║           suspend troublemakers, and check the attendance log.           ║
║           Cannot touch org settings or payroll (roles/documents).        ║
║                                                                          ║
║  Grants:                                                                 ║
║    user:read:org       → view all users in your org                      ║
║    user:invite:org     → invite new drivers to your org                  ║
║    user:suspend:org    → suspend a driver in your org                    ║
║    invitation:*:org    → manage invitations in your org                  ║
║    audit_log:read:org  → view your org's activity log                    ║
║                                                                          ║
║  JWT rules: 5 rules                                                      ║
╚══════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  ROLE: org-admin                                                         ║
║  ─────────────────────────────────────────────────────────────────────  ║
║  For: the owner or director of a transport company / cooperative         ║
║  Analogy: a company director — full control over everything within the   ║
║           company walls. Cannot touch other companies or the platform.   ║
║                                                                          ║
║  Grants:                                                                 ║
║    *:*:org             → do anything to anything within your org         ║
║    org:read:own        → also read your own org profile                  ║
║                                                                          ║
║  JWT rules: 8 rules  (vs 22 if listed individually)                      ║
╚══════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  ROLE: platform-admin                                                    ║
║  ─────────────────────────────────────────────────────────────────────  ║
║  For: Katisha internal operations team                                   ║
║  Analogy: the building owner — a master key that opens every door on     ║
║           every floor. Full unrestricted access to the whole platform.   ║
║                                                                          ║
║  Grants:                                                                 ║
║    *:*:platform        → do anything to anything, everywhere             ║
║                                                                          ║
║  JWT rules: 1 rule   can('manage', 'all')                                ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 7. How It All Flows at Runtime

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE FULL REQUEST LIFECYCLE                        │
└─────────────────────────────────────────────────────────────────────────────┘

  ① LOGIN
  ────────
  Client sends credentials → user-service validates → loads user from DB

  DB query includes:
    user_roles → role → role_grants   (patterns like "*:*:org")
    user_grants                        (direct one-off patterns)

  Collect all unique patterns from roles + direct grants:
    ["*:*:org", "org:read:own"]

  Expand each pattern into CASL rules:
    "*:*:org"      → can('manage', 'User',        {org_id: '...'})
                     can('manage', 'Org',          {id:     '...'})
                     can('manage', 'Role',         {org_id: '...'})
                     can('manage', 'Invitation',   {org_id: '...'})
                     can('manage', 'MediaAsset',   {org_id: '...'})
                     can('manage', 'OrgDocument',  {org_id: '...'})
                     can('manage', 'AuditLog',     {org_id: '...'})
    "org:read:own" → can('read',   'Org',          {id:     '...'})

  packRules(rules) → compact binary → JWT payload
  JWT signed with Ed25519 private key → returned to client


  ② AUTHENTICATED REQUEST
  ────────────────────────
  Client sends JWT in Authorization header (or HttpOnly cookie)

  api-gw validates JWT → strips Authorization header → injects:
    X-User-ID:    <sub from JWT>
    X-User-Type:  staff
    X-Org-ID:     <org_id from JWT>
    X-User-Roles: ["org-admin"]
    X-User-Rules: <packed rules from JWT>

  Proxies request to user-service


  ③ MIDDLEWARE (authenticate)
  ────────────────────────────
  Reads injected headers → reconstructs req.user:
    {
      id:         "uuid",
      org_id:     "uuid",
      user_type:  "staff",
      role_slugs: ["org-admin"],
      rules:      unpackRules(X-User-Rules)   ← CASL rules, no DB hit
    }


  ④ ROUTE GATE (authorize middleware)
  ─────────────────────────────────────
  authorize('update', 'User') checks:
    ability.can('update', 'User')
      → true if any rule grants update on User (even conditionally)
      → false → 403 FORBIDDEN immediately

  This gate is cheap — it only asks "does this user have this action at all?"
  Object-level scoping is left to the service.


  ⑤ SERVICE LOGIC (object-level check)
  ──────────────────────────────────────
  The service fetches the target record and either:

  A) Uses CASL conditions in a Prisma where-clause (list operations):
       const ability = buildAbilityFromRules(req.user.rules);
       const where = accessibleBy(ability, 'update').User;
       const users = await prisma.user.findMany({ where });

  B) Checks a specific record directly (single operations):
       const user = await prisma.user.findUniqueOrThrow({ where: { id } });
       if (!ability.can('update', user)) throw new AppError('FORBIDDEN', 403);

  The CASL condition { org_id: '...' } is checked against the actual record
  automatically — no manual comparison needed.
```

---

## 8. JWT Payload — What Goes in the Token

```json
{
  "sub":        "3f7a1c2d-...",
  "org_id":     "b9e12f4a-...",
  "user_type":  "staff",
  "role_slugs": ["org-admin"],
  "rules":      [[1,"manage","User",{"org_id":"b9e12f4a-..."}],
                 [1,"manage","Org", {"id":"b9e12f4a-..."}],
                 ...],
  "iat":        1712345678,
  "exp":        1712346578
}
```

### Token characteristics

| Property | Value |
|---|---|
| Algorithm | EdDSA (Ed25519) |
| TTL | 15 minutes |
| Refresh TTL | 7 days (stored hashed in DB) |
| Rules format | `packRules()` from `@casl/ability/extra` — compact binary array |
| Staleness | Rules are stale after TTL — privilege changes take up to 15 min to propagate |

### Emergency revocation

If a role is removed from a user and the 15-min window is unacceptable, the service writes the user's ID to Redis with a 15-min TTL. The `authenticate` middleware checks this blocklist before trusting the JWT.

---

## 9. Privilege Escalation Prevention

```
┌─────────────────────────────────────────────────────────────────────┐
│                   THE ESCALATION RULE                               │
│                                                                     │
│   You can only grant what you yourself have.                        │
│                                                                     │
│   If your highest scope is ORG  → you can grant up to  :org         │
│   If your highest scope is OWN  → you can grant up to  :own         │
│   If your highest scope is PLATFORM → you can grant anything        │
│                                                                     │
│   An org-admin with  *:*:org  cannot grant  user:read:platform      │
│   because that exceeds their own ceiling.                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Enforced at the service layer when:**

1. Creating or updating a custom role (assigning grant patterns to a role)
2. Assigning a role to another user
3. Adding a direct `UserGrant` to a user

```typescript
// pseudocode — role service
const callerMaxScope = maxScopeFromPatterns(caller.patterns);
for (const pattern of requestedPatterns) {
  const patternScope = pattern.split(':')[2] as PermissionScope;
  if (SCOPE_RANK[patternScope] > SCOPE_RANK[callerMaxScope]) {
    throw new AppError('FORBIDDEN', 403, 'Cannot grant scope exceeding your own');
  }
  if (!isValidPattern(pattern, PERMISSIONS)) {
    throw new AppError('VALIDATION_ERROR', 422, `Invalid pattern: ${pattern}`);
  }
}
```

---

## 10. Adding a New Resource

When a new feature introduces a new resource (e.g. `Trip`), follow this checklist:

### Step 1 — Add to `PermissionAction` or `PermissionSubject` enums in schema

```prisma
// prisma/schema.prisma
enum PermissionSubject {
  User
  Org
  Role
  Invitation
  MediaAsset
  OrgDocument
  AuditLog
  Trip          // ← add here
}
```

Run `db:push` and regenerate the client:

```bash
npm run db:push
npx prisma generate
```

### Step 2 — Add permission entries to `bootstrap.ts`

```typescript
// src/loaders/bootstrap.ts — PERMISSIONS array
{
  action: 'read',
  subject: 'Trip',
  display_name: 'View trips',
  description: 'Read trip records',
  group: 'Trip management',
  scopes: ['own', 'org', 'platform'],
},
{
  action: 'update',
  subject: 'Trip',
  display_name: 'Edit trips',
  description: 'Update trip details',
  group: 'Trip management',
  scopes: ['own', 'org', 'platform'],
},
```

### Step 3 — Add scope conditions in `ability.ts`

```typescript
// src/utils/ability.ts — scopeToCondition()
// scope === 'org'
if (subject === 'Trip') return orgId ? { org_id: orgId } : undefined;
```

Also add `Trip` to `SUBJECT_CODE_TO_ENUM`:

```typescript
export const SUBJECT_CODE_TO_ENUM: Record<string, PermissionSubject> = {
  // ...existing...
  trip: 'Trip',
};
```

### Step 4 — Update managed role patterns (if needed)

If `*:*:org` already covers `Trip` at org scope — you're done. The wildcard automatically includes any new subject that matches.

### Step 5 — Add `authorize()` to the new routes

```typescript
router.get('/',     authenticate, authorize('read',   'Trip'), tripController.list);
router.get('/:id',  authenticate, authorize('read',   'Trip'), tripController.get);
router.patch('/:id',authenticate, authorize('update', 'Trip'), tripController.update);
```

### Step 6 — Scope service queries

```typescript
const ability = buildAbilityFromRules(req.user.rules);
const where = accessibleBy(ability, 'read').Trip;
const trips = await prisma.trip.findMany({ where });
```

### Checklist

- [ ] `PermissionSubject` enum updated in `schema.prisma`
- [ ] `npm run db:push` + `npx prisma generate` run
- [ ] New permissions added to `PERMISSIONS` in `bootstrap.ts`
- [ ] `scopeToCondition()` updated in `ability.ts`
- [ ] `SUBJECT_CODE_TO_ENUM` updated in `ability.ts`
- [ ] `authorize()` added to every route
- [ ] Service scopes queries with `accessibleBy()` or manual condition

---

## 11. Creating Custom Org Roles

Org admins can create their own roles using the `POST /roles` endpoint. Custom roles:

- Have `org_id = their org's ID` — not visible to other orgs
- Have `is_managed = false` — can be edited and deleted via API
- Can only use grant patterns with scopes ≤ the caller's own scope ceiling

```
org-admin creates "senior-dispatcher":
  patterns: ["user:read:org", "user:invite:org", "user:suspend:org",
             "invitation:*:org", "audit_log:read:org", "role:read:org"]

  ✓ All patterns use :org scope
  ✓ org-admin's ceiling is :org
  ✓ All patterns are valid (exist in permission catalog)
  → Role created, stored in role_grants as 6 pattern rows
```

```
org-admin tries to create "sneaky-role":
  patterns: ["user:read:platform"]

  ✗ Pattern scope is :platform
  ✗ org-admin's ceiling is :org
  → 403 FORBIDDEN
```

---

## 12. Direct User Grants

Sometimes you need to give a specific user elevated access without creating a whole new role. Use `UserGrant` for this.

```
Example: give a specific driver temporary read access to org audit logs
  pattern:    audit_log:read:org
  user_id:    <driver's UUID>
  is_managed: false
```

These grants are:
- Picked up at the **next login** — they are not retroactive to existing sessions
- **Additive** to whatever roles the user has — they never override or restrict
- The broadest scope wins if a role and a direct grant both cover the same (action, subject)
- Removable via `DELETE /users/:id/grants/:grantId`

> Direct grants are an escape hatch. Prefer creating a custom role when the pattern applies to multiple people.

---

## 13. IAM Across Microservices

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE CROSS-SERVICE CONTRACT                               │
│                                                                             │
│   user-service signs the JWT.                                               │
│   api-gw validates it and injects headers.                                  │
│   Every downstream service reads the headers — never verifies the JWT.      │
│                                                                             │
│   ┌────────────┐  JWT   ┌────────────┐  headers  ┌──────────────────┐      │
│   │   Client   │───────▶│   api-gw   │──────────▶│  user-service    │      │
│   └────────────┘        └────────────┘           │  audit-service   │      │
│                                                   │  trip-service    │      │
│                                                   └──────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Headers the api-gw injects

| Header | Content |
|---|---|
| `X-User-ID` | User UUID (`sub` from JWT) |
| `X-Org-ID` | Org UUID or absent for passengers |
| `X-User-Type` | `passenger` or `staff` |
| `X-User-Roles` | JSON `string[]` — role slugs |
| `X-User-Rules` | JSON packed CASL rules |

### For new microservices

The packed CASL rules in `X-User-Rules` only cover subjects that **user-service** knows about (`User`, `Org`, `Role`, etc.). A `trip-service` cannot use these rules to gate `Trip` access.

New services have two options:

**Option A — Role-slug based (simple services):**
```typescript
const roleSlugs: string[] = JSON.parse(req.headers['x-user-roles']);
if (!roleSlugs.some(s => ['org-admin', 'platform-admin'].includes(s))) {
  throw new AppError('FORBIDDEN', 403);
}
```

**Option B — Full CASL stack (larger services):**
The service replicates the same pattern — its own `Permission`, `Role`, `RoleGrant` tables seeded at startup, its own `authorize()` middleware using role slugs to build local CASL rules for its own subjects.

Role slugs are the stable cross-service contract. `org-admin` means the same thing everywhere.

---

## 14. Data Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SCHEMA OVERVIEW                              │
│                                                                      │
│  permissions                    roles                                │
│  ─────────────────              ──────────────────────               │
│  id          (uuid)             id          (uuid)                   │
│  code        (varchar)          name        (varchar)                │
│  action      (enum)             slug        (varchar)                │
│  subject     (enum)             org_id      (uuid | null)            │
│  display_name(varchar)          is_managed  (bool)                   │
│  description (varchar)          created_at  (timestamp)              │
│  group       (varchar)                │                              │
│                                       │                              │
│                               role_grants                            │
│                               ──────────────────────                 │
│                               id          (uuid)                     │
│                               role_id ────┘  (FK → roles)            │
│                               pattern     e.g. "*:*:org"             │
│                               is_managed  (bool)                     │
│                               created_at  (timestamp)                │
│                                                                      │
│  users                        user_grants                            │
│  ─────────────────            ──────────────────────                 │
│  id          (uuid)           id          (uuid)                     │
│  ...                          user_id ────── (FK → users)            │
│       │                       pattern     e.g. "user:read:org"       │
│       │                       is_managed  (bool)                     │
│       │                       created_at  (timestamp)                │
│       │                                                              │
│       └── user_roles ─────────────────────────────── roles           │
│           ──────────────                                             │
│           user_id (FK)        ← the assignment                       │
│           role_id (FK)                                               │
│           created_at                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Key invariants

| Rule | Where enforced |
|---|---|
| Permissions are immutable — only code can change them | Bootstrap upsert only; no API endpoint for CREATE/UPDATE/DELETE |
| Managed roles/grants cannot be edited or deleted | `is_managed` check in service before any mutation |
| Scope cannot be wildcarded in a pattern | `isValidPattern()` validation |
| Grant scope cannot exceed caller's scope ceiling | `maxScopeFromPatterns()` + `SCOPE_RANK` comparison |
| Wildcard patterns auto-include future permissions | Expansion happens at JWT build time, not at role creation |
| No JWT verification in downstream services | `authenticate` middleware reads injected headers only |

---

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   "Give people access to what they need — not everything they might       ║
║    one day need. The wildcard is a tool, not a default."                  ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```
