# Permissions & Roles — Frontend Display Guide

> How to render the permission system clearly and safely based on the actual
> data model in the Katisha platform.

---

## The permission model in one sentence

Every permission is a three-part pattern: **what** (subject) · **how** (action) · **how broadly** (scope).

```
user : read : org
 │       │      └── org   → all records in the user's org
 │       └───────── read  → view only
 └───────────────── User  → the User subject
```

Scopes in ascending order of power:

```
own  <  org  <  platform
 │          │          └── platform-admins only — no condition, sees everything
 │          └──────────── org members with this role — scoped to their org_id
 └─────────────────────── the user themselves — scoped to their own id
```

---

## Actual permissions catalog

This is what `GET /api/v1/permissions` returns. The frontend builds the table
from this — never hardcode it.

| Group | Subject | Action | Display name |
|---|---|---|---|
| **Audit** | AuditLog | read | View audit logs |
| **Audit** | AuditLog | export | Export audit logs |
| **Invitation management** | Invitation | read | View invitations |
| **Invitation management** | Invitation | update | Modify invitations |
| **Invitation management** | Invitation | delete | Revoke invitations |
| **Notifications** | Notification | receive | Receive notifications |
| **Organisation management** | Org | read | View organisations |
| **Organisation management** | Org | create | Create organisations |
| **Organisation management** | Org | update | Edit organisations |
| **Organisation management** | Org | delete | Delete organisations |
| **Organisation management** | Org | suspend | Suspend organisations |
| **Organisation management** | Org | approve | Approve organisations |
| **Org documents** | OrgDocument | read | Read org documents |
| **Org documents** | OrgDocument | upload | Upload org documents |
| **Org documents** | OrgDocument | delete | Delete org documents |
| **Role management** | Role | read | View roles |
| **Role management** | Role | create | Create roles |
| **Role management** | Role | update | Edit roles |
| **Role management** | Role | delete | Delete roles |
| **User management** | User | read | View users |
| **User management** | User | update | Edit users |
| **User management** | User | delete | Delete users |
| **User management** | User | invite | Invite users |
| **User management** | User | suspend | Suspend users |
| **User management** | User | assign_role | Assign roles |

---

## Managed roles and their grants

These roles are platform-seeded (`is_managed: true`). Their grants are locked
and cannot be removed — they define the floor for each role type.

```
platform-admin   *:*:platform           ← can do everything, everywhere
org-admin        *:*:org                ← can do everything within their org
                 org:read:own           ← can also read their own org record
dispatcher       user:read:org          ← read all users in their org
                 user:invite:org
                 user:suspend:org
                 invitation:*:org
                 audit_log:read:org
driver           user:*:own             ← manage only their own profile
                 org:read:own
passenger        user:*:own             ← manage only their own profile
```

---

## The wildcard `*` in patterns

Some managed grants use `*` as a shorthand. There are two positions it can appear:

```
*  :  *  :  platform      ← subject wildcard + action wildcard
│     │
│     └── every action (read, update, delete, invite, suspend …)
└──────── every subject (User, Org, Role, Invitation, AuditLog …)
```

```
user  :  *  :  own        ← action wildcard only
              └── every action on User, scoped to own record

invitation  :  *  :  org  ← action wildcard only
                  └── every action on Invitation, scoped to org
```

### How the server expands them

At JWT build time the server expands wildcards into individual CASL rules:

```
*:*:platform  →  manage('all')                 — one rule covers everything

*:*:org       →  manage('User',  { org_id })
               + manage('Org',   { id: orgId })
               + manage('Role',  { org_id })
               + manage('Invitation', { org_id })
               + … one rule per subject

user:*:own    →  manage('User', { id: userId }) — CASL 'manage' = all actions
```

### What this means in the UI

When you see a wildcard grant in a role, the permission table should reflect it
by **filling every applicable cell** for that subject at that scope — not by
showing a literal `*` in a cell.

```
Pattern: user:*:own

║  Action      ║  User    ║
║  read        ║ [own  ▾] ║  ← all filled automatically
║  update      ║ [own  ▾] ║
║  delete      ║ [own  ▾] ║
║  invite      ║  n/a     ║  ← invite has no 'own' scope, stays n/a
║  suspend     ║  n/a     ║  ← suspend has no 'own' scope, stays n/a
║  assign_role ║  n/a     ║  ← assign_role has no 'own' scope, stays n/a
```

