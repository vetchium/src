# T03 Answers for Org readers and the applicant

Requirements: HP-QST-006, HP-QST-007, HP-QST-008, HP-RET-001, HP-RET-002,
HP-AUTH-003, HP-AUTH-007, MKT-ACC-001.

Guides: `hiring-pipeline.md`, `marketplace.md`, `federation.md`,
`typespec.md`, `go.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: `ApplicationDetail` reads in `backend/handlers/orgs/applications/read.go`
and `GetOrgApplication`; `ListOrgApplications` filters and keyset paging;
`get-my-application` through `backend/handlers/hub/applications/read.go`,
`backend/internal/hubapplicationclient`, and `backend/handlers/mesh/hub_applications.go`
(`GetOrgApplicationForApplicant`); `RetainOrgApplication`.

## Steps

1. Contract: `AnsweredQuestion` (the question definition, `answer?`) and
   `AnswerCurrency` (extensible: `same`, `changed`, `removed`);
   `ApplicationDetail.answers` (each with `current`);
   `ListApplicationsRequest.answer_columns?` (max 3) and
   `ApplicationSummary.answers?`; `MyApplicationDetail.answers` (no
   `current`). Go and TS companions and tests.
2. A pure Go function computing `current` per HP-QST-006 (text, type, and
   options compared; `required`, `min`, `max` ignored) with table tests.
   `GetOrgApplication` returns the snapshot and the live questions in its one
   read.
3. `list-applications`: validate `answer_columns` against live questions
   (only `number`, `yes_no`, `single_choice`, `multiple_choice`; otherwise
   `validation-failed`, field `answer_columns[n]`); return only those answers
   per row, extracted in SQL from the snapshot. Paging and filters unchanged.
4. Applicant reads: `GetOrgApplicationForApplicant` and the mesh response carry
   the snapshot; `get-my-application` returns it without `current`. The
   projection (`hubapplications`) stays free of answers.
5. Providers: confirm `GetProviderWork`, `GetProviderJob`, and credited
   application reads select no answers; add none.
6. Retention: `RetainOrgApplication` sets `answers = '[]'`; readers return no
   answers for a removed application.

## Tests

`playwright/api/orgs-applications.spec.ts`: answers and `current` for
`same`, `changed` (text edited by an approved revise), and `removed`;
interviewer-only reader sees answers; `answer_columns` bounds, a text-type id
refused, and row answers. `playwright/api/hub-applications.spec.ts`:
`get-my-application` from a remote region returns answers without `current`.
`playwright/api/org-provider-work.spec.ts`: no provider read has answers.
`playwright/api/application-retention.spec.ts`: retention empties answers.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the changed specs against
`make test-environment`.

## Acceptance

Every application reader sees answers with their currency; the applicant
sees their own; providers and the projection see none; retention removes
them.

## Carried over
- From T01: provider and agency job reads (`backend/internal/db/queries/org_provider_work.sql`) build Opening content without `questions`; keep it so, and assert in the provider test that no question or answer reaches a provider.
- From T02: `AnsweredQuestion` and `AnswerValue` already exist in `typespec/orgs/applications/answers.{tsp,go,ts}` and `org_applications.answers` stores `[]AnsweredQuestion`; add only `AnswerCurrency` and `current` for Org reads.
