# T08 Hub portal: Opening tags on the Org and Opening pages

## Requirements

OPN-HUB-002 (tag filter, card tags), OPN-TAG-004, OPN-TAG-012, OPN-HUB-008.

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/playwright.md`, `hub-ui/AGENTS.md` if present,
`agent-guides/openings.md`.

## Exemplars

`hub-ui/src/features/openings/OrgPage.tsx` (filters and cards),
`hub-ui/src/features/openings/OrgOpeningPage.tsx` (`OpeningView`
presentation), T07's `useOpeningTags`.

## Steps

1. A `useOpeningTags()` hook in `hub-ui/src/features/openings/` calling
   `POST /api/hub/list-opening-tags`, `staleTime:
   Number.POSITIVE_INFINITY`, returning an `OpeningTagCatalog`.
2. The Hub `tag` formatter uses `openingTagName` with the portal locale;
   replace T06's temporary formatter.
3. `OrgPage`: a tag filter beside the existing filters (catalog tags not
   deprecated, searchable), kept in the URL like them, sending `tag_oid`;
   each Opening card shows `OpeningTagList` for its `tags`.
4. `OrgOpeningPage` shows tags through `OpeningView`.
5. Strings in every `hub-ui/src/i18n/locales/` file.
6. Playwright UI, `playwright/ui/hub-org-page.spec.ts`: cards show tag names
   (a German name in `de-DE`, the default name in `ta` for a tag without a
   Tamil name); filtering by tag narrows the list and survives reload; the
   Opening page shows its tags.

## Tests

`playwright/ui/hub-org-page.spec.ts`.

## Checks

`make hub-ui-check`, `make playwright-check`, the spec against
`make test-environment`, then `make test`. Take the `ux.md` screenshot check
of the Org page and Opening page at phone and desktop widths.

## Acceptance

- Hub users see tags in their language and filter an Org's Openings by tag.

## Carried over
From T06: OpeningView now shows tags with a temporary formatter returning the OID; replace it in hub-ui/src/features/openings/presentation.ts with openingTagName from the catalog, and run the ux.md screenshot check of the tags in OpeningView (light, dark, 390px, German).
