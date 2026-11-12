# T05 Marketplace: Tag filter on the agency Jobs list

## Requirements

OPN-TAG-011, MKT-OWN-004 (tag filter at the client tenant), OPN-TST-004
(Jobs part).

## Guides

`agent-guides/typespec.md`, `agent-guides/go.md`, `agent-guides/backend.md`,
`agent-guides/database.md`, `agent-guides/federation.md`,
`agent-guides/marketplace.md`, `agent-guides/playwright.md`.

## Exemplars

The `employing_country` filter of `list-jobs`: `ListJobsRequest` in
`typespec/orgs/marketplace/work/work.tsp`, `PeerListJobsRequest` (and
`RelayListJobsRequest`, which wraps it) in
`typespec/orgs/marketplace/work/federation.tsp`,
`backend/internal/orgs/workfanout/fanout.go`,
`backend/internal/providerwork/reads.go`,
`backend/handlers/mesh/provider_work.go`, `backend/handlers/orgs/work/read.go`,
and `ListProviderJobs` in `backend/internal/db/queries/org_provider_work.sql`.

## Steps

1. Contract: add `tag_oid?: Vetchium.OpeningTagOID;` to `ListJobsRequest` and
   `PeerListJobsRequest`, with Go and TypeScript companions validating it
   (field `tag_oid`) and tests.
2. Query: in `ListProviderJobs` add `AND (sqlc.narg(tag_oid)::text IS NULL OR
   sqlc.narg(tag_oid)::text = ANY(c.tag_oids))`. Run `make sqlc`.
3. Go: carry `tag_oid` from `list-jobs` through the fan-out to each client
   tenant and into the query, exactly as `employing_country` travels. Update
   `fanout_test.go` and `reads_test.go` where they assert forwarded filters.
4. Playwright: in `playwright/api/org-provider-work.spec.ts` (or
   `org-job-owners.spec.ts` if the Jobs list tests live there), list Jobs by
   `tag_oid` for a client in the agency's tenant and in another tenant, and a
   malformed `tag_oid` is `validation-failed`.

## Tests

`typespec/orgs/work.test.ts`, the work companion Go tests,
`backend/internal/orgs/workfanout/fanout_test.go`,
`backend/internal/providerwork/reads_test.go`, and the Playwright spec in
step 4.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the spec against
`make test-environment`, then `make test`.

## Acceptance

- `list-jobs` filters by tag at every client tenant.

## Carried over
