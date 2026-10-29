# T01 Application questions in Opening content

Requirements: HP-QST-001, HP-QST-002, HP-QST-003 (Org side), the
`questions` row of the `openings.md` Content table, OPN-CNT-001, OPN-WC-006.

Guides: `hiring-pipeline.md`, `openings.md`, `typespec.md`, `go.md`,
`typescript.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: `typespec/common/openings.{tsp,go,ts}` (`OpeningContent`,
`Normalize`, `Validate`, `MissingForPublication`) and their tests;
`remote_countries` handling in `db/migrations/00001_init.sql` and
`backend/internal/db/queries/org_openings.sql`; `PipelineStageInput.id` in
`typespec/orgs/openings/pipeline.tsp` for an optional input id.

## Steps

1. Contract, in `typespec/common/openings.tsp` with Go and TypeScript
   companions: `ApplicationQuestionType` (extensible: `short_text`,
   `long_text`, `number`, `yes_no`, `single_choice`, `multiple_choice`),
   `ApplicationQuestionID` (UUID string), `ApplicationQuestion` (`id?` on
   input, always present on responses; `text`, `type`, `required`, `min?`,
   `max?`, `options?`), and `OpeningContent.questions?` (max 10). Go:
   `Normalize` trims text and options; `Validate` returns field paths such as
   `questions[2].options[1]` for every HP-QST-001 rule and duplicate ids.
   Mirror the rules in TypeScript. Unit-test each rule in both languages.
2. Schema in `db/migrations/00001_init.sql` (no new migration file; pre-launch
   rule in `database.md`): `org_opening_contents.questions jsonb` (NULL means
   none) with a CHECK that it is a JSON array of at most 10 elements. Do not
   add it to the generated `complete` column.
3. Queries in `org_openings.sql` and `org_opening_requests.sql`: write and
   return `questions` everywhere content is written or read
   (`CreateOrgOpening`, `DuplicateOrgOpening` copies with ids,
   `SaveOrgOpeningWorkingCopy`, `GetOrgOpening`, `DecideOrgOpeningRequest`
   copying working copy to live). Run `make sqlc`.
4. Handlers `backend/handlers/orgs/openings/` (`create.go`, `write.go`,
   `read.go`): assign a UUIDv7 to every question without an id; refuse an id
   that names no question of this Opening's working copy or live content
   (`validation-failed`, field `questions[n].id`); create rejects any id.
   Map jsonb to and from the contract type in one helper.
5. AI drafting (`backend/internal/orgs/ai/opening_draft.go`) leaves
   `questions` unset; add a test that asserts it.

## Tests

`playwright/api/orgs-openings.spec.ts`: create and save with every type,
each bound and refusal (11 questions, 9 options, duplicate option ignoring
case, `min > max`, `options` on `number`, unknown id), ids assigned and kept
across save, duplicate keeps questions, revise approval makes questions live,
an incomplete check unaffected by `questions`.
`playwright/api/orgs-opening-requests.spec.ts`: a revise changing questions
applies on approval and stays hidden before it.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the changed specs against
`make test-environment`.

## Acceptance

Managers create, revise, and duplicate Openings with questions; approval
guards them; validation matches HP-QST-001 in Go and TypeScript.

## Carried over
