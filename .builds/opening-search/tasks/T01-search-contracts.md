# T01 Openings: Opening search contracts

## Requirements

OPN-SRCH-001, OPN-SRCH-002 (mesh shapes), OPN-SRCH-004, OPN-SRCH-005
(limit, key), OPN-SRCH-006, OPN-SRCH-007, OPN-HUB-002 (salary on
summaries), problem type `hub-region-unavailable`.

## Guides

`agent-guides/typespec.md`, `agent-guides/go.md`,
`agent-guides/typescript.md`, `agent-guides/federation.md`,
`agent-guides/openings.md`, `typespec/AGENTS.md`.

## Exemplars

`ListOrgOpeningsRequest`, `ListOrgOpeningsResponse`, `OrgOpeningOperations`
in `typespec/hub/openings/public.tsp` with `public.go` (`Normalize`,
`Validate`, `EffectiveLimit`), `public.ts` (`normalizeListOrgOpeningsRequest`,
`validateListOrgOpeningsRequest`), and `public_test.go`; the relay and peer
interfaces in `typespec/hub/openings/federation.tsp`; `HubOrgUnavailableError`
in `typespec/problem/hub/openings.tsp` with its `.go` and `.ts`; the tag
filter tests in `typespec/hub/contract.test.ts`.

## Steps

1. Problem: add `HubRegionUnavailableError` (`hub-region-unavailable`, 503,
   title "Region unavailable", detail "The requested region is temporarily
   unavailable") and its response alias to `typespec/problem/hub/openings.tsp`,
   with Go and TypeScript companions like `HubOrgUnavailableError`.
2. Salary: add `salary?: Vetchium.OpeningSalary;` to `PublicOpeningSummary`
   in `public.tsp` (doc: absent when not disclosed, OPN-HUB-002), and the
   field to the Go struct (`*common.OpeningSalary`, `omitempty`) and the
   TypeScript interface.
3. New `typespec/hub/openings/search.tsp` (import it in
   `typespec/hub/hub.tsp`), namespace `Vetchium.Hub.Openings`:
   - Scalars: `OpeningSearchKeyword` (string, 2–200), `OrgSuggestionQuery`
     (string, 2–100), `OpeningSearchPageSize` (int32, 1–50).
   - `OpeningSearchQuery` with every OPN-SRCH-004 field (`keyword?`,
     `org_domain?: Vetchium.Orgs.OrgDomain`, `tag_oids?` (1–5),
     `work_countries?` (1–10), `work_arrangements?` (1–3),
     `employment_types?` (1–4), `posted_within_days?: 1 | 7 | 30`,
     `experience_years?` (int32 0–50), `education_level?:
     Vetchium.OpeningEducation`, `salary_disclosed?: boolean`), plus
     `pagination_key?` and `limit?: OpeningSearchPageSize = 20`.
   - `SearchOpeningsRequest` = `OpeningSearchQuery` plus `region?:
     Vetchium.Directory.TenantID` (check the namespace in
     `typespec/directory/`).
   - `OpeningSearchResult { org: PublicOrg; opening: PublicOpeningSummary; }`
     and `SearchOpeningsResponse { openings: OpeningSearchResult[];
     next_pagination_key?: Vetchium.PaginationKey; }`.
   - `SuggestOpeningOrgsQuery { query: OrgSuggestionQuery; }`,
     `SuggestOpeningOrgsRequest` = that plus `region?`, `SuggestOpeningOrgsResponse { orgs: PublicOrg[]; }` (doc: at
     most 10).
   - Interface `OpeningSearchOperations` at `/api/hub`, tag "Hub Opening
     Search", `@useAuth(BearerAuth)`: `POST /search-openings` and
     `POST /suggest-opening-orgs`, each answering 200 (`Cache-Control:
     no-store`), `invalid-json`, `validation-failed`,
     `hub-authentication-required`, `hub-region-unavailable`,
     `internal-server-error`; search also `invalid-pagination-key`.
4. Mesh, in `search.tsp` beside `federation.tsp`'s pattern:
   `RelaySearchOpeningsRequest { tenant_id: TenantID; query:
   OpeningSearchQuery; }`, `RelaySuggestOpeningOrgsRequest { tenant_id;
   query: SuggestOpeningOrgsQuery; }`; relay interface at
   `/mesh/opening-search` (`/search`, `/suggest-orgs`, bearer, adding
   `MeshRelayAuthenticationRequiredErrorResponse`) and peer interface at
   `/api/mesh/opening-search` (same paths, body the bare query, problems
   `invalid-json`, `validation-failed`, `internal-server-error`, search also
   `invalid-pagination-key`). Doc on each: no viewer identity crosses the
   mesh (OPN-SRCH-002).
5. Go companion `typespec/hub/openings/search.go`: types, `Normalize`
   (trim keyword and query, lower-case `org_domain` like
   `ListOrgOpeningsRequest.Normalize`), `Validate() []string` naming each
   field (`keyword`, `org_domain`, `tag_oids` or `tag_oids.<i>` for a
   malformed or repeated OID, `work_countries`, `work_arrangements`,
   `employment_types`, `posted_within_days`, `experience_years`,
   `education_level`, `limit`, `region`, `query`), code-point lengths with
   `utf8.RuneCountInString`, `EffectiveLimit()`; relay request validation
   checks `tenant_id` with `directory.IsTenantID`. Unknown vocabulary values
   are refused on requests.
6. TypeScript companion `typespec/hub/openings/search.ts` with
   `normalizeSearchOpeningsRequest`, `validateSearchOpeningsRequest`,
   `normalizeSuggestOpeningOrgsRequest`, `validateSuggestOpeningOrgsRequest`
   matching the Go rules field for field.
7. Tests: `typespec/hub/openings/search_test.go` and cases in
   `typespec/hub/contract.test.ts` for every bound (keyword 1 and 2 and 200
   and 201 code points, 6 tags, a repeated tag, 11 countries, a repeated
   arrangement, `posted_within_days` 2, experience −1 and 51, an unknown
   education, `limit` 0 and 51, a malformed region, query lengths), and
   `PublicOpeningSummary` marshalling with and without `salary`.
8. Regenerate the OpenAPI output the way `make typespec-check` expects and
   commit it with the source.

## Tests

`typespec/hub/openings/search_test.go`, `typespec/hub/openings/public_test.go`
(salary), `typespec/hub/contract.test.ts`.

## Checks

`make typespec-check`, `make test-go`, `make test-go-static`, then
`make test`.

## Acceptance

- Both operations, their mesh relay and peer operations, the new problem
  type, and `PublicOpeningSummary.salary` exist in TypeSpec with matching Go
  and TypeScript companions and tests.
- No handler or route exists yet.

## Carried over
