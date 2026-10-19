# T26 Orgs portal Find providers, engagements, and routing

Requirements: MKT-UI-001, MKT-UI-002, MKT-UI-010, the Hiring row of the
navigation table, MKT-ASG (routing in application detail), MKT-SRC-007,
MKT-STM (consumer statement view), HP-ORG-001 (routed-provider filter).

Guides: `ui.md`, `ux.md`, `typescript.md`, `marketplace.md`,
`playwright.md`.

Mockups: `orgs-05`, `orgs-07` (route picker), `orgs-16` to `orgs-19`.

Exemplars: T13 and T14 pages; `orgs-ui/src/pages/OpeningsPage.tsx`.

## Steps

1. Find providers: Capability tabs, country and language filters, search,
   incomplete-results notice, Listing detail with Propose engagement, and
   the engagements tab.
2. Engagement detail: references (own editable), assignments, proposal,
   end with note, monthly activity statement with browser CSV export.
3. Opening Providers tab: sourcing agencies and stage providers with add and
   remove and the caps.
4. Application detail: route picker per stage; credited agency and route;
   Candidates filter by routed provider and credit.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: search to proposal, end an engagement, assign, route, export
a statement.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

A consumer finds, engages, assigns, and routes providers from the portal.

## Carried over

- From T13: add the Providers tab to the tab array in `orgs-ui/src/pages/OpeningDetailPage.tsx` and Find providers to the Hiring nav group in `AppShell.tsx`; add the Pipeline tab's "in-house only" / "provider assigned" notes beside stages from engagements data.
