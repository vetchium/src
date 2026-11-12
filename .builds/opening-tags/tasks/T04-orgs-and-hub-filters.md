# T04 Openings: Tag filter on the Orgs Openings list and the Hub Org page

## Requirements

OPN-TAG-011, OPN-TAG-012, OPN-ORG-001 (tag filter), OPN-HUB-002 (tag filter,
card tags), OPN-TST-004 (filter part).

## Guides

`agent-guides/typespec.md`, `agent-guides/go.md`, `agent-guides/backend.md`,
`agent-guides/database.md`, `agent-guides/federation.md` (mesh reads),
`agent-guides/playwright.md`, `agent-guides/openings.md`.

## Exemplars

The `employing_country` filter end to end: `ListOpeningsRequest` in
`typespec/orgs/openings/openings.tsp`, `ListOrgOpenings` in
`backend/internal/db/queries/org_openings.sql`,
`backend/handlers/orgs/openings/read.go`; `ListOrgOpeningsRequest` in
`typespec/hub/openings/public.tsp` (aliased by the mesh requests in
`typespec/hub/openings/federation.tsp`), `ListPublicOrgOpenings` in
`backend/internal/db/queries/public_org_openings.sql`,
`backend/internal/publicopenings/read.go`, `backend/handlers/mesh/openings.go`.

## Steps

1. Contract: add `tag_oid?: Vetchium.OpeningTagOID;` to `ListOpeningsRequest`
   and `ListOrgOpeningsRequest`, with Go and TypeScript companions validating
   it with `IsOpeningTagOID` (field `tag_oid`). Add `tags:
   Vetchium.OpeningTagOID[]` (required, `[]` when none, doc: OPN-HUB-002) to
   `PublicOpeningSummary` and its companions. Extend the companion tests.
2. Queries: in `ListOrgOpenings` add `AND (sqlc.narg(tag_oid)::text IS NULL
   OR sqlc.narg(tag_oid)::text = ANY(c.tag_oids))`. In
   `ListPublicOrgOpenings` add the same predicate on the live content, select
   `c.tag_oids`, and add `'tags', COALESCE(to_jsonb(page.tag_oids),
   '[]'::jsonb)` to each summary object. Run `make sqlc`.
3. Go: pass `tag_oid` through `backend/handlers/orgs/openings/read.go`,
   `backend/internal/publicopenings/read.go` (local and remote reads share
   one function, OPN-HUB-007), and the relay and peer list handlers in
   `backend/handlers/mesh/openings.go`; decode `tags` into
   `PublicOpeningSummary`. Update `backend/internal/publicopenings/read_test.go`.
4. Playwright: `playwright/api/orgs-openings.spec.ts` lists by `tag_oid`
   (matches, excludes an untagged and a differently tagged Opening, a
   well-formed catalog-less OID lists nothing, a malformed one is
   `validation-failed` with `tag_oid`). `playwright/api/hub-org-openings.spec.ts`
   lists by `tag_oid` for a local and a remote-tenant Org, asserts each
   summary's `tags` (and `[]` when none), and that `tags` carries OIDs only.

## Tests

Companion tests in `typespec/orgs/openings/openings_test.go`,
`typespec/orgs/openings.test.ts`, the Hub openings companion tests,
`backend/internal/publicopenings/read_test.go`, and the two Playwright specs
in step 4.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the two specs against
`make test-environment`, then `make test`.

## Acceptance

- Both lists filter by tag, the Hub one for local and remote Orgs alike.
- Hub summaries carry `tags`.

## Carried over
