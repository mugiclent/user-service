# src/subscribers/

RabbitMQ inbound consumers. Each subscriber listens to one queue or exchange
binding and processes messages asynchronously.

Currently this service only publishes outbound events (audit logs, notifications).
Subscribers are reserved for any inbound events this service may need to consume
in the future (e.g. org provisioning events from an admin service).

## Files

| File | Purpose |
|---|---|
| _(none yet)_ | Add files here when inbound RabbitMQ consumption is needed |

## Conventions

- Each subscriber file exports a `start*Subscriber()` function called from `src/index.ts`
- Always `ack` or `nack` every message — never let a message go unacknowledged
- On processing error: `nack` with `requeue: false` and log the failure (dead-letter the message)
- Subscribers must not call HTTP layer code (`req`, `res`) — use services directly

## Do not

- Put publisher logic here — outbound publishing belongs in `src/utils/publishers.ts`
- Start subscribers before the RabbitMQ connection is established (wait for `initRabbitMQ()`)
