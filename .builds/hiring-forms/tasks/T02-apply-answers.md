# T02 Answers when applying

Requirements: HP-QST-003 (Hub reads), HP-QST-004, HP-QST-005, HP-APP-001,
HP-APP-008, HP-GEN-007.

Guides: `hiring-pipeline.md`, `federation.md`, `typespec.md`, `go.md`,
`backend.md`, `database.md`, `playwright.md`.

Exemplars: `cover_note` end to end: `typespec/hub/applications/applications.tsp`
`ApplyToOpeningRequest`, `typespec/federation/hiring.tsp` `HubApplyPayload`,
`backend/handlers/hub/applications/apply.go`, `backend/internal/hubapply/hubapply.go`,
`CreateOrgApplication` in `backend/internal/db/queries/org_applications.sql`;
the problem `hub-application-exists` across `typespec/problem/`, Go, TS, and
`HubApplyRejections`; `backend/internal/publicopenings/read.go` and
`GetPublicOrgOpening` in `public_org_openings.sql`.

## Steps

1. Hub reads: `get-org-opening` and the mesh `org-openings/get` return the
   live `questions` (never the working copy). Update `GetPublicOrgOpening`,
   `publicopenings`, `publicopeningclient`, and `backend/handlers/mesh/openings.go`.
2. Contract: `ApplicationAnswer` (`question_id`, `value` as a union of string,
   int64, boolean, string array) in `typespec/orgs/applications/`;
   `answers?` (max 10) on `ApplyToOpeningRequest` and `HubApplyPayload`; the
   problem `hub-application-answers-invalid` (422, `question_ids`) in every
   problem file, added to `HubApplyRejections`. Go and TS companions and
   tests.
3. hub-api `apply.go`: shape and length checks only (count ≤ 10, string ≤ 2,000
   code points, at most 8 strings); forward `answers` in the payload.
4. Schema: `org_applications.answers jsonb NOT NULL DEFAULT '[]'` with a CHECK
   that it is an array of at most 10 elements.
5. `hubapply.Handle`: after `LockOrgOpeningForApplication`, read the live
   questions and validate answers per HP-QST-004 in a pure function
   `ValidateAnswers(questions, answers) (snapshot, invalidIDs)` with table
   tests; store the HP-QST-005 snapshot (each live question's full definition
   plus `answer`, omitted when unanswered) through `CreateOrgApplication`.
   History and audit gain no answer data.

## Tests

`playwright/api/hub-applications.spec.ts`: apply with every type to a local
Org and to a remote-region Org (including the `202` path); each refusal
(missing required, unknown id, repeated id, out-of-range number, unknown
option, too many options, over-length text) returns
`hub-application-answers-invalid` with the right `question_ids`; a blank
optional text is stored as unanswered; applying with no questions still
works. `playwright/api/hub-org-openings.spec.ts`: questions appear only once
live.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the changed specs against
`make test-environment`.

## Acceptance

Applicants answer live questions from any region; the Org tenant alone
decides validity and stores an immutable snapshot.

## Carried over
