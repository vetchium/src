# T24 Sourcing attribution and credited applications

Requirements: MKT-SRC-001 to MKT-SRC-008, MKT-DAT-008, HP-APP-007,
HP-ORG-002 (credit), `hub-referral-agency-not-eligible`.

Guides: `marketplace.md`, `hiring-pipeline.md`, `federation.md`,
`typespec.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: T07 (apply command), T23 (suggestions on pointers).

## Steps

1. Apply request gains the referral choice: none (default), an agency that
   suggested this Opening (route `suggested`, attested by the Hub tenant
   from its pointers), or another agency by primary domain (route
   `declared`).
2. The Org tenant accepts only an agency with an active `sourcing`
   engagement assigned to the Opening (remote domains resolved through the
   directory); everything else is one `hub-referral-agency-not-eligible`
   that creates nothing. Store the engagement, never the domain; the credit
   never changes.
3. Orgs: credited agency and route on the application, filters by both.
4. Agency: credited applications across clients with route and Hub status
   (live reads), per-Contact suggested Openings and credits, Job detail
   credits and suggested-to contacts; no signal about uncredited
   applications.

## Tests

Playwright API: everything MKT-TST-001 lists for referrals and attribution.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Applicants credit agencies; each side sees exactly its share.
