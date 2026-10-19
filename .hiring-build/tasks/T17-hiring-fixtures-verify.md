# T17 Development fixtures and full verification

Requirements: HP-TST-001 (gaps), HP-TST-002.

Guides: `database.md` (Development fixtures), `playwright.md`,
`verification.md`, `review.md`.

Exemplars: commit `426756b` (Openings fixtures through portal APIs);
`backend/cmd/dev-seed/org_openings.go`.

## Steps

1. `make dev-seed` gives each seeded Org pipeline templates and applications
   in every non-terminal state from Hub users in more than one region, all
   through the portal APIs.
2. Compare HP-TST-001 with the Playwright specs added since T05; add any
   missing case.
3. Run `make test`; fix what this branch broke.

## Checks

`make test`.

## Acceptance

`make test` passes; `make dev-seed` shows every hiring state in both
portals.

## Carried over

- From T09: fixtures need offered applications with real PDF letters (and one accepted, one declined, one expired offer).
- From T09: run `make clean` before `make test-environment`; dev SeaweedFS secrets predate the `org-offer-letters` bucket. Production S3 identity configs must be regenerated for the new bucket (note it in `deploy/README.md` if not already there).
