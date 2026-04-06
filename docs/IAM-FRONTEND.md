# IAM — Frontend Implementation Guide

> How to protect routes, render UI conditionally, and manage roles & grants from the client side.

---

## What the API gives you after login

Every authenticated response includes a `user` object and CASL rules packed in the JWT. The token is decoded on the gateway — you never need to verify it yourself. After login the `GET /users/me` response gives you:

```json
{
  "id": "...",
  "user_type": "staff",
  "org_id": "...",
  "roles": ["org-admin"],
  "permissions": [
    { "action": "manage", "subject": "User",  "conditions": { "org_id": "..." } },
    { "action": "manage", "subject": "Role",  "conditions": { "org_id": "..." } },
    { "action": "manage", "subject": "Org",   "conditions": { "id": "..." } }
  ]
}
```

`permissions` is the expanded CASL rules array. Store it in your auth state — it is the single source of truth for the client.

---

## Setting up CASL in the frontend

Install once:
```bash
npm install @casl/ability @casl/react   # or @casl/vue / @casl/angular
```

Bootstrap on login / page refresh:

```ts
import { createMongoAbility } from '@casl/ability';

// rules come straight from GET /users/me → permissions
export function buildAbility(rules) {
  return createMongoAbility(rules);
}
```

Provide it at the app root (React example):

```tsx
import { createContext, useContext } from 'react';
import { createContextualCan } from '@casl/react';

export const AbilityContext = createContext(buildAbility([]));
export const Can = createContextualCan(AbilityContext.Consumer);

// In <App />:
<AbilityContext.Provider value={buildAbility(currentUser.permissions)}>
  <Router />
</AbilityContext.Provider>
```

---

## Route protection

### Checklist

- [ ] Define a required `(action, subject)` pair for each protected route
- [ ] Wrap routes with an `<AuthGuard>` that checks `ability.can(action, subject)`
- [ ] Redirect unauthorized users to `/403` (not `/login` — they are logged in, just not allowed)
- [ ] Never hide the route URL itself — gate on the API response too

### Pattern

```tsx
function AuthGuard({ action, subject, children }) {
  const ability = useContext(AbilityContext);
  if (!ability.can(action, subject)) return <Navigate to="/403" replace />;
  return children;
}
```

### Route table — map each page to its gate

| Page | action | subject | Who passes |
|---|---|---|---|
| `/users` | `read` | `User` | dispatcher, org-admin, platform-admin |
| `/users/:id/edit` | `update` | `User` | org-admin, platform-admin |
| `/users/invite` | `invite` | `User` | dispatcher, org-admin |
| `/organizations` | `read` | `Org` | org-admin, platform-admin |
| `/organizations/:id/edit` | `update` | `Org` | org-admin (own), platform-admin |
| `/roles` | `read` | `Role` | org-admin, platform-admin |
| `/roles/new` | `create` | `Role` | org-admin, platform-admin |
| `/audit` | `read` | `AuditLog` | dispatcher, org-admin, platform-admin |

```tsx
// Usage
<Route path="/users" element={
  <AuthGuard action="read" subject="User">
    <UsersPage />
  </AuthGuard>
} />
```

> **Note:** `ability.can('read', 'User')` returns `true` even for conditioned rules (e.g. a dispatcher scoped to their org). The API enforces the condition — you only need to check the action+subject for routing.

---

## Conditional UI rendering

Use `<Can>` to show/hide buttons and sections — not to enforce security (the API does that).

```tsx
// Show invite button only to users who can invite
<Can I="invite" a="User">
  <Button onClick={openInviteModal}>Invite User</Button>
</Can>

// Show role management tab only to role managers
<Can I="read" a="Role">
  <Tab label="Roles" />
</Can>

// Show suspend button only to those who can suspend
<Can I="suspend" a="User">
  <Button variant="danger">Suspend Account</Button>
</Can>
```

### Checklist

- [ ] Wrap destructive actions (delete, suspend) in `<Can>` — don't just disable them
- [ ] Wrap admin-only sections (audit logs, role management) in `<Can>`
- [ ] Never expose sensitive data in the DOM and rely on CSS `display:none` — use `<Can>` which skips rendering entirely
- [ ] Refresh the ability after role/grant changes (re-fetch `/users/me`)

---

## Flows — step by step

---

### Create a new role

> Who can do this: `platform-admin` (any org), `org-admin` (their org only)

**Checklist**

- [ ] Gate the "New Role" UI with `<Can I="create" a="Role">`
- [ ] Fetch the permission catalog: `GET /permissions` — use this to build a pattern picker, not a free-text field
- [ ] Build the pattern from three dropdowns: `subject` · `action` · `scope`
  - Scope options for org-admin: `own`, `org` only — never show `platform`
- [ ] `POST /roles` with the assembled payload

```ts
// POST /api/v1/roles
{
  name: "Document Reviewer",
  patterns: ["org_document:read:org", "org_document:upload:org"]
}
```

