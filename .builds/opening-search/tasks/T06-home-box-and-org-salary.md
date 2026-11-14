# T06 Hub portal: Home search box and salary on Org page cards

## Requirements

OPN-SRCH-011, OPN-HUB-002 (salary on cards), OPN-SRCH-012.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md`, `agent-guides/openings.md`.

## Exemplars

`hub-ui/src/pages/HomePage.tsx`; T05's
`hub-ui/src/features/openings/OpeningCard.tsx`;
`hub-ui/src/pages/OrgPage.tsx` cards; `playwright/ui/hub-org-page.spec.ts`.

## Steps

1. Home: a card at the top of `HomePage.tsx` with an `Input.Search`
   labelled for Opening search; submitting navigates to
   `/openings?q=<trimmed keyword>`, or `/openings` when empty.
2. Org page: replace the inline Opening card in `OrgPage.tsx` with
   `OpeningCard` (no Org header), so salary shows when disclosed.
3. Strings in `en.ts`, `de.ts`, and `ta.ts`.
4. Playwright UI: in `playwright/ui/hub-opening-search.spec.ts`, Home's box
   opens `/openings` with the keyword applied and empty submit opens it
   unfiltered; in `playwright/ui/hub-org-page.spec.ts`, a card shows the
   salary and a card without one shows none.

## Tests

`playwright/ui/hub-opening-search.spec.ts`,
`playwright/ui/hub-org-page.spec.ts`.

## Checks

`make hub-ui-check`, `make playwright-check`, both specs against
`make test-environment`, then `make test`; `ux.md` screenshot check of Home
and the Org page at phone and desktop widths.

## Acceptance

- Home starts a search; Org page cards match search cards.

## Carried over
