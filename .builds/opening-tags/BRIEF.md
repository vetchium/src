# Opening tags build brief

## Summary

Vetchium keeps one catalog of Opening tags, seeded in the tenant database
migration so every tenant holds the same rows. Each tag has a permanent
kebab-case OID (`golang`, `artificial-intelligence`), an English default
display name, optional localized names, and optionally an icon. Org users with
`org:manage_openings` attach up to five tags to an Opening as part of its
content, so tag changes on a published Opening go through the normal revise
approval. Tags show in the viewer's portal language, not the Opening's
language. The Orgs portal shows them in the editor, detail, preview, and Job
detail, and the Hub portal on Org page cards and the Opening page. Only OIDs
are stored or cross the wire and the mesh; portals resolve names and icons.
Users filter by tag on the Orgs Openings list, the Hub Org page, and the
agency Jobs list.

The specification is `agent-guides/openings.md` OPN-TAG-001 to OPN-TAG-012,
OPN-ORG-001, OPN-ORG-008, OPN-HUB-002, OPN-TST-003, OPN-TST-004, and
`agent-guides/marketplace.md` MKT-OWN-004 and MKT-UI-006.

## Questions and answers

1. Catalog authority? **A seeded DB table** (`vetchium.opening_tags`, plus
   `vetchium.opening_tag_names`), read through a `list-opening-tags`
   operation in orgs-api and hub-api.
2. Icons? **An optional monochrome SVG per tag in `portal-ui`**; other tags
   show a generic tag icon.
3. Limits? **0–5 tags, optional**; not part of publish completeness.
4. Filters? **Orgs Openings list, Hub Org page, and agency Jobs list.**
5. Seed set? **About 50 tags across sectors, about 30 of them technology
   (as of November 2026).** Programming languages get icons and no
   translations. Translate only terms job boards in that language use.
6. Categories? **Flat list**, with a searchable picker.
7. Localized names? **Default name only, plus localized extras where known.**
8. AI drafting suggests tags? **Not in this build.**
9. Seed list as proposed? **Yes** (the list in task T01).
10. Icon source? **Simple Icons (CC0)**; a language it lacks falls back to the
    generic icon.
11. API and UI surface? **Confirmed** as below.

## API

| Operation | Portal API | Access | Request | Success | Problems |
| --- | --- | --- | --- | --- | --- |
| `POST /api/orgs/list-opening-tags` | orgs-api | any authenticated user of an active Org | empty body | `tags[]` of `tag_oid`, `display_name`, `localized_names`, `deprecated` | auth, Org suspended |
| `POST /api/hub/list-opening-tags` | hub-api | any authenticated Hub user | empty body | same | auth |
| `create-opening`, `duplicate-opening`, `save-opening-working-copy` | orgs-api | unchanged | `content.tags`: 0–5 unique OIDs | unchanged | `validation-failed`, new `org-opening-tag-unknown` (422, `tag_oids`) |
| `get-opening`, `list-openings` | orgs-api | unchanged | `list-openings` adds `tag_oid?` | content carries `tags` | unchanged |
| `list-org-openings`, `get-org-opening`, mesh `org-openings` list and get | hub-api, mesh | unchanged | list adds `tag_oid?` | `PublicOpeningSummary.tags`, content `tags` | unchanged |
| `list-jobs`, `get-job`, mesh `provider-jobs` list and get | orgs-api, mesh | unchanged | list adds `tag_oid?` | Job content carries `tags` | unchanged |

## UI

| Portal | Route | Change | Who |
| --- | --- | --- | --- |
| Orgs | `/openings/new`, `/openings/:number/edit` | Tags multi-select (at most 5; search on default name, portal-language name, OID; deprecated hidden unless already chosen) | `org:manage_openings` |
| Orgs | `/openings` | tag filter | Openings readers |
| Orgs | `/openings/:number`, preview, Job detail | tag chips (icon and name) via `OpeningView`; working-copy switch names `tags` | as today |
| Orgs | Jobs list (`paths.jobs`) | tag filter under "More filters" | `org:fulfil_engagements` |
| Hub | `/org/:domain` | tag filter; tag chips on each Opening card | signed-in Hub users |
| Hub | `/org/:domain/openings/:number` | tag chips | signed-in Hub users |

## Out of scope

- Searching or ranking Openings across Orgs by tag (cross-Org discovery is in
  `docs/todo.md`).
- Admin management of the catalog; Org-defined or free-text tags.
- Tag categories or grouping.
- Tags on Hub profiles, applications, or anything other than Openings.
- AI drafting suggesting tags.
- Tamil names beyond `artificial-intelligence`.
- Showing tags in the Orgs Openings list rows or the Jobs list rows.
- Any `video-demos/` change.
