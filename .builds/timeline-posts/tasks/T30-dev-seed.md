# T30 Dev seed: Add posts, replies, quotes, and blocks

## Requirements

`agent-guides/database.md` "Development fixtures"; PST-POS-001 (Silver
authors)

## Guides

`agent-guides/database.md`, `agent-guides/go.md`, `agent-guides/posts.md`

## Exemplars

- `backend/cmd/dev-seed/hub_profiles.go`, `marketplace.go`, `main.go`
  (fixtures created through portal APIs)

## Steps

1. Create `backend/cmd/dev-seed/hub_posts.go`. Use only portal APIs.
2. For seeded Hub users in at least two regions: Silver users write 3 posts
   each; other users reply and sub-reply across regions; one post is locked;
   one has `reply_policy` `nobody`; one reply is hidden; one quote of a post
   and one quote of a published Opening; one block and one mute.
3. Make the seed idempotent as the existing fixtures are (skip when the first
   post exists).
4. Call it from `main.go` after profiles and Openings.

## Tests

- Unit test for any pure helper in `hub_posts_test.go`.
- Run the seed against `make test-environment` (or the dev stack) and check
  the posts in the Hub portal.

## Checks

- `cd backend && go test ./cmd/dev-seed/...`
- `make test-go-static`, `make test-go-lint`, `make fmt`, `git diff --check`
- `make test` once

## Acceptance

- A fresh dev stack shows posts, threads, quotes, and a block.

## Carried over