```ts
// Response
{
  "id": "abc-123",
  "name": "Document Reviewer",
  "slug": "document-reviewer",
  "org_id": "org-xyz",
  "is_managed": false,
  "grants": [
    { "id": "g-1", "pattern": "org_document:read:org",   "is_managed": false },
    { "id": "g-2", "pattern": "org_document:upload:org", "is_managed": false }
  ]
}
```

**Pattern builder UI hint:** render the three parts separately so users never type patterns manually:

```
Subject:  [ User ▼ ]   Action: [ read ▼ ]   Scope: [ org ▼ ]
                                         → "user:read:org"
```

---

### Assign a role to a user

> Who can do this: `platform-admin` only (the `assign_role` permission is platform-scoped for role replacement)

**Checklist**

- [ ] Gate the role picker with `ability.can('assign_role', 'User')`
- [ ] Fetch available roles: `GET /roles` (returns roles visible to the requester)
- [ ] Send the full desired role list — this is a **replacement**, not an append

```ts
// PATCH /api/v1/users/:id
{
  "role_slugs": ["dispatcher"]
}
```

> `role_slugs` replaces all existing roles atomically. To add one role without removing others, fetch the user's current roles first and merge.

```ts
// Safe merge pattern
const current = user.roles;                     // ["org-admin"]
const updated = [...new Set([...current, "dispatcher"])];
await patchUser(userId, { role_slugs: updated });
```

---

### Add / remove a grant on a role

> Who can do this: `platform-admin` (any non-managed role), `org-admin` (own org's non-managed roles)

**Add a grant**

```ts
// POST /api/v1/roles/:roleId/grants
{ "pattern": "audit_log:read:org" }

// Response: the full updated role object
```

**Remove a grant**

```ts
// DELETE /api/v1/roles/:roleId/grants/:grantId
// 204 No Content
```

**Checklist**

- [ ] Gate grant management UI with `<Can I="update" a="Role">`
- [ ] Disable (grey out) grants where `is_managed: true` — they cannot be deleted
- [ ] After mutating grants, invalidate any cached user abilities in the org (their next login rebuilds the JWT)
- [ ] Show a warning: grant changes take effect on the user's **next token refresh**, not immediately

---

### Invite a user (with a role pre-assigned)

> Who can do this: anyone with `invite:User` — dispatcher, org-admin, platform-admin

**Checklist**

- [ ] Gate the invite form with `<Can I="invite" a="User">`
- [ ] Fetch available roles: `GET /roles` — filter to roles appropriate for your org
- [ ] Submit the invite

```ts
// POST /api/v1/users/invite
{
  "first_name": "Alice",
  "last_name": "Mugisha",
  "phone_number": "+250788123456",
  "role_slug": "dispatcher"
}
```

The invited user lands at `/accept-invite?token=...` where they set their password. The role is assigned on acceptance — no further action needed.

---

### Assign a direct grant to a user

> Direct grants bypass roles — the pattern is added directly to `user_grants` (not yet exposed via a dedicated endpoint; done via admin tooling or a future `PATCH /users/:id/grants` endpoint).

When it exists the flow will be:

```ts
// POST /api/v1/users/:userId/grants  (future)
{ "pattern": "audit_log:export:org" }
```

**Checklist**

- [ ] Gate with `ability.can('assign_role', 'User')` (same permission — it governs all grant assignment)
- [ ] Use sparingly — prefer roles for recurring permission sets; use direct grants for one-off exceptions
- [ ] Document why in the audit trail (the API publishes an audit event automatically)
- [ ] Remind the operator: takes effect on **next login**

---

## Scope awareness in the UI

The `conditions` in a rule tell you **what the user can see**, but you don't need to parse them manually. Use CASL's subject helper to check instance-level access:

```ts
import { subject } from '@casl/ability';

// Can this user edit THIS specific org?
const thisOrg = subject('Org', { id: 'org-xyz', org_id: 'org-xyz' });
ability.can('update', thisOrg);   // true only if conditions match
```

**When to use instance-level checks vs. action-level checks:**

| Use case | Check |
|---|---|
| Show/hide a page or nav item | `ability.can('read', 'User')` — no instance needed |
| Show/hide an Edit button on a specific record | `ability.can('update', subject('User', record))` |
| Show/hide a Delete button | `ability.can('delete', subject('User', record))` |

---

## Common mistakes

| Mistake | Fix |
|---|---|
| Using `user.roles.includes('org-admin')` for UI gating | Use `ability.can()` — role slugs don't tell you scope |
| Hiding the route URL and trusting CSS | Use `<AuthGuard>` — it redirects, not hides |
| Not refreshing ability after role change | Call `GET /users/me` and rebuild ability after any `PATCH /users/:id` |
| Showing `platform` scope options to org-admins | Filter the scope dropdown based on `maxScope` from the user's own permissions |
| Free-text pattern input | Always use a picker — invalid patterns return `INVALID_GRANT_PATTERN 422` |
