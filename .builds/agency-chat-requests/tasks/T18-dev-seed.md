# T18 Dev seed: Chat request fixtures

## Requirements

MKT-TST-003.

## Guides

`database.md` (seeds), `go.md`, `marketplace.md`.

## Exemplars

`backend/cmd/dev-seed/marketplace.go` (agencies `age1`/`age2`, agents,
Contacts, conversations), `backend/cmd/dev-seed/main.go`.

## Steps

1. For each seeded agency, through the portal APIs only: one pending
   agency request to a Hub user in another region, one pending Hub
   request to the agency from an Opening page, and one declined request of
   each scope (one declined by a Hub user, one by the agency).
2. Idempotent reruns as the rest of the seed.

## Tests

`make dev-seed` twice on a fresh `make dev` stack; the Orgs Home card and
Hub Messages show the seeded requests.

## Checks

`make test-go`, `make test-go-static`.

## Acceptance

MKT-TST-003's request fixtures exist after `make dev-seed`.

## Carried over
