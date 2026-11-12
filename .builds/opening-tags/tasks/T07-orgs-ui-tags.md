# T07 Orgs portal: Opening tags in the editor, views, and filters

## Requirements

OPN-ORG-001 (tag filter), OPN-ORG-008, OPN-TAG-004, OPN-TAG-008,
OPN-TAG-010, MKT-UI-006 (tag under "More filters"), OPN-ORG-006.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `orgs-ui/AGENTS.md` if present,
`agent-guides/openings.md`, `agent-guides/marketplace.md`.

## Exemplars

`orgs-ui/src/features/openings/queries.ts` (query hooks),
`orgs-ui/src/features/openings/presentation.ts` (labels and formatters),
`orgs-ui/src/features/openings/OpeningEditor.tsx` (fields and `applyDraft`),
`orgs-ui/src/pages/OpeningsPage.tsx` (employing-country filter in the URL),
`orgs-ui/src/pages/OpeningDetailPage.tsx` (working-copy switch),
`orgs-ui/src/pages/JobsPage.tsx` ("More filters"),
`orgs-ui/src/pages/CompleteSignupPage.tsx` (`staleTime:
Number.POSITIVE_INFINITY`).

## Steps

1. `useOpeningTags()` in `orgs-ui/src/features/openings/queries.ts` calling
   `POST /api/orgs/list-opening-tags` through the feature's API helper, with
   `staleTime: Number.POSITIVE_INFINITY`, returning an `OpeningTagCatalog`.
2. Presentation: the `tag` formatter uses `openingTagName` with the current
   portal locale; replace T06's temporary formatter.
3. Editor: add a "Tags" field (`content.tags`) using `OpeningTagSelect`
   after the content fields it belongs with, with help text saying at most
   five. Sending an empty selection clears tags. Confirm `applyDraft` leaves
   `content.tags` untouched (drafts carry none); no publication-gap entry.
   Map `org-opening-tag-unknown` in `orgs-ui/src/features/openings/problems.ts`
   to a field error on Tags naming the unknown OIDs.
4. Detail and preview: tags render through `OpeningView`; the working-copy
   switch's changed-field list names Tags when `tags` differ from live
   (order included).
5. Openings list: a tag filter (`Select` with search over the catalog,
   deprecated excluded) kept in the URL like the other filters, sending
   `tag_oid`.
6. Jobs list: a tag filter under "More filters", kept in the URL, sending
   `tag_oid`. Job detail shows tags through `OpeningView`.
7. Strings for every new label, placeholder, help text, and error in
   `orgs-ui/src/i18n/locales/en.ts`, `de.ts`, and `ta.ts`.
8. Playwright UI: in `playwright/ui/orgs-openings.spec.ts`, pick two tags by
   searching a default name and a German name in the `de-DE` portal, save,
   see them on detail and preview; a sixth cannot be picked; clearing saves
   none; the working-copy switch names Tags after a tag-only revision; the
   list filter by tag narrows the list and survives reload. In
   `playwright/ui/orgs-marketplace-agency.spec.ts`, filter Jobs by tag under
   "More filters" and see tags on Job detail.

## Tests

The two Playwright UI specs in step 8.

## Checks

`make orgs-ui-check`, `make playwright-check`, the two specs against
`make test-environment`, then `make test`. Take the `ux.md` screenshot check
of the editor, detail, and both lists in `en-US` and `ta`.

## Acceptance

- Orgs users pick, see, and filter by tags in their portal language.

## Carried over
