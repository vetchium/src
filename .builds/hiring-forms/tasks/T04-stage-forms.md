# T04 Feedback forms on interview stages

Requirements: HP-FRM-001, HP-FRM-002 (API part), HP-PIP-001 to HP-PIP-004,
HP-AUTH-005.

Guides: `hiring-pipeline.md`, `typespec.md`, `go.md`, `typescript.md`,
`backend.md`, `database.md`, `playwright.md`.

Exemplars: T01's `ApplicationQuestion` validation and id assignment;
`typespec/orgs/hiring/pipelines.{tsp,go,ts}` (`PipelineStage`,
`PipelineStageDefinition`), `typespec/orgs/openings/pipeline.tsp`
(`PipelineStageInput`); `backend/handlers/orgs/pipelines/templates.go` and
`opening_pipeline.go`; `org_pipelines.sql`; `CreateOrgOpening` and
`DuplicateOrgOpening` stage copies.

## Steps

1. Contract: `FeedbackCriterionType` (extensible: `rating`, `yes_no`,
   `text`), `FeedbackCriterionID`, `FeedbackCriterion` (`id?` on input;
   `text`, `type`, `required`); `feedback_form?` (max 10) on
   `PipelineStageDefinition`, `PipelineStage`, and `PipelineStageInput`, valid
   only for `interview` stages. Go and TS validators with tests.
2. Schema: `feedback_form jsonb NOT NULL DEFAULT '[]'` on
   `org_pipeline_template_stages` and `org_opening_stages`, each with a CHECK
   (array, at most 10, empty unless `stage_kind = 'interview'`).
3. Queries and handlers: write and read forms in every template and Opening
   pipeline query; copy them with stages on Opening create from a template and
   on duplicate; assign UUIDv7 ids to new criteria; refuse an id the stage
   (or template stage) did not hold (`validation-failed`).
4. `get-opening-pipeline` returns, per stage, `feedback_submitted_count`
   (feedback rows on interviews at that stage, in-house and provider), which
   the Pipeline tab needs for the HP-FRM-002 warning.

## Tests

`playwright/api/orgs-pipelines.spec.ts`: templates and Opening pipelines
with forms; each bound and refusal (11 criteria, form on a `review` stage,
unknown id); ids kept on update and reorder; template copy into a new
Opening and on duplicate; editing a template leaves Openings unchanged;
`feedback_submitted_count`.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the changed specs against
`make test-environment`.

## Acceptance

Interview stages carry validated forms through templates, Opening pipelines,
and duplication.

## Carried over
