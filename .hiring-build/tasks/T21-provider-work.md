# T21 Provider access, stage work, Work queue, and Jobs

Requirements: MKT-ACC-001 to MKT-ACC-004, MKT-WRK-001 to MKT-WRK-006,
MKT-GEN-004 (live reads), HP-HUB-004, `org-engagement-work-not-found`.

Guides: `marketplace.md`, `hiring-pipeline.md`, `federation.md`,
`typespec.md`, `backend.md`, `database.md`, `authorization.md`,
`playwright.md`.

Exemplars: T10 and T11 (work shapes and validation), T18 (fan-out reads),
T03 (provider commands).

## Steps

1. Provider reads (`org:fulfil_engagements`), live from each client tenant
   with one deadline, naming tenants that did not answer: Work queue
   (routed candidacies; client, Capability, Opening, stage, status filters;
   upcoming interviews first) and Jobs (assigned sourcing Openings with
   client, title, employing country, state, assigned date, own credited
   count). Each read re-checks engagement, assignment, route, and
   application state at the consumer tenant (MKT-ACC-003).
2. A routed work item shows only the snapshot, cover note, stage name, and
   the provider's own work (MKT-ACC-002 lists what never appears).
3. Provider commands to the consumer tenant: interviews with the provider's
   own interviewers holding `org:fulfil_engagements`, outcomes, feedback;
   assessment results; background-check outcomes after consent.
4. The Hub application detail names the provider performing a step.

## Tests

Playwright API: every MKT-ACC boundary including after end and reroute, an
agency also engaged for a stage seeing no credit, work by provider users
across regions, consumer seeing all provider work, a client tenant not
answering.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Providers do routed work and see nothing beyond it.

## Carried over

- From T11: provider performers need a performer column on `org_background_checks` and provider `WorkPerformer` values; the Hub consent detail must then name the provider. Store and expose the consent disclosure copied at routing (MKT-DAT-009).
