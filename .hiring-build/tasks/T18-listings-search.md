# T18 Listings and provider search

Requirements: MKT-GEN-001 to MKT-GEN-003, MKT-LST-001 to MKT-LST-006,
MKT-DIR-001 to MKT-DIR-003, MKT-PLN-001 (downgrade), `org-listing-*`
problems, `org-tenant-unavailable`.

Guides: `marketplace.md`, `mesh-topology.md`, `federation.md` (Reads and
privacy), `org-subscriptions.md`, `typespec.md`, `backend.md`,
`database.md`, `authorization.md`, `playwright.md`.

Exemplars: commit `9d95b8d` (a mesh read with relay and peer routes and a
deadline); `backend/internal/publicopeningclient/`;
`backend/handlers/mesh/openings.go`; `org_subscriptions.sql` (plan change
transaction).

## Steps

1. Schema: Listings (provider Org, Capability, headline, Markdown
   description, service countries or worldwide, languages, indicative price
   text, check types and consent disclosure for `background_check`, state
   `draft`/`listed`/`unlisted`). No amount or fee column anywhere.
2. Provider API (`org:manage_listings`): create, update, list, unlist,
   delete draft; listing needs `allows_listings`
   (`org-listing-plan-required`). The plan-change transaction unlists every
   `listed` Listing when the new plan lacks the entitlement.
3. Search (`org:manage_providers`): the caller's orgs-api asks every
   tenant's mesh peer in parallel with one deadline, merges by case-folded
   provider name then domain with a composite keyset cursor (≤50), and names
   unavailable tenants in the response. Find how the tenant list is known
   (`mesh-topology.md`, `backend/internal/appconfig/`); if none exists, add
   it per that guide or record BLOCKED. Never cache another tenant's
   Listings.
4. Listing detail (provider name, domain, logo when allowed, country,
   fields) by (domain, Capability), local or remote.

## Tests

Playwright API: Listing validation per Capability, plan gate and downgrade,
search filters and ordering across regions, pagination, one tenant
unavailable, suspended provider hidden, no money fields in any response.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Any Org finds listed providers in every region.
