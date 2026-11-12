# T06 Portal UI: Opening tag names, icons, chips, and picker

## Requirements

OPN-TAG-004, OPN-TAG-005, OPN-TAG-008 (picker offers), OPN-ORG-008
(`OpeningView` part).

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`portal-ui/AGENTS.md` if present, `agent-guides/openings.md`.

## Exemplars

`portal-ui/src/openings/` (module layout, `index.ts`, `OpeningView.tsx`
labels and formatters), `portal-ui/src/localization.ts` and its test (pure
logic tested with `node --test`), `portal-ui/package.json` `exports`.

## Steps

1. Create `portal-ui/src/opening-tags/names.ts`: `type OpeningTagCatalog =
   ReadonlyMap<string, OpeningTag>` (from `typespec/common/opening_tags`),
   `openingTagCatalog(response)` building it, and `openingTagName(catalog,
   oid, locale)`: the `localized_names` entry for `new
   Intl.Locale(locale).language`, else `display_name`, else the OID
   (OPN-TAG-004). Add `openingTagMatches(tag, query, locale)` for the
   picker: case-insensitive substring on the default name, the locale name,
   and the OID.
2. Icons: download the newest `simple-icons` npm release that is at least two
   weeks old with `npm pack simple-icons@<version>` into the session scratch
   directory (never into the repository, never as a dependency), and read
   `package/icons/<slug>.svg` for slugs `go` (`golang`), `python`, `java`,
   `javascript`, `typescript`, `rust`, `csharp` (`c-sharp`), `cplusplus`
   (`c-plus-plus`), `kotlin`, `swift`, `php`. `sql` has none. Skip a slug the
   release lacks. Create `portal-ui/src/opening-tags/icons.tsx` with a map
   from OID to the `<path d>` string, a comment naming the Simple Icons
   version and CC0 1.0 licence, and `OpeningTagIcon({ oid })` rendering a
   24×24 `viewBox` `<svg>` with `fill="currentColor"`, `aria-hidden`, sized
   to `1em`, or Ant Design `TagOutlined` when the map has no entry.
3. `portal-ui/src/opening-tags/OpeningTagList.tsx`: renders tags in the
   given order as Ant Design `Tag`s with `OpeningTagIcon`, inside a list with
   an accessible label prop; nothing when empty.
4. `portal-ui/src/opening-tags/OpeningTagSelect.tsx`: Ant Design `Select`
   `mode="multiple"` with `maxCount={maxOpeningTags}`, `showSearch` using
   `openingTagMatches`, options in default-name order from the catalog
   excluding deprecated tags not already in `value`, option labels with the
   icon and name; props for value, onChange, locale, catalog, and every
   label or placeholder (no translation keys inside `portal-ui`).
5. `portal-ui/src/opening-tags/index.ts` exporting the above; add
   `"./opening-tags": "./src/opening-tags/index.ts"` to `exports`.
6. `OpeningView`: add `tags` to `OpeningContentLabels` and `tag: (oid:
   string) => string` to `OpeningContentFormatters`; render
   `OpeningTagList` after the facts when `content.tags` is non-empty. Update
   every portal caller that builds these labels and formatters
   (`git grep -n "OpeningContentFormatters\|OpeningContentLabels"
   hub-ui/src orgs-ui/src`) with a temporary formatter returning the OID and
   a `tags` label in every locale of that portal, so all portals compile; T07
   and T08 replace the formatter with catalog names.
7. Tests: `portal-ui/src/opening-tags.test.ts` for `openingTagName` (`ta`,
   `de-DE`, `en-US`, a locale with no entry, an unknown OID) and
   `openingTagMatches` (default name, localized name, OID, no match).

## Tests

`portal-ui/src/opening-tags.test.ts`; the portal checks prove every
consumer compiles.

## Checks

`make portal-ui-check`, `make hub-ui-check`, `make orgs-ui-check`,
`make admin-ui-check`, then `make test`.

## Acceptance

- Names resolve by portal language with the fallbacks of OPN-TAG-004.
- Programming-language tags show their Simple Icons icon; others
  `TagOutlined`.
- `OpeningView` shows tags in every portal that renders it.

## Carried over
