# T25 Activity statements

Requirements: MKT-STM-001 to MKT-STM-004, the billable facts table,
HP-STA-005 (corrected marker).

Guides: `marketplace.md`, `typespec.md`, `backend.md`, `database.md`,
`playwright.md`.

Exemplars: T08 (joining dates), T21 (provider work), T19 (engagement
detail).

## Steps

1. Record each billable fact in the transaction of its recording action:
   credited application joined and separated (consumer), interview completed
   or no-show, assessment result, each background-check outcome (provider).
   Corrections mark the fact.
2. Statement read for both sides by engagement and UTC month, server-side
   paginated: date, fact, opening number and title, application number,
   applicant display name, corrected marker; never an amount.
3. Facts outlive applicant retention with numbers only; delete them three
   years after the engagement becomes terminal.

## Tests

Playwright API: each fact appears once for both sides, corrections, month
boundaries, retention, no money fields.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Both sides read the same monthly facts for every engagement.
