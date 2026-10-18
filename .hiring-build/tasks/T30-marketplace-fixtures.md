# T30 Marketplace development fixtures

Requirements: MKT-TST-003, MKT-TST-001 and MKT-TST-002 (gaps).

Guides: `database.md` (Development fixtures), `playwright.md`,
`verification.md`.

Exemplars: T17 fixtures; `backend/cmd/dev-seed/`.

## Steps

1. `make dev-seed` gives each region a provider Org per Capability with a
   Listing, engagements in each state with consumers in other regions,
   routed work, and agency Contacts with notes and conversations (including
   notes-only Contacts) with Hub users in other regions, all through the
   portal APIs.
2. Compare MKT-TST-001 and MKT-TST-002 with the specs added since T18; add
   any missing case.
3. Run `make test`; fix what this branch broke.

## Checks

`make test`.

## Acceptance

`make test` passes; `make dev-seed` shows every marketplace state in both
portals.
