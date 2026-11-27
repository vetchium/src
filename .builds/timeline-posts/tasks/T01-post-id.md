# T01 Backend: Add the post ID helper

## Requirements

PST-ID-001, PST-ID-002, PST-ID-003, PST-ID-004

## Guides

`agent-guides/go.md`, `agent-guides/backend.md`, `agent-guides/posts.md`

## Exemplars

- `backend/internal/identitydigest/` for a small focused package with tests
- `github.com/rs/xid` v1.6.0 (already in `backend/go.mod` as indirect)

## Steps

1. Create package `backend/internal/postid` with:
   - `const Length = 40`
   - `func New() (string, error)`: `xid.New().String()` (20 characters), then
     20 characters from the alphabet `0123456789abcdefghijklmnopqrstuvwxyz`
     drawn with `crypto/rand`. Use rejection sampling: read bytes, discard a
     byte `>= 252` (252 = 7 × 36), take `b % 36`.
   - `func Valid(id string) bool`: matches `^[0-9a-v]{20}[0-9a-z]{20}$`.
     Use a precompiled `regexp`.
2. Move `github.com/rs/xid` from indirect to a direct require in
   `backend/go.mod` (`go mod tidy` in `backend/`).
3. Add a package comment: the XID part keeps B-tree inserts at the end; the
   random part makes the ID impossible to guess; the XID time is not a
   creation time (PST-ID-004).

## Tests

`backend/internal/postid/postid_test.go`:

- `New` returns 40 characters that pass `Valid`.
- 10,000 calls give 10,000 distinct IDs.
- IDs made one second apart sort in creation order (compare with a fixed
  XID made by `xid.NewWithTime`; build the ID by hand in the test).
- `Valid` refuses: 39 and 41 characters, uppercase letters, `w` in the XID
  part, `-`, and an empty string.
- A chi-square check is not needed. Check that each of the 36 characters
  appears in 100,000 random characters.

## Checks

- `cd backend && go test ./internal/postid/...`
- `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`
- `make test` once at the end. Keep CPU low: `GOTESTFLAGS='-p 2'` for
  `make test-go`.

## Acceptance

- `postid.New` and `postid.Valid` exist with tests.
- `rs/xid` is a direct dependency.

## Carried over
