# T09 Hub portal Org and Opening pages

Requirements: OPN-HUB-001 to OPN-HUB-008, OPN-CNT-003, OPN-CNT-004.

Guides: `ui.md` (Global portals and regions, noindex), `typescript.md`,
`hub-profile.md` (signed-in profile viewing, the pattern to copy),
`playwright.md`, `verification.md`.

Exemplars: `hub-ui/src/pages/ProfileViewPage.tsx` and
`features/profile/queries.ts` (signed-in read, returnTo, unavailable
state), `hub-ui/src/pages/OrgPage.tsx` (the placeholder to replace),
`hub-ui/src/app/App.tsx`, `playwright/ui/hub-org-page.spec.ts` and
`hub-profile-view.spec.ts`.

## Steps

1. API hooks for `list-org-openings` and `get-org-opening`.
2. `/org/:domain`: requires sign-in (anonymous visitors sign in and come
   back); Org header with name, domain, and logo; filters and keyset
   pagination; empty, not-found, and unavailable states.
3. `/org/:domain/openings/:number`: `OpeningContentView` from portal-ui for
   published Openings; a not-accepting notice with the title otherwise;
   not-found state.
4. Keep `NoIndex` and the `/org/` noindex header; the CSP must still allow
   tenant media origins for logos only.
5. Every string in every hub-ui locale.
6. Playwright UI tests: replace the placeholder assertions in
   `hub-org-page.spec.ts`; signed-out redirect and return; an Org in
   another region; filters; detail of published and not-accepting
   Openings; not-found and unavailable states; Markdown rendering without
   raw HTML.

## Checks

`make hub-ui-check`, `make portal-ui-check`, `make playwright-check`, then
`make test`.
