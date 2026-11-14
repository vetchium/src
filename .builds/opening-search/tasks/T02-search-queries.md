# T02 Openings: Opening search queries and reader

## Requirements

OPN-SRCH-003, OPN-SRCH-004, OPN-SRCH-005, OPN-SRCH-006, OPN-SRCH-007,
OPN-SRCH-008, OPN-HUB-002 (salary on summaries), OPN-HUB-004.

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/go.md`, `agent-guides/backend.md`, `agent-guides/openings.md`.

## Exemplars

`ListPublicOrgOpenings` in `backend/internal/db/queries/public_org_openings.sql`
(Org qualification, live slot, expiry, tag predicate, JSON summaries);
`backend/internal/publicopenings/read.go` (`cursor`, `parseCursor`,
`publicOrg` logo signing, `List`) and `read_test.go`; `org_openings_list_idx`
in `db/migrations/00001_init.sql`.

## Steps

1. Schema: in `db/migrations/00001_init.sql` beside the other
   `org_openings` indexes add `org_openings_search_idx ON vetchium.org_openings
   (first_published_at DESC, opening_number DESC) WHERE opening_state =
   'published'` (database.md: index every list's keyset order; pre-production,
   edit the init migration).
2. Salary on summaries: in `ListPublicOrgOpenings` select the salary columns
   and add `'salary', CASE WHEN c.salary_currency IS NULL THEN NULL ELSE
   jsonb_build_object('currency', …, 'min', …, 'max', …, 'period', …) END`
   to each summary, stripping a null `salary` (`jsonb_strip_nulls` on the
   object, keeping `tags`). Decode it in `publicopenings`.
3. New `backend/internal/db/queries/opening_search.sql`:
   - `SearchOpenings :many` over `org_openings` (published, `expires_at >
     now()`) joined to the live `org_opening_contents`, the active Org, and
     its `org_domains` row in `verified`, `failing`, or `releasing`, with
     nullable args for each OPN-SRCH-004 filter: keyword `strpos(lower(title),
     lower(q)) > 0 OR strpos(lower(display_name), lower(q)) > 0`;
     `d.domain = org_domain`; `c.tag_oids && tag_oids`; work countries
     `(c.work_arrangement IN ('on_site','hybrid') AND c.employing_country =
     ANY(countries)) OR (c.work_arrangement = 'remote' AND
     (c.remote_eligibility = 'worldwide' OR c.remote_countries &&
     countries))`; arrangements and employment types `::text = ANY`;
     `first_published_at >= now() - make_interval(days => n)`; experience
     `(experience_min IS NULL OR experience_min <= n) AND (experience_max IS
     NULL OR experience_max >= n)`; education `minimum_education IS NULL OR
     minimum_education <= level::vetchium.org_opening_education` (enum order
     is declaration order); `salary_currency IS NOT NULL` when
     `salary_disclosed`. Compute `matched_tags` as the count of requested
     tags the row holds (0 without `tag_oids`). Order `matched_tags DESC,
     first_published_at DESC, domain ASC, opening_number DESC`; keyset
     predicate on the same tuple with nullable cursor args; `LIMIT
     page_size`. Return the summary columns, salary, `tag_oids`, Org display
     name, country, domain, and active logo object id (logo rule as
     `ListPublicOrgOpenings`, including its `org_plan_oid` condition).
   - `SuggestOpeningOrgs :many`: qualifying Orgs with an Opening search
     could return (`EXISTS` on the same published, unexpired, live
     predicate), where `strpos(lower(display_name), lower(q)) > 0 OR
     d.domain LIKE lower(q) || '%'` (escape `%` and `_` in `q`), ordered
     `lower(display_name), domain`, `LIMIT 10`, returning domain, display
     name, country, logo object id.
   Run `make sqlc`.
4. New package `backend/internal/openingsearch` (doc comment: builds Opening
   search results at the answering tenant for local Hub and mesh peer
   reads): `Reader{Queries, Logos, TenantID}` with
   `Search(ctx, query OpeningSearchQuery) (SearchOpeningsResponse, error)`
   and `SuggestOrgs(ctx, SuggestOpeningOrgsQuery)
   (SuggestOpeningOrgsResponse, error)`. The cursor is base64url JSON of the
   normalized filters (sorted tag, country, arrangement, and employment
   lists, lower-cased keyword), the tenant id, and the last row's
   `matched_tags`, `first_published_at`, domain, and number; any mismatch is
   `ErrInvalidPaginationKey`. Fetch `limit + 1` rows to decide
   `next_pagination_key`. Sign each distinct logo once per call through
   `publicopenings.LogoSigner`. Log no keyword or query.
5. Unit tests `backend/internal/openingsearch/read_test.go` with a fake
   `Queries`: cursor round trip, a key rejected under each changed filter and
   another tenant id, page trimming, one signature per Org, and empty lists
   encoding as `[]`.

## Tests

`backend/internal/openingsearch/read_test.go`,
`backend/internal/publicopenings/read_test.go` (salary decode). Database
predicates are proved by T04's Playwright spec.

## Checks

`make sqlc`, `make sql-check`, `make migration-check`, `make test-go`,
`make test-go-static`, then `make test`.

## Acceptance

- One reader answers search and suggestions from the local database.
- Org page summaries carry `salary` when disclosed.

## Carried over
