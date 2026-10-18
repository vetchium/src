# T19 Engagements

Requirements: MKT-ENG-001 to MKT-ENG-005, MKT-GEN-004, MKT-GEN-005,
MKT-DAT-001, MKT-DAT-002, MKT-LST-004, MKT-LST-005, `org-engagement-*`
problems.

Guides: `marketplace.md`, `federation.md`, `typespec.md`, `backend.md`,
`database.md`, `authorization.md`, `playwright.md`.

Exemplars: T03 (provider commands to the consumer tenant), T04 (provider
projection), `backend/internal/workers/expire_org_openings.go` (expiry).

## Steps

1. Schema in the consumer tenant: engagements (consumer, provider DID,
   Capability, state, proposal message, each side's reference, timestamps,
   end note) with a partial unique index for one non-terminal engagement per
   (consumer, provider, Capability); refuse self-engagement. Provider tenant:
   the engagement projection (MKT-GEN-004).
2. Consumer (`org:manage_providers`): propose (reads the Listing and
   `allows_listings` from the provider tenant first; MKT-DAT-002), withdraw,
   end, set own reference. Provider (`org:manage_listings`): accept (its
   tenant re-checks both first), decline, end, set own reference, all as T03
   commands to the consumer tenant.
3. A `workers` job expires proposals after 30 days.
4. Ending removes the engagement's assignments and routes in the same
   transaction once T20 exists (leave a clear hook) and ends provider access
   at once.
5. Lists for each side (consumer: Find providers' engagements tab;
   provider: Clients, proposals first) and engagement detail.

## Tests

Playwright API: every transition across regions, duplicate and self
refusals, Listing not available, plan downgrade refusing new proposals,
suspended provider, expiry, references visible to both sides, projection on
the provider side.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Orgs in different regions engage each other and both see the same state.
