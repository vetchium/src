# T21 Dev seed: Add follows, tags, and Allow replies to the fixtures

## Requirements

PST-TAG-001, PST-POS-004, PST-FOL-001, PST-TL-001

## Guides

`agent-guides/database.md` (seeds), `backend/cmd/dev-seed/AGENTS.md` if
present, `agent-guides/go.md`, `agent-guides/posts.md`

## Exemplars

- `backend/cmd/dev-seed/hub_posts.go`, `hub_posts_test.go`

## Steps

1. `backend/cmd/dev-seed/hub_posts.go`: delete policy and lock fixtures;
   give some posts 1 to 3 catalog tags and one post `allow_replies` false.
2. Add follows through `/api/hub/follows/follow` between seeded Hub users in
   at least two regions, so each seeded user's Timeline has followed
   posts. Add one block between two seeded users.
3. Update `hub_posts_test.go`.
4. Update `README.md` seeded-account notes if they describe posts.

## Tests

`backend/cmd/dev-seed/hub_posts_test.go`.

## Checks

- `cd backend && go test ./cmd/dev-seed/...`
- `make test-go`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- `make dev` seeds follows, tags, and a replies-off post without errors.

## Carried over
