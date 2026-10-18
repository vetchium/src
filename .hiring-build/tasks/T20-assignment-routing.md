# T20 Assignment and routing

Requirements: MKT-ASG-001 to MKT-ASG-004, MKT-AUTH-002, MKT-DAT-009,
MKT-ENG-004 (removal on end), HP-STA-002 (provider access),
`org-engagement-capability-mismatch`.

Guides: `marketplace.md`, `hiring-pipeline.md`, `typespec.md`,
`backend.md`, `database.md`, `playwright.md`.

Exemplars: T05 (pipeline stages), T19 (engagements), T11 (consent).

## Steps

1. Assign active `sourcing` engagements to a non-terminal Opening (≤20) and
   active stage-Capability engagements to a matching stage (≤10); unassign.
2. Route each candidacy at a stage in-house or to one engagement assigned to
   that stage; rerouting ends the previous provider's access; recorded work
   stays. Routing needs the rights to act on the candidacy.
3. Routing to a `background_check` provider copies the Listing's current
   consent disclosure from the provider tenant onto the consent request.
4. Ending an engagement removes its assignments and routes in its
   transaction (finish T19's hook); leaving a stage or the pipeline ends
   access.

## Tests

Playwright API: caps, Capability mismatch, routing and rerouting, disclosure
copy, end removing assignments, permissions.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Consumers attach providers to Openings and stages and route candidacies.

## Carried over

- Add the HP-ORG-001 "routed provider" filter to `list-applications`
  (T06 left it out because routes did not exist).
