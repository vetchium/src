# T11 Openings: Ideal job match contracts and query

## Requirements

OPN-SRCH-005 (key), OPN-SRCH-013, OPN-SRCH-014 (mesh shape), OPN-SRCH-015,
OPN-SRCH-008, problem type `hub-ideal-job-missing`.

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/go.md`,
`agent-guides/typescript.md`, `agent-guides/database.md`,
`backend/internal/db/AGENTS.md`, `agent-guides/openings.md`.

## Exemplars

T01's `typespec/hub/openings/search.tsp`, `search.go`, `search.ts`, and
`search_test.go`; `HubRegionUnavailableError` in
`typespec/problem/hub/openings.tsp` with its `.go` and `.ts`; T02's
`SearchOpenings` in `backend/internal/db/queries/opening_search.sql` and
`backend/internal/openingsearch/read.go` (cursor) with `read_test.go`;
`vetchium.array_is_distinct` in `db/migrations/00001_init.sql` (a helper
function and its place in the down section).

## Steps

1. Problem: `HubIdealJobMissingError` (`hub-ideal-job-missing`, 422, title
   "Ideal job missing", detail "Save your ideal job in Preferences to sort
   by match") with its response alias and Go and TypeScript companions.
2. Contract in `search.tsp`:
   - Move T01's filter fields (every OPN-SRCH-004 field, `pagination_key?`,
     `limit?`) into `OpeningSearchFilters`.
   - `union OpeningSearchSort { "newest", "ideal_job_match" }`.
   - `SearchOpeningsRequest` = `...OpeningSearchFilters`, `sort?:
     OpeningSearchSort = "newest"`, `region?`. It has no text field; the
     strict decoder refuses one.
   - `OpeningSearchQuery` (the relay and peer body and the reader input) =
     `...OpeningSearchFilters`, `sort?`, `ideal_job_text?:
     Vetchium.Hub.IdealJob` (doc: present exactly when `sort` is
     `ideal_job_match`; used only to match and rank; never logged, stored,
     or audited, OPN-SRCH-014).
   - `search-openings` also answers `HubIdealJobMissingErrorResponse`.
3. Go and TypeScript companions: `Validate` refuses an unknown `sort` as
   `sort`; `OpeningSearchQuery.Normalize` trims `ideal_job_text`, and
   `Validate` refuses it (as `ideal_job_text`) when absent or empty under
   `ideal_job_match`, present under `newest`, or over 2,000 code points.
   Tests in `search_test.go` and `typespec/hub/contract.test.ts` for each
   case. Regenerate the OpenAPI output.
4. Schema in `db/migrations/00001_init.sql`, before `org_opening_contents`:
   - `vetchium.opening_search_document(title text, tag_oids text[],
     description text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL
     SAFE`: `setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
     setweight(to_tsvector('simple', replace(coalesce(array_to_string(tag_oids,
     ' '), ''), '-', ' ')), 'B') || setweight(to_tsvector('simple',
     coalesce(description, '')), 'C')` (comment: declared immutable so a
     generated column may use it; `array_to_string` over `text[]` does not
     vary).
   - `vetchium.ideal_job_tsquery(ideal_job text) RETURNS tsquery LANGUAGE
     sql IMMUTABLE PARALLEL SAFE`: `SELECT to_tsquery('simple',
     string_agg('''' || replace(replace(lexeme, '\', '\\'), '''', '''''')
     || '''', ' | ')) FROM unnest(to_tsvector('simple', ideal_job))`; NULL
     when the text has no lexeme.
   - `org_opening_contents.search_document tsvector GENERATED ALWAYS AS
     (vetchium.opening_search_document(title, tag_oids, description))
     STORED`, and `CREATE INDEX org_opening_contents_search_document_idx ON
     vetchium.org_opening_contents USING gin (search_document)`.
   - Drop both functions in the down section.
5. Query: extend `SearchOpenings` with `sqlc.narg(ideal_job_text)::text`.
   In a CTE compute `tsq = vetchium.ideal_job_tsquery(ideal_job_text)`.
   Filter `(ideal_job_text IS NULL OR (tsq IS NOT NULL AND
   c.search_document @@ tsq))`; select `rank = CASE WHEN ideal_job_text IS
   NULL THEN 0 ELSE ts_rank(c.search_document, tsq) END::real`; order `rank
   DESC` before T02's order tuple and add `sqlc.narg(cursor_rank)::real` to
   the keyset predicate. Run `make sqlc`.
6. Reader `backend/internal/openingsearch/read.go`: pass the text only under
   `ideal_job_match`; the cursor gains `sort`, `ideal_job_digest` (hex
   SHA-256 of the normalized text, absent under `newest`), and the last
   row's `rank` as `float32`; a mismatch in any is `ErrInvalidPaginationKey`.
   Never log the text. Tests in `read_test.go`: round trip with a rank, a key
   rejected after the sort changes and after the text changes, and no text
   passed under `newest`.

## Tests

`typespec/hub/openings/search_test.go`, `typespec/hub/contract.test.ts`,
`backend/internal/openingsearch/read_test.go`. T12's Playwright spec proves
the database ranking.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make migration-check`,
`make test-go`, `make test-go-static`, then `make test`.

## Acceptance

- The contract carries `sort` and the mesh-only `ideal_job_text`, the reader
  ranks by match, and a newest search behaves exactly as before.

## Carried over
