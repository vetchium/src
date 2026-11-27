# T03 Backend: Add the region fan-out read helper

## Requirements

PST-RD-001, PST-RD-002, PST-THR-007 (deadline), PST-QTE-012 (`partial`)

## Guides

`agent-guides/go.md`, `agent-guides/backend.md`, `agent-guides/federation.md`
("Reads and privacy"), `agent-guides/posts.md`

## Exemplars

- `backend/internal/profileclient/client.go` (timeouts, mesh reads)
- `backend/internal/directoryclient/` (principal resolution)

## Steps

1. Create package `backend/internal/fanout`. It holds mechanism only, no
   post types.
2. `func Do[K comparable, R any](ctx context.Context, groups map[K]G, read func(ctx context.Context, tenant K, group G) (R, error), deadline time.Duration) map[K]Result[R]`
   (shape it with generics as needed). It runs one goroutine for each tenant,
   each with its own `context.WithTimeout(ctx, deadline)`. `Result` has the
   value or an error. Default deadline: `const DefaultDeadline = 2 * time.Second`.
3. `func Regroup`: given items marked `not-homed`, the caller passes a
   resolver (`func(ctx, did) (tenant string, error)`). The helper groups the
   items by new tenant and calls `Do` once more. It never loops a second time.
4. Merge for sorted lists:
   - `type Cursor map[string]string` (tenant ID to that tenant's pagination
     key). Encode it as an opaque `Vetchium.PaginationKey` (base64url JSON).
     Decode refuses unknown shapes as `ErrInvalidCursor`.
   - `func Merge[T any](pages map[string]Page[T], less func(a, b T) bool, limit int) (items []T, next Cursor, partial bool)` with
     `Page{Items []T, Next string, Done bool, Err error}`.
   - Follow PST-RD-002 exactly: merge all items, take the first `limit`, set a
     tenant's cursor to its last taken item (keep the old cursor if none was
     taken), drop a tenant from the cursor only when it answered with
     `Done`, and all its items were taken. A tenant with `Err` keeps its old
     cursor and sets `partial`.
   - `next` is nil when every tenant is done.
5. Add a package comment that states the P4 rule: one call to each region in
   each round.

## Tests

`backend/internal/fanout/fanout_test.go`:

- Parallel calls: three tenants, each sleeps 100 ms; total time < 250 ms.
- Deadline: one tenant blocks; its result is a timeout error; the others
  return.
- `Regroup` calls each new tenant once and never a third round.
- `Merge`: interleaved timestamps across three tenants, limit 5; next cursor
  positions; a done tenant leaves the cursor; a tenant whose items were not
  all taken stays; an errored tenant keeps its cursor and sets `partial`.
- Cursor encode and decode round trip; a tampered cursor gives
  `ErrInvalidCursor`.

## Checks

- `cd backend && go test ./internal/fanout/...`
- `make test-go-static`, `make test-go-lint`, `make fmt`, `git diff --check`
- `make test` once at the end

## Acceptance

- The helper has no dependency on post, profile, or handler packages.

## Carried over
