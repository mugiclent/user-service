# OpenAPI Spec — Update Protocol

The OpenAPI spec lives at `docs/openapi.yaml`. It is the contract between this
service and its clients (frontend, API gateway, other services). **Keep it in
sync with every code change that affects the HTTP surface.**

---

## When to update the spec

Update `docs/openapi.yaml` whenever you:

| Change | What to update |
|---|---|
| Add a query parameter to a list endpoint | Add a `- in: query` entry under `parameters:` |
| Add/remove a request body field | Update the relevant `requestBody` schema |
| Add/remove a response field | Update the relevant response schema (inline or `$ref`) |
| Add a new endpoint | Add the full path + operation block |
| Remove an endpoint | Remove the path + operation block |
| Change an HTTP status code or error code | Update the `responses` block |
| Add a new `$ref` schema | Add it under `components/schemas` |
| Change an enum value | Update every `enum:` that references it |

---

## How to find the right section

Search by summary or path:

```bash
grep -n "summary:\|/users\|/organizations\|/roles\|/invitations" docs/openapi.yaml
```

Endpoint blocks follow the pattern:

```yaml
  /path/to/endpoint:
    get:                         # or post, patch, delete
      tags: [Tag]
      summary: Short description
      parameters:
        - in: query
          name: <param>
          schema: { type: string }
          description: What it does.
      responses:
        '200': ...
```

---

## Parameter template

```yaml
        - in: query
          name: q
          schema: { type: string, maxLength: 200 }
          description: Search by <fields> (case-insensitive substring match).
```

For path parameters, use `in: path` with `required: true`.

---

## Shared references

| Ref | Where defined | Used by |
|---|---|---|
| `$ref: '#/components/responses/Unauthorized'` | `components/responses` | All protected endpoints |
| `$ref: '#/components/responses/Forbidden'` | `components/responses` | Permission-gated endpoints |
| `$ref: '#/components/responses/NotFound'` | `components/responses` | Resource-by-id endpoints |
| `$ref: '#/components/responses/UnprocessableEntity'` | `components/responses` | Validation-error endpoints |
| `$ref: '#/components/schemas/Error'` | `components/schemas` | All error responses |
| `$ref: '#/components/schemas/UserListItem'` | `components/schemas` | `GET /users` |
| `$ref: '#/components/schemas/OrgListItem'` | `components/schemas` | `GET /organizations` |
| `$ref: '#/components/schemas/Role'` | `components/schemas` | `GET /roles`, `POST /roles` |

---

## Checklist before marking a PR ready

- [ ] Every new/changed query parameter appears in the spec
- [ ] Every new/changed request body field appears in the spec
- [ ] Every new/changed response field appears in the spec
- [ ] New error codes (`SCREAMING_SNAKE_CASE`) have a `description` or `example` in the relevant `responses` block
- [ ] No new endpoint is undocumented