A `*:*:org` pattern fills every non-`n/a` cell at `org` scope, representing
the full set of permissions an org-admin holds.

### Wildcard grants and the lock

A wildcard managed grant locks all the cells it expands into. The org-admin
role has `*:*:org` (managed), so every cell at `org` scope shows 🔒. The admin
can still raise individual cells to `platform` by adding a custom grant on top —
the wildcard only locks the floor, not the ceiling.

---

## The permission table

The right UI for displaying and editing permissions is a **grouped table with
inline scope selectors** — not flat checkboxes (which lose scope context) and
not stacked dropdowns (too many clicks to scan).

### Structure

- **Rows** = actions (read, update, delete, invite …)
- **Columns** = subjects grouped by section (User, Org, Role …)
- **Cell** = scope selector for that action × subject pair

### Visual

```
╔══════════════════════════════════════════════════════════════════════════╗
║  User Management                                                         ║
╠══════════════════╦════════════╦════════════╦════════════╦════════════════╣
║  Action          ║  User      ║  Org       ║  Role      ║  Invitation    ║
╠══════════════════╬════════════╬════════════╬════════════╬════════════════╣
║  read            ║ [org    ▾] ║ [own    ▾] ║ [org    ▾] ║ [org        ▾] ║
║  update          ║ [org    ▾] ║ [—      ▾] ║ [—      ▾] ║ [—          ▾] ║
║  delete          ║ [—      ▾] ║ [—      ▾] ║ [—      ▾] ║ [—          ▾] ║
║  create          ║    n/a     ║ [—      ▾] ║ [—      ▾] ║    n/a         ║
║  invite          ║ [org    ▾] ║    n/a     ║    n/a     ║    n/a         ║
║  suspend         ║ [—      ▾] ║ [org    ▾] ║    n/a     ║    n/a         ║
║  assign_role     ║ [org    ▾] ║    n/a     ║    n/a     ║    n/a         ║
║  approve         ║    n/a     ║ [—      ▾] ║    n/a     ║    n/a         ║
╚══════════════════╩════════════╩════════════╩════════════╩════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  Org Documents                                                           ║
╠══════════════════╦══════════════════════════════════════════════════════╣
║  Action          ║  OrgDocument                                         ║
╠══════════════════╬══════════════════════════════════════════════════════╣
║  read            ║ [org    ▾]                                           ║
║  upload          ║ [—      ▾]                                           ║
║  delete          ║ [—      ▾]                                           ║
╚══════════════════╩══════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  Audit                                                                   ║
╠══════════════════╦══════════════════════════════════════════════════════╣
║  Action          ║  AuditLog                                            ║
╠══════════════════╬══════════════════════════════════════════════════════╣
║  read            ║ [org    ▾]                                           ║
║  export          ║ [—      ▾]                                           ║
╚══════════════════╩══════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════╗
║  Notifications                                                           ║
╠══════════════════╦══════════════════════════════════════════════════════╣
║  Action          ║  Notification                                        ║
╠══════════════════╬══════════════════════════════════════════════════════╣
║  receive         ║ [own    ▾]                                           ║
╚══════════════════╩══════════════════════════════════════════════════════╝
```

### Each cell dropdown

```
┌──────────────────┐
│  —  (none)       │  ← grey   — no permission granted
│  own             │  ← green  — only their own record
│  org             │  ← blue   — all records in their org
│  platform        │  ← amber  — unrestricted (elevated risk)
└──────────────────┘
```

### Rules for rendering cells

| Condition | Render |
|---|---|
| `(action, subject)` pair exists in the catalog | Scope dropdown |
| `(action, subject)` pair does not exist | `n/a` (grey, not interactive) |
| Scope `platform` but current admin is `org-admin` | Hide `platform` option |
| Grant is `is_managed: true` | See managed grants section below |

---

## Understanding managed grants 🔒

A managed grant (`is_managed: true`) is seeded by the platform and **cannot be
deleted**. It defines the guaranteed floor of the role — things the role will
always be able to do regardless of what an org-admin configures.

### What the lock means in the UI

When a cell has a managed grant, it shows the scope it was seeded with and a lock
icon. The dropdown is **not disabled** — the admin can still select a higher scope.
The lock only means they cannot go below the managed scope.

```
║  read   ║ [org 🔒 ▾] ║   ← locked at org, but can be raised to platform
║  update ║ [org    ▾] ║   ← no lock, fully editable
║  delete ║ [—      ▾] ║   ← no lock, not granted
```

