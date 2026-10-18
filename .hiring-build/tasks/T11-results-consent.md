# T11 Assessment and background-check results and consent

Requirements: HP-WRK-005 to HP-WRK-007, HP-HUB-003 (consent). In-house
performer only; provider performers and disclosure copies are T20 and T21.

Guides: `hiring-pipeline.md`, `federation.md`, `typespec.md`, `backend.md`,
`database.md`, `playwright.md`.

Exemplars: T10's schema and commands.

## Steps

1. Assessment result per candidacy at an `assessment` stage: outcome,
   optional score 0–100, notes ≤2,000, optional HTTPS report link.
2. Background check per candidacy at a `background_check` stage: the Org
   selects check types (T02); a consent request goes to the Hub; nothing is
   recorded until consent. Each check records outcome, note ≤2,000, optional
   HTTPS link. Declining consent completes nothing.
3. Hub commands through T03: give or decline consent; the Hub detail shows
   check types and the performer.

## Tests

Playwright API: result bounds, recording refused before consent, consent and
decline from another region, check types, no result reaching the Hub.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

In-house assessment and background-check stages record results with consent
gating.
