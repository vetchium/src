# T05 Hub portal: Opening search page

## Requirements

OPN-SRCH-009, OPN-SRCH-010, OPN-SRCH-012, OPN-TAG-004, OPN-HUB-001
(`NoIndex`).

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md`, `agent-guides/openings.md`.

## Exemplars

`hub-ui/src/pages/OrgPage.tsx` (URL-kept filters, `filtersFromSearch`,
paging, cards, error states); `hub-ui/src/features/openings/queries.ts`
(`useOrgOpeningsQuery`, `useOpeningTags`); `hub-ui/src/features/openings/presentation.ts`
(salary formatting); `hub-ui/src/features/regions/RegionField.tsx` and
`hub-ui/src/app/regions.ts`; `@vetchium/portal-ui/opening-tags`
(`OpeningTagSelect`, `OpeningTagList`); `hub-ui/src/components/common/AppShell.tsx`
(navigation); `hub-ui/src/app/App.tsx` (lazy routes);
`playwright/ui/hub-org-page.spec.ts`.

## Steps

1. API client: `searchOpenings` and `suggestOpeningOrgs` in
   `hub-ui/src/api/hub.ts`; `useOpeningSearchQuery` and
   `useOpeningOrgSuggestions` (enabled at two or more characters, debounced
   300 ms) in `hub-ui/src/features/openings/queries.ts`.
2. `hub-ui/src/features/openings/OpeningCard.tsx`: the OPN-SRCH-010 card,
   taking a `PublicOpeningSummary`, the Org domain, and an optional
   `PublicOrg` to show the logo and name; salary through the existing
   presentation formatter; tags through `OpeningTagList`.
3. `hub-ui/src/pages/OpeningSearchPage.tsx` at `/openings` (lazy route in
   `App.tsx`, inside the authenticated layout): every OPN-SRCH-009 control
   with URL parameters `q`, `region`, `org`, `tag`, `country`,
   `arrangement`, `employment` (repeated), `posted`, `experience`,
   `education`, `salary=1`; validate with `validateSearchOpeningsRequest`
   and drop refused values; omit `region` from the request when it equals
   the session region; clear `org` when the region changes; restart paging
   on any change; previous and next paging like `OrgPage`; loading, empty,
   region-unavailable (naming the region), and `APIErrorAlert` states;
   `NoIndex`; document title.
4. Navigation: add `/openings` with `SearchOutlined` after Home in
   `AppShell.tsx` and to `navigationPaths`.
5. Strings under a new `openingSearch` key in `hub-ui/src/i18n/locales/en.ts`,
   `de.ts`, and `ta.ts` (navigation label, filters, options, states).
6. Playwright UI `playwright/ui/hub-opening-search.spec.ts`: navigation
   entry opens the page; keyword, tag, country, arrangement, and salary
   filters narrow results and survive reload and back; a hand-edited
   invalid parameter is dropped; the Org typeahead suggests and filters, and
   clears on region change; choosing `usa1` shows a remote Org's Opening; a
   card links to the Opening and Org pages; empty and region-unavailable
   (`ind1`) states; a German-locale tag name.

## Tests

`playwright/ui/hub-opening-search.spec.ts`.

## Checks

`make hub-ui-check`, `make portal-ui-check` if `portal-ui` changed,
`make playwright-check`, the spec against `make test-environment`, then
`make test`. Take the `ux.md` screenshot check of `/openings` at phone and
desktop widths, light and dark, and in German.

## Acceptance

- A Hub user finds Openings in any region with every filter, and the URL
  restores the search.

## Carried over
- From T04: CI `sgp` reaches the `ind1` peer directly and search never calls the coordinator, so `region: "ind1"` answers 200; reach `hub-region-unavailable` with an uncatalogued region such as `gone` (OPN-TST-005 now says so).
