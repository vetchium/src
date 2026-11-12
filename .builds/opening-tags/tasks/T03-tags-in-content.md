# T03 Openings: Tags in Opening content

## Requirements

OPN-TAG-007, OPN-TAG-008, OPN-TAG-009 (writes), OPN-TAG-010, OPN-TAG-012,
OPN-TST-004 (writes part); the `tags` row of the Content table in
`agent-guides/openings.md`.

## Guides

`agent-guides/typespec.md`, `agent-guides/go.md`, `agent-guides/backend.md`,
`agent-guides/database.md`, `agent-guides/playwright.md`,
`agent-guides/openings.md`, `agent-guides/ai.md` (drafting output only).

## Exemplars

Commit `1574f9c` ("Hiring: Application questions in Opening content") added a
content field end to end; follow it file by file. In particular:
`unknown_questions` in `SaveOrgOpeningWorkingCopy`
(`backend/internal/db/queries/org_openings.sql`) and `unknownQuestions` in
`backend/handlers/orgs/openings/questions.go` for a statement-decided refusal.

## Steps

1. Contract: in `typespec/common/openings.tsp` add to `OpeningContent`
   `@maxItems(5) @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
   tags?: OpeningTagOID[];` (doc: in the Org's chosen order; OPN-TAG-007).
   In `typespec/common/openings.go` add `Tags []OpeningTagOID
   json:"tags,omitempty"`; `Normalize` clones the slice (never mutate the
   caller's); `Validate` reports `tags` when more than `MaxOpeningTags`, and
   `tags.<i>` for a malformed OID or a repeat. Mirror it in
   `typespec/common/openings.ts`. Extend `openings_test.go` and
   `openings.test.ts` (0, 5, and 6 tags; repeat; malformed; normalization on
   a copy).
2. Problem: in `typespec/problem/orgs/openings.tsp` add
   `OrgOpeningTagUnknownDetails` (`type:
   "vetchium-problem-details/org-opening-tag-unknown"`, title "Org Opening
   tag unknown", `status: 422`, detail "An Opening tag is not in the
   catalog", `@minItems(1) tag_oids: string[]`) and its response alias, with
   Go (`problem.Details` embedded) and TypeScript companions. Add it to the
   error unions of `create-opening`, `duplicate-opening` (only if duplicate
   can carry new content; otherwise not), and `save-opening-working-copy` in
   `typespec/orgs/openings/openings.tsp`.
3. Queries: next to every `'questions', c.questions` that builds content JSON
   add `'tags', c.tag_oids` (`GetOrgOpening` live and working in
   `org_openings.sql`; `GetPublicOrgOpening` in `public_org_openings.sql`).
   In `GetProviderJob` (`org_provider_work.sql`) add `'tags', lc.tag_oids`
   to `live_content`. Copy `tag_oids` beside `questions` in every
   statement that copies or writes content columns: `CreateOrgOpening`,
   `DuplicateOrgOpening`, `SaveOrgOpeningWorkingCopy` (`org_openings.sql`),
   and the copies in `RequestOrgOpeningChange` and `DecideOrgOpeningRequest`
   (`org_opening_requests.sql`). Read new input as
   `NULLIF(ARRAY(SELECT jsonb_array_elements_text(body->'tags')), '{}')`
   (or an equivalent that maps a missing or empty list to `NULL`).
4. Unknown tags: in `CreateOrgOpening` and `SaveOrgOpeningWorkingCopy` add
   an `unknown_tags` CTE listing each input OID absent from
   `vetchium.opening_tags` once, guard every write CTE with `NOT EXISTS
   (SELECT 1 FROM unknown_tags)`, and return `unknown_tag_oids` (a JSON
   array, `[]` when none). Check unknown tags before quota (create) and in
   the same position as unknown questions (save). Run `make sqlc`.
5. Handlers: `backend/handlers/orgs/openings/create.go` and `write.go` map a
   non-empty `unknown_tag_oids` to `org-opening-tag-unknown` with
   `tag_oids`, writing nothing. Add Go tests beside `questions_test.go` for
   the mapping.
6. AI drafting: confirm `backend/internal/orgs/ai/opening_draft.go` never
   sets `Tags`; add a case to `opening_draft_test.go` asserting a drafted
   content has `Tags == nil` even if the model answer contains `tags`.
7. Playwright API, `playwright/api/orgs-openings.spec.ts`:
   - create with 0, 1, and 5 tags; `get-opening` returns them in order and
     omits `tags` when none;
   - save-working-copy changes and clears tags; duplicate copies them;
   - `validation-failed` for 6 tags (`content.tags`), a repeat and a
     malformed OID (`content.tags.<i>`);
   - `org-opening-tag-unknown` for two different unknown OIDs sent with one
     known OID, listing exactly the two unknown ones, with the Opening
     unchanged and no quota slot taken on create;
   - a deprecated tag (insert and delete a `test-<uuid>` tag as in T02) is
     accepted.
   In `playwright/api/orgs-opening-requests.spec.ts`: a `revise` that changes
   only tags, approved (live content and `get-org-opening` show the new tags)
   and rejected (tags return to the working copy; live unchanged), plus the
   self-approved path.
   In `playwright/api/hub-org-openings.spec.ts`: `get-org-opening` carries
   `tags` for a local and a remote-tenant Org.
   In `playwright/api/org-provider-work.spec.ts`: `get-job` content carries
   `tags`.

## Tests

`typespec/common/openings_test.go`, `typespec/common/openings.test.ts`,
handler tests beside `backend/handlers/orgs/openings/questions_test.go`,
`backend/internal/orgs/ai/opening_draft_test.go`, and the Playwright specs in
step 7.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the four specs above against
`make test-environment`, then `make test`.

## Acceptance

- Tags round-trip through create, save, duplicate, revise approval, and every
  read, local and over the mesh.
- An unknown OID writes nothing and names the OID.
- AI drafts carry no tags.

## Carried over
