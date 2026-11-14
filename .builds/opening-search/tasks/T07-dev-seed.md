# T07 Dev seed: Openings for every search filter

## Requirements

OPN-TST-003 (search filters).

## Guides

`agent-guides/database.md` (seeds), `agent-guides/go.md`,
`agent-guides/openings.md`.

## Exemplars

`backend/cmd/dev-seed/org_openings.go` (`seedOpeningContent`,
`seedOrgOpenings`).

## Steps

1. Vary `seedOpeningContent` by index so published Openings across the
   seeded Orgs (in more than one region) include: on-site, hybrid, remote
   `worldwide`, and remote `countries`; every employment type; with and
   without salary; experience ranges with open and closed bounds and none;
   each education level and none; shared tags between Orgs.
2. Keep every fixture going through the portal APIs.

## Tests

`make dev-seed` against a fresh `make dev` stack completes; check
`/openings` shows results for each filter.

## Checks

`make test-go`, `make test-go-static`, a `make dev-seed` run, then
`make test`.

## Acceptance

- A developer sees results for every search filter after `make dev-seed`.

## Carried over
