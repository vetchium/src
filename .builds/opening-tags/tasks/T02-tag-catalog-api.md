# T02 Openings: Opening tag catalog read in orgs-api and hub-api

## Requirements

OPN-TAG-002 (wire format), OPN-TAG-006, OPN-TST-004 (catalog read part).

## Guides

`agent-guides/typespec.md`, `agent-guides/go.md`, `agent-guides/backend.md`,
`agent-guides/database.md`, `agent-guides/playwright.md`,
`agent-guides/openings.md`.

## Exemplars

- No-input operations: `counts()` at `@route("/my-application-counts")` in
  `typespec/hub/applications/applications.tsp` and its handler and route in
  `backend/internal/routes/hub_routes.go`.
- Shared Go companion with constants and a validator:
  `typespec/common/language_catalog.go`, `typespec/common/openings.go`.
- Orgs routes that need an authenticated user of an active Org but no
  permission: find one with `git grep -n "RequireActiveOrg"
  backend/internal/routes/orgs_routes.go`.

## Steps

1. Create `typespec/common/opening_tags.tsp` (import it from
   `typespec/main.tsp` the way `openings.tsp` is imported) with:
   - `scalar OpeningTagOID extends string` with `@minLength(2)`,
     `@maxLength(64)`, `@pattern("^[a-z0-9]+(-[a-z0-9]+)*$")`.
   - `model OpeningTag { tag_oid: OpeningTagOID; display_name: string;
     localized_names: Record<string>; deprecated: boolean; }` with doc
     comments: `display_name` is the English default; `localized_names` maps a
     base language subtag to a name and is `{}` when none.
   - `model ListOpeningTagsResponse { tags: OpeningTag[]; }`, doc: the whole
     catalog ordered by OID, at most 500, deprecated tags included.
2. Companions `typespec/common/opening_tags.go` (`OpeningTagOID` type,
   `MaxOpeningTags = 5`, `IsOpeningTagOID(OpeningTagOID) bool` using the
   pattern and length, `OpeningTag`, `ListOpeningTagsResponse`; encode
   `localized_names` as `{}` and `tags` as `[]`, never `null`) and
   `typespec/common/opening_tags.ts` (same names, `isOpeningTagOID`,
   `maxOpeningTags`). Add the `.ts` to `typespec/package.json` `exports`.
   Tests: `typespec/common/opening_tags_test.go` and
   `typespec/common/opening_tags.test.ts` covering valid OIDs (`go`,
   `c-plus-plus`, a 64-character OID) and invalid ones (`a`, 65 characters,
   `Go`, `-go`, `go-`, `go--lang`, `go_lang`, `c#`).
3. Add operation `listOpeningTags()` at `@route("/list-opening-tags")`
   (`@post`, `@useAuth(BearerAuth)`, response `200` with `Cache-Control:
   no-store` and `ListOpeningTagsResponse`) to the `/api/orgs` interface in
   `typespec/orgs/openings/openings.tsp` (errors: the unauthenticated and
   Org-suspended problems that `opening-summary` declares, minus
   `org-permission-required`) and to the `/api/hub` interface in
   `typespec/hub/openings/public.tsp` (errors as `list-org-openings` minus its
   Org problems). Update both portals' Go and TypeScript companions only if
   they list operations; run `make typespec-check`.
4. Create `backend/internal/openingtags/openingtags.go`:
   `func List(ctx context.Context, queries *sqlc.Queries)
   (common.ListOpeningTagsResponse, error)` mapping `ListOpeningTags` (T01)
   rows, decoding `localized_names` JSON into the map. Unit-test the mapping
   in `openingtags_test.go` if it has logic beyond a field copy.
5. Handlers: `backend/handlers/orgs/openings/tags.go` (`ListTags`) and
   `backend/handlers/hub/openings/tags.go` (`ListTags`), each calling
   `openingtags.List` with the server's pool queries and writing `200`. No
   audit (read only).
6. Routes: `POST /api/orgs/list-opening-tags` in
   `backend/internal/routes/orgs_routes.go` behind authentication and
   `RequireActiveOrg` with no permission; `POST /api/hub/list-opening-tags`
   in `backend/internal/routes/hub_routes.go` behind Hub authentication.
   Update `orgs_routes_test.go` if it enumerates routes.
7. Playwright clients: `listOpeningTags()` in `playwright/lib/orgs-api.ts`
   and `playwright/lib/hub-api.ts`.
8. `playwright/api/opening-tags.spec.ts`, both APIs, each test naming the
   endpoint:
   - `200`: contains `golang` (`display_name` "Go", `localized_names` `{}`),
     `artificial-intelligence` with `de` "Künstliche Intelligenz" and `ta`
     "செயற்கை நுண்ணறிவு", ordered by OID, at most 500, `Cache-Control:
     no-store`. Assert by membership, never exact equality of the whole list
     (another test adds a tag).
   - A deprecated tag: insert a unique `test-<uuid>` row with `deprecated =
     true` through the owner SQL helper (`sqlScalarForTenant`), assert it is
     listed with `deprecated: true`, delete it in `finally`.
   - `401` without a token on both; the Org-suspended problem on orgs-api
     using the suspended-Org fixture other Openings specs use.

## Tests

`typespec/common/opening_tags_test.go`, `typespec/common/opening_tags.test.ts`,
`playwright/api/opening-tags.spec.ts`.

## Checks

`make typespec-check`, `make test-go`, `make test-go-static`,
`make playwright-check`, `npx playwright test api/opening-tags.spec.ts`
against `make test-environment`, then `make test`.

## Acceptance

- Both operations return the seeded catalog with the shape above.
- Contract coverage lists every non-`5xx` response of both operations as
  covered.

## Carried over
From T01: sqlc generates `ListOpeningTagsRow.LocalizedNames` as `[]byte` (a JSON object, `{}` when none); decode it in `openingtags.List`.
