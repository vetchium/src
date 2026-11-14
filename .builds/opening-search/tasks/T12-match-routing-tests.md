# T12 Openings: Ideal job match in hub-api and across regions

## Requirements

OPN-SRCH-002, OPN-SRCH-008, OPN-SRCH-013, OPN-SRCH-014, OPN-SRCH-015,
OPN-TST-005 (`ideal_job_match` cases), PROF-JOB-005.

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/federation.md`,
`agent-guides/playwright.md`, `playwright/AGENTS.md`,
`agent-guides/openings.md`.

## Exemplars

T03's `backend/handlers/hub/openings/search.go`,
`backend/handlers/mesh/opening_search.go`, and the search client with its
`client_test.go`; T09's `GetHubIdealJob`; T04's
`playwright/api/hub-opening-search.spec.ts` and `searchOpenings` in
`playwright/lib/hub-api.ts`; `setIdealJob` from T07.

## Steps

1. Hub handler `Search`: under `ideal_job_match`, read the caller's text
   with `GetHubIdealJob`; none is `hub-ideal-job-missing` before any region
   routing. Build `OpeningSearchQuery` from the request's filters and `sort`,
   adding `ideal_job_text` only under `ideal_job_match`, and pass it to the
   reader or the relay unchanged. Peer `validation-failed` and
   `invalid-pagination-key` keep their T03 mapping.
2. Relay and peer handlers validate the query with T11's rules and never log
   the body; check that no mesh-api or hub-api access log or error path
   writes a request body, and fix any that would.
3. Go tests: the search client sends `ideal_job_text` only under
   `ideal_job_match`; a hub handler test (where the package has handler
   tests) answers `hub-ideal-job-missing` without calling the relay.
4. Playwright, in `playwright/api/hub-opening-search.spec.ts`, every
   `ideal_job_match` case of OPN-TST-005, with one random token per test in
   titles, tags-as-words via an existing catalog tag, and descriptions so
   other tests' Openings cannot interfere (combine with `org_domain`):
   - a title match ranks above a tag match above a description match; an
     Opening sharing no word is excluded; `keyword`, `tag_oids`, and
     `work_countries` still filter;
   - ideal jobs containing an apostrophe and a backslash work; a
     punctuation-only ideal job returns no results;
   - no saved ideal job is `hub-ideal-job-missing` for the home region and
     for `usa1`; a request body holding `ideal_job_text` is refused;
   - two pages in rank order; a key reused after `set-ideal-job` changed the
     text, or with `sort` changed, is `invalid-pagination-key`;
   - `region: "usa1"` ranks a `usa1` Org's Openings through the mesh, and
     `ind1` is `hub-region-unavailable`;
   - an unknown `sort` is `validation-failed` `sort`.

## Tests

The Go tests in step 3, `playwright/api/hub-opening-search.spec.ts`.

## Checks

`make test-go`, `make test-go-static`, `make test-go-lint`,
`make playwright-check`, the spec against `make test-environment`, then
`make test`; read the coverage report and cover the new problem response.

## Acceptance

- A Hub user with a saved ideal job gets match-ranked results in any region;
  the text never leaves hub-api except as the peer query of that search.

## Carried over
- From T04: CI `sgp` reaches the `ind1` peer directly and search never calls the coordinator, so `region: "ind1"` answers 200; reach `hub-region-unavailable` with an uncatalogued region such as `gone` (OPN-TST-005 now says so).
