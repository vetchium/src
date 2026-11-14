# T08 Hub portal: Job search card on Home and in Preferences

## Requirements

PROF-JOB-006, PROF-JOB-007, PROF-JOB-008.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md`,
`agent-guides/hub-profile.md`.

## Exemplars

`hub-ui/src/pages/PreferencesPage.tsx` (the `jobs` mutation and the Job
search card); `useMyInfoQuery` in `hub-ui/src/features/profile/queries.ts`;
`setPreferredJobCountries` in `hub-ui/src/api/hub.ts`; the biography editor's
code-point counter in `hub-ui/src/features/profile/` (search
`git grep -n "biography" hub-ui/src/features/profile`);
`hub-ui/src/pages/HomePage.tsx`; `playwright/ui/hub-foundation.spec.ts`
(Preferences cases).

## Steps

1. API: `setIdealJob`, `setLookingForJob`, `dismissJobSearchPrompt` in
   `hub-ui/src/api/hub.ts`; each mutation invalidates the my-info query.
2. New `hub-ui/src/features/profile/JobSearchFields.tsx`: the "My ideal job"
   textarea (code-point counter of 2,000, validated with
   `validateSetIdealJobRequest`) and the "Are you currently looking for a
   job?" switch, each with the PROF-JOB-007 helper text, reused by both
   screens.
3. Preferences: in the Job search card of `PreferencesPage.tsx`, below
   preferred job countries, the two fields. The textarea saves through a
   Save button (disabled while unchanged or invalid; empty clears the ideal
   job); the switch saves on change like the other switches.
4. Home: new `hub-ui/src/features/profile/JobSearchPromptCard.tsx`, shown on
   `HomePage.tsx` below the Opening search box while `ideal_job` is absent
   and `job_search_prompt_dismissed` is false: title "Your job search", the
   two fields, Save (enabled once the trimmed textarea holds text; calls
   `set-ideal-job`, then `set-looking-for-job`) and "Not now"
   (`dismiss-job-search-prompt`). Errors through `APIErrorAlert`; the card
   leaves after a successful Save or Not now.
5. Strings under `jobSearchPrompt` and `preferences` in
   `hub-ui/src/i18n/locales/en.ts`, `de.ts`, and `ta.ts`, including the exact
   English helper texts of PROF-JOB-007.
6. Playwright UI `playwright/ui/hub-job-search.spec.ts`: a new user sees the
   card; Save with text hides it and Preferences shows the saved text and
   switch; after reload it stays hidden; another new user's "Not now" hides
   it, and it stays hidden in a second browser context (server-side); with
   the ideal job cleared in Preferences and the prompt not dismissed, the
   card returns; Preferences edits both fields and refuses 2,001 code
   points; helper texts render in German.

## Tests

`playwright/ui/hub-job-search.spec.ts`.

## Checks

`make hub-ui-check`, `make playwright-check`, the spec against
`make test-environment`, then `make test`. `ux.md` screenshot check of Home
with the card and of Preferences at phone and desktop widths, light and dark,
and in German.

## Acceptance

- A new Hub user can save or dismiss the job-search prompt on Home, and edit
  both fields in Preferences, on any device.

## Carried over
