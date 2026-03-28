# docs/

API documentation and OpenAPI spec.

## Files

| File | Purpose |
|---|---|
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 spec for all endpoints |
| [`AUTH.md`](AUTH.md) | Authentication and token lifecycle |
| [`IAM.md`](IAM.md) | Role-based access control and CASL permissions |
| [`MEDIA_UPLOAD.md`](MEDIA_UPLOAD.md) | S3 presigned URL upload flow |
| [`DEVOPS.md`](DEVOPS.md) | Docker, docker-compose, CI/CD pipeline and deployment |

## Conventions

- The spec is the source of truth for the public API contract — keep it in sync with route changes
- Generate from the spec, don't hand-write it from scratch
- When an endpoint is added or changed, update the spec in the same PR