### The floor rule

```
Managed grant sets the floor. You can only go up, never below it.

                ┌─────────────────────────────────┐
                │  Managed grant: org             │
                └────────────────┬────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
         own (❌)             org (✓)          platform (✓)
    below the floor         same as floor      above the floor
    not selectable          already there       additive grant
```

### Concrete example

The `dispatcher` role has `user:read:org` as a managed grant. An org-admin
opens the role editor and sees:

```
║  read   ║ [org 🔒 ▾] ║
           └── dropdown shows:
                  —         ← greyed out, can't remove managed grant
                  own       ← greyed out, below managed floor
                  org  ✓    ← current managed value
                  platform  ← selectable, would add a custom grant on top
```

If they select `platform`, a new custom grant `user:read:platform` is added to the
role alongside the existing managed `user:read:org`. CASL applies the most
permissive matching rule, so the user effectively gets platform-level read.

If they want the scope to stay at `org` — they don't need to do anything. The
managed grant already covers it.

### What you cannot do

You cannot restrict a role below its managed floor. If `dispatcher` has
`user:read:org` (managed), there is no way to reduce it to `user:read:own`
for that role. The only way to achieve a narrower permission set is to create
a new custom role from scratch.

---

## Scenario 1 — Creating a role

> Who can do this: `org-admin` (their org only), `platform-admin` (any org)

### Step 1 — Name the role

```
╔══════════════════════════════════════╗
║  New Role                            ║
╠══════════════════════════════════════╣
║  Role name   [Document Reviewer    ] ║
║                                      ║
║  [ Cancel ]            [ Next →    ] ║
╚══════════════════════════════════════╝
```

### Step 2 — Assign permissions using the table

All cells start at `—`. The admin selects scopes for what this role needs.

```
╔══════════════════════════════════════════════════════╗
║  Permissions for: Document Reviewer                  ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Org Documents                                       ║
║  ┌────────────┬─────────────────┐                    ║
║  │ Action     │ OrgDocument     │                    ║
║  ├────────────┼─────────────────┤                    ║
║  │ read       │ [org         ▾] │                    ║
║  │ upload     │ [org         ▾] │                    ║
║  │ delete     │ [—           ▾] │                    ║
║  └────────────┴─────────────────┘                    ║
║                                                      ║
║  [ ← Back ]              [ Create Role ]            ║
╚══════════════════════════════════════════════════════╝
```

The frontend converts filled cells into patterns:

```ts
POST /api/v1/roles
{
  "name": "Document Reviewer",
  "patterns": [
    "org_document:read:org",
    "org_document:upload:org"
  ]
}
```

---

## Scenario 2 — Editing an existing role

Same table, pre-filled from the role's current grants. Managed grants show
🔒. Changed cells produce a `POST /roles/:id/grants` (add) or
`DELETE /roles/:id/grants/:grantId` (remove).

