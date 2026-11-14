# T13 Hub portal: Ideal job match sort on Opening search

## Requirements

OPN-SRCH-009 (`sort` in the URL), OPN-SRCH-016, OPN-SRCH-012.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md`, `agent-guides/openings.md`.

## Exemplars

T05's `hub-ui/src/pages/OpeningSearchPage.tsx` (URL filters, dropping refused
values) and `playwright/ui/hub-opening-search.spec.ts`; `useMyInfoQuery` in
`hub-ui/src/features/profile/queries.ts`; `APIErrorAlert`.

## Steps

1. A sort `Select` above the results: "Newest" and "Best match for my ideal
   job". URL `sort=match` maps to `ideal_job_match`; absent means `newest`;
   any other value is dropped. Changing it restarts paging.
2. Without `ideal_job` in my-info, the match option is disabled with an "Add
   your ideal job" link to `/settings/preferences`, and a `sort=match` URL is
   dropped. A `hub-ideal-job-missing` answer shows an alert with the same
   link instead of the generic error.
3. Strings under `openingSearch` in `hub-ui` `en.ts`, `de.ts`, and `ta.ts`.
4. Playwright UI in `playwright/ui/hub-opening-search.spec.ts`: a user
   without an ideal job sees the option disabled and the link opens
   Preferences; a `sort=match` URL is dropped for them; a user with one
   chooses match, sees ranked results, and the sort survives reload and
   back; the option works with another region selected.

## Tests

`playwright/ui/hub-opening-search.spec.ts`.

## Checks

`make hub-ui-check`, `make playwright-check`, the spec against
`make test-environment`, then `make test`. `ux.md` screenshot check of
`/openings` with the sort control at phone and desktop widths, light and
dark.

## Acceptance

- A Hub user can sort any region's search by their ideal job, and is told how
  to add one when missing.

## Carried over
