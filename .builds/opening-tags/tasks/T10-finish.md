# T10 Opening tags: Finish the build

## Requirements

Every requirement in `BRIEF.md`; the out-of-scope list.

## Guides

`agent-guides/review.md`, `agent-guides/verification.md`,
`agent-guides/feature-build.md` (final task).

## Exemplars

None.

## Steps

1. `README.md`: add only developer-facing changes (none expected; adding a tag
   means editing the seed in `db/migrations/00001_init.sql`, which belongs in
   `openings.md`, not the README).
2. `docs/todo.md` Openings: remove "tags (seeded opening-tag OIDs)" from the
   "Not specified" item. Add items: AI drafting suggesting tags (decide the
   prompt cost of listing the catalog, and output validation); Tamil and
   other localized tag names (decide who reviews translations); Admin
   visibility of the catalog. In "Cross-Org discovery", note that a search
   should filter by tag OID.
3. Map every OPN-TAG requirement and the changed OPN-ORG, OPN-HUB, OPN-TST,
   and MKT requirements to a named test; record any gap in `docs/todo.md`.
4. Run `make test`. Remove `.builds/opening-tags/` (the commit script does
   this after the last task).

## Tests

The full suite.

## Checks

`make test`.

## Acceptance

- `make test` passes; `docs/todo.md` reflects what is deferred.

## Carried over
From T07: The Orgs Openings list keeps only the tag filter in the URL; its other filters (state, title, hiring manager, recruiter, pending kinds, country, work arrangement, employment type) stay in component state, against ux.md's URL-kept filters. Add this to docs/todo.md.
