# Media Upload — Sign-then-Patch Flow

User avatars and org logos are stored in **SeaweedFS** (S3-compatible object storage).
The user-service never handles file bytes — it only generates pre-signed PUT URLs.

---

## Architecture

```
Client                      User Service                SeaweedFS / CDN
  │                              │                            │
  │  GET /me/avatar/presigned-url│                            │
  │─────────────────────────────>│                            │
  │                              │  SDK signs PUT URL         │
  │  { upload_url, path }        │  (HMAC-SHA256)             │
  │<─────────────────────────────│                            │
  │                              │                            │
  │  PUT {upload_url}            │                            │
  │  Content-Type: image/jpeg    │                            │
  │  Body: <file bytes>          │                            │
  │─────────────────────────────────────────────────────────>│
  │  200 OK                      │                            │
  │<─────────────────────────────────────────────────────────│
  │                              │                            │
  │  PATCH /me { avatar_path: "avatars/user-id/uuid.jpg" }   │
  │─────────────────────────────>│                            │
  │  User record updated         │                            │
  │<─────────────────────────────│                            │
```

**Why not upload through the user-service?**
- Eliminates memory pressure and bandwidth cost on the API server
- Files go directly from the client to object storage
- Scales independently of the application tier

---

## Environment Variables

```dotenv
# Internal endpoint — Docker service name, used for server-side deletes
S3_ENDPOINT=http://seaweedfs:8333

# Public endpoint — browser-reachable, embedded in presigned URLs
S3_PUBLIC_ENDPOINT=http://localhost:8333

# Must exactly match the credentials in infra/seaweedfs/s3config.json
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key

S3_BUCKET=katisha
S3_REGION=us-east-1          # SeaweedFS ignores this but AWS SDK requires it
S3_PRESIGNED_EXPIRES_IN=300  # seconds — URL expires 5 minutes after issue
```

### The "localhost trap"

If `S3_ENDPOINT` is set to a Docker-internal hostname (e.g. `http://seaweedfs:8333`),
the SDK would embed that hostname in the presigned URL — which the browser cannot reach.

The solution is **two S3 clients**:

| Client | Endpoint | Used for |
|---|---|---|
| `internalClient` | `S3_ENDPOINT` | Server-side deletes (`DeleteObjectCommand`) |
| `publicClient` | `S3_PUBLIC_ENDPOINT` | Presigned URL generation (`PutObjectCommand`) |

The browser receives a URL referencing `S3_PUBLIC_ENDPOINT` and can PUT directly.

---

## SeaweedFS Configuration (`infra/seaweedfs/s3config.json`)

SeaweedFS validates presigned requests using its own credential store.
The credentials **must exactly match** `S3_ACCESS_KEY` / `S3_SECRET_KEY` in `.env`.

```json
{
  "identities": [
    {
      "name": "katisha-admin",
      "credentials": [
        {
          "accessKey": "<S3_ACCESS_KEY>",
          "secretKey": "<S3_SECRET_KEY>"
        }
      ],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
```

Mount this file when starting SeaweedFS:
```bash
weed server -s3 -s3.config=/etc/seaweedfs/s3config.json
```

---

## Storing Paths, Not URLs

The DB columns (`User.avatar_path`, `Org.logo_path`) store the **S3 object key only**,
not the full URL. Example value: `avatars/user-abc/550e8400.jpg`

The frontend constructs the full URL:
```
<CDN_URL>/<avatar_path>
# e.g. https://cdn.katisha.com/avatars/user-abc/550e8400.jpg
```

**Why?** Changing the CDN domain, migrating storage providers, or switching from
SeaweedFS to S3 requires zero DB migrations — only a frontend config change.

---

## API Endpoints

### Avatar (user)

```
GET /api/v1/users/me/avatar/presigned-url?content_type=image/jpeg
Authorization: Bearer <token>

200 OK
{
  "upload_url": "http://public-seaweedfs:8333/katisha/avatars/user-id/uuid.jpg?X-Amz-...",
  "path": "avatars/user-id/uuid.jpg"
}
```

After uploading to `upload_url`:
```
PATCH /api/v1/users/me
Authorization: Bearer <token>
Content-Type: application/json

{ "avatar_path": "avatars/user-id/uuid.jpg" }
```

To delete the avatar:
```
PATCH /api/v1/users/me
{ "avatar_path": null }
```

### Logo (org)

Org admins upload their own org's logo:
```
GET /api/v1/organizations/me/logo/presigned-url?content_type=image/jpeg
```

Platform admins upload a logo for any org:
```
GET /api/v1/organizations/:id/logo/presigned-url?content_type=image/jpeg
```

Commit the upload with:
```
PATCH /api/v1/organizations/:id
{ "logo_path": "logos/org-id/uuid.jpg" }
```

---

## Accepted Content Types

| MIME type | Extension |
|---|---|
| `image/jpeg` | `.jpg` |
| `image/png` | `.png` |
| `image/webp` | `.webp` |

Other types are rejected with `400 Bad Request`.

---

## Old File Cleanup

When a user commits a new `avatar_path` (or sets it to `null`), the user-service
automatically deletes the previous object from S3 using the `internalClient`.

This delete is **fire-and-forget** — it does not block the response or fail the
request if S3 is temporarily unavailable.

---

## Generating Keys (local development)

```bash
# Generate local SeaweedFS credentials (any random string works for dev)
openssl rand -hex 16   # use output as S3_ACCESS_KEY
openssl rand -hex 32   # use output as S3_SECRET_KEY
```

Copy both values into `.env` **and** into `infra/seaweedfs/s3config.json`.
