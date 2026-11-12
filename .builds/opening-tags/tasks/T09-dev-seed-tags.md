# T09 Dev seed: Tags on seeded Openings

## Requirements

OPN-TST-003 (tags on most published Openings).

## Guides

`agent-guides/database.md` (Development fixtures), `agent-guides/go.md`,
`agent-guides/openings.md`.

## Exemplars

`backend/cmd/dev-seed/org_openings.go` (Openings created through the portal
APIs).

## Steps

1. Give most seeded Openings 1–5 tags fitting their title, through the same
   create or save calls (never SQL). Include a programming-language tag with
   an icon, a tag with a German name, and `artificial-intelligence`; leave at
   least one published Opening untagged.
2. Run `make dev-seed` on a fresh stack and confirm the Orgs and Hub portals
   show the tags.

## Tests

`make dev-seed` on a fresh stack succeeds.

## Checks

`make test-go`, `make test-go-static`, `make dev-seed` on a fresh stack, then
`make test`.

## Acceptance

- Seeded Orgs show tagged Openings in both portals.

## Carried over
