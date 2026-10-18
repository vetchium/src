# T27 Orgs portal Listings, Clients, and Work queue

Requirements: MKT-UI-003 to MKT-UI-005, MKT-UI-010, the Provider row of the
navigation table, MKT-WRK (provider pages).

Guides: `ui.md`, `ux.md`, `typescript.md`, `marketplace.md`,
`playwright.md`.

Mockups: `provider-01` to `provider-08`.

Exemplars: T15 (work panels), T26 (engagement detail).

## Steps

1. Provider navigation group, shown when the Org has a Listing or a provider
   engagement (the API still decides).
2. Listings: one card per Capability, the plan screen in place of controls
   without `allows_listings`, the editor (check types and consent disclosure
   for background checks) with a preview.
3. Clients: proposals first with accept and decline, then active and ended;
   detail with references and statements.
4. Work queue and work item pages for interviewing, assessment, and
   background check.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: list a service, Free-plan screen, accept a proposal, schedule
and give feedback on routed work, record a background-check outcome.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

A provider runs its whole side from the portal.
