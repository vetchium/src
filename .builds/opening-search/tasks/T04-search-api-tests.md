# T04 Openings: Opening search API tests

## Requirements

OPN-TST-005; proves OPN-SRCH-001 to OPN-SRCH-007 and OPN-HUB-002 (salary).

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/openings.md`.

## Exemplars

`playwright/api/hub-org-openings.spec.ts` (local `sgp` and remote `usa1`
Orgs, `ind1` failing closed, suspended Org, released domain, cleanup);
`playwright/lib/hub-api.ts` (`listOrgOpenings`); Org Opening creation and
publishing helpers in `playwright/lib/orgs-api.ts`.

## Steps

1. Add `searchOpenings` and `suggestOpeningOrgs` to
   `playwright/lib/hub-api.ts`.
2. New `playwright/api/hub-opening-search.spec.ts`. Give every Opening a
   title holding one random token and search with that token as `keyword`
   (or with `org_domain`), because other tests publish in the same tenants.
   Cover:
   - each filter on both sides: keyword in title, in Org name, and missing;
     `org_domain`; `tag_oids` match any and the ranking by matched count;
     `work_countries` for on-site, hybrid, remote `worldwide`, remote
     `countries`, and a non-matching country; arrangements; employment
     types; `posted_within_days` (set `first_published_at` back with a
     fixture update as the table owner); experience below, inside, above,
     and open bounds; education below, equal, above, and none;
     `salary_disclosed`;
   - order and pagination across two pages, and a key reused with a changed
     filter as `invalid-pagination-key`;
   - exclusion of draft, paused, closed, and expired Openings, a suspended
     Org, and a released domain;
   - `region: "usa1"` finding a `usa1` Org through the mesh, and `region:
     "ind1"` from `sgp` as `hub-region-unavailable`;
   - `suggest-opening-orgs` by name substring and domain prefix, the 10
     cap, an Org with no published Opening excluded, and a remote region;
   - every `validation-failed` field from T01 for both operations,
     `hub-authentication-required`, and `invalid-json`;
   - no internal field in any result (assert exact key sets of `org` and
     `opening`), and `salary` present only when disclosed.
3. In `playwright/api/hub-org-openings.spec.ts` assert `salary` on a summary
   that discloses one and its absence otherwise.

## Tests

`playwright/api/hub-opening-search.spec.ts`,
`playwright/api/hub-org-openings.spec.ts`.

## Checks

`make playwright-check`, the two specs against `make test-environment`,
then `make test`; read the coverage report and cover every listed variant of
both operations.

## Acceptance

- Every non-5xx response of both operations is covered, and every
  OPN-TST-005 case has a named test.

## Carried over
