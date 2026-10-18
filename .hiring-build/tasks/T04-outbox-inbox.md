# T04 Outbox delivery and inbox between tenants

Use a strong model for this task: later tasks depend on it.

Requirements: `federation.md` Transactional outbox and inbox; HP-GEN-004
(transport); MKT-GEN-004 (transport).

Guides: `federation.md`, `mesh-topology.md`, `backend.md`, `database.md`,
`go.md`.

Exemplars: `vetchium.federation_outbox` and `federation_inbox` in
`db/migrations/00001_init.sql` with their queries in
`backend/internal/db/queries/federation.sql` (claim, complete, retry, inbox
receipt; only tests use them today); `backend/internal/workers/deliver_hub_email.go`
(leased delivery with backoff); T03's peer route and handler registry.

## Steps

1. A `workers` job claims due `federation_outbox` events, delivers each to
   its destination tenant's peer endpoint (for example
   `POST /api/mesh/events/deliver`) through the local mesh relay, and
   completes or retries with bounded exponential backoff; sustained failure
   is logged for alerting. A local destination applies in process.
2. Receiver: insert the inbox receipt and apply the effect in one
   transaction through a handler looked up by event kind. A duplicate event
   id is a no-op; the same id with another digest is a protocol error. Keep
   a per-aggregate watermark (aggregate type, id, version) so an older event
   never overwrites newer state.
3. A helper that a write transaction calls to enqueue an event with its
   aggregate version.
4. Register no product event kinds yet; T07 adds the first.

## Tests

Go integration tests with a test-only event kind: delivery local and remote,
duplicate and conflicting ids, out-of-order versions, retry after the
destination fails, lease expiry.

## Checks

`make sqlc`, `make sql-check`, `make test-go`, `make test-go-static`,
`make test-go-lint`, `make playwright-check`.

## Acceptance

Any later task projects state to another tenant by enqueuing an event in its
write transaction and registering a receiver handler.