```
╔══════════════════════════════════════════════════════════════╗
║  Edit Role: Dispatcher                                       ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  User Management                                             ║
║  ┌──────────────┬────────────┬────────────┐                  ║
║  │ Action       │ User       │ Org        │                  ║
║  ├──────────────┼────────────┼────────────┤                  ║
║  │ read    🔒   │ [org    ▾] │    n/a     │  ← managed       ║
║  │ invite  🔒   │ [org    ▾] │    n/a     │  ← managed       ║
║  │ suspend 🔒   │ [org    ▾] │    n/a     │  ← managed       ║
║  │ update       │ [—      ▾] │    n/a     │                  ║
║  │ delete       │ [—      ▾] │    n/a     │                  ║
║  └──────────────┴────────────┴────────────┘                  ║
║                                                              ║
║  Audit                                                       ║
║  ┌──────────────┬────────────┐                               ║
║  │ Action       │ AuditLog   │                               ║
║  ├──────────────┼────────────┤                               ║
║  │ read    🔒   │ [org    ▾] │  ← managed                   ║
║  │ export       │ [—      ▾] │                               ║
║  └──────────────┴────────────┘                               ║
║                                                              ║
║  ⚠ Changes take effect on the user's next login             ║
║                                                              ║
║  [ Cancel ]                    [ Save Changes ]             ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Scenario 3 — Inviting a user

> Who can do this: anyone with `invite:User` — dispatcher, org-admin, platform-admin

Roles use **checkboxes** because a user can hold multiple roles and the admin
needs to see all options at once without opening a dropdown repeatedly.

```
╔════════════════════════════════════════════════╗
║  Invite New User                               ║
╠════════════════════════════════════════════════╣
║                                                ║
║  First name   [ Alice              ]           ║
║  Last name    [ Mugisha             ]           ║
║  Phone        [ +250 788 123 456   ]           ║
║  Email        [ alice@katisha.com  ]  optional ║
║                                                ║
║  Roles                                         ║
║  ☑  Org Admin                                 ║
║  ☐  Dispatcher                                ║
║  ☐  Driver                                    ║
║  ☐  Document Reviewer                         ║
║                                                ║
║  [ Cancel ]            [ Send Invite ]         ║
╚════════════════════════════════════════════════╝
```

No permission table at invite time. Roles are the right level of abstraction.
Direct grants are an advanced post-creation operation — see Scenario 4.

```ts
POST /api/v1/users/invite
{
  "first_name": "Alice",
  "last_name": "Mugisha",
  "phone_number": "250788123456",
  "email": "alice@katisha.com",
  "role_slugs": ["org-admin"]
}
```

---

## Scenario 4 — Direct grants on the user edit page

Direct grants write a pattern straight to `user_grants` for one specific user —
bypassing roles entirely. They are for exceptions, not the default path.

They live on the user edit page only, collapsed by default under an
**Advanced permissions** accordion. The permission table here shows:

- Cells derived from the user's roles — greyed out (informational, not editable here)
- Cells with existing direct grants — editable
- Empty cells — editable, for adding new direct grants

```
╔══════════════════════════════════════════════════════════════╗
║  Edit User: Alice Mugisha                                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  [ Profile ]  [ Roles ]  [ Advanced Permissions ]           ║
║  ──────────────────────────────────────────────             ║
║                                                              ║
║  Roles                                                       ║
║  ☑  Org Admin                                               ║
║  ☐  Dispatcher                                              ║
║  ☐  Document Reviewer                                        ║
║                                                              ║
║  ▶  Advanced permissions  (direct grants)                   ║
╚══════════════════════════════════════════════════════════════╝
```

When the accordion opens:

```
╔══════════════════════════════════════════════════════════════╗
║  ▼  Advanced permissions  (direct grants)                   ║
║                                                              ║
║  These are added on top of Alice's role-based permissions.  ║
║  Use sparingly — prefer roles for recurring needs.          ║
║                                                              ║
║  Audit                                                       ║
║  ┌────────────┬──────────────────────────────────────────┐   ║
║  │ Action     │ AuditLog                                 │   ║
║  ├────────────┼──────────────────────────────────────────┤   ║
║  │ read       │ via role (org)     ← from Org Admin role │   ║
║  │ export     │ [org           ▾]  ← direct grant added  │   ║
║  └────────────┴──────────────────────────────────────────┘   ║
║                                                              ║
║  ⚠ Takes effect on Alice's next login                       ║
║                                                              ║
║  [ Save direct grants ]                                      ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Summary — roles vs direct grants

```
                   ┌─────────────────────────────────────────┐
                   │  Granting permissions to a user         │
                   └───────────────┬─────────────────────────┘
                                   │
              ┌────────────────────┴──────────────────────┐
              │                                           │
     ┌────────▼────────┐                       ┌─────────▼──────────┐
     │  Roles          │                       │  Direct grants     │
     │  (normal path)  │                       │  (exception path)  │
     └────────┬────────┘                       └─────────┬──────────┘
              │                                          │
   Set during invite                        Set on user edit page only
   Checkboxes — multi-select                Collapsed accordion
   Covers 95% of cases                      For one-off exceptions
   Changes affect all role members          Affects only this user
```

---

## Checklist — before shipping the permissions UI

- [ ] Permission table built from `GET /permissions` — never hardcoded
- [ ] `n/a` rendered for invalid `(action, subject)` pairs
- [ ] `platform` scope option hidden from `org-admin` users
- [ ] Managed grants shown with 🔒; scope options below the managed floor are greyed out
- [ ] Scope selector uses colour coding — green (own) / blue (org) / amber (platform) / grey (none)
- [ ] User invite form uses checkboxes for multi-role selection
- [ ] Direct grants accordion is collapsed by default on user edit page
- [ ] Role-derived permissions shown greyed out in the direct grants table (informational)
- [ ] Both role changes and direct grant changes show: "takes effect on next login"
- [ ] After saving, re-fetch `/users/me` to rebuild the client-side ability
