# T05 Pipeline templates and Opening pipelines

Requirements: HP-PIP-001 to HP-PIP-005, HP-AUTH-005, HP-GEN-008; problem
`org-pipeline-template-name-taken`. `org-pipeline-stage-in-use` is wired in
T06, once candidacies exist.

Guides: `hiring-pipeline.md`, `openings.md`, `typespec.md`, `go.md`,
`backend.md`, `database.md`, `authorization.md`, `playwright.md`.

Exemplars: commits `ea15035` (schema), `6adf777` (Orgs API, idempotency,
version, list pagination, audit); `backend/handlers/orgs/openings/`,
`backend/internal/db/queries/org_openings.sql`,
`typespec/orgs/openings/`, `playwright/api/orgs-openings.spec.ts`.

## Steps

1. Schema in `db/migrations/00001_init.sql` (pre-production: edit it, no new
   migration): pipeline templates (Org, name unique case-insensitively,
   stages) and Opening pipeline stages (stable id, order, name, kind from
   T02). Bounds from HP-PIP-001/002 as CHECKs where possible.
2. Contract and handlers (`org:manage_openings`): list, create, update,
   delete templates (at most 50); get and replace an Opening's pipeline
   (whole ordered list with stable ids, `version`, `Idempotency-Key`) in
   every non-terminal Opening state, without an Opening request.
3. `create-opening` and `duplicate-opening` take an optional template; the
   new Opening copies it, or gets one `review` stage; duplicate copies the
   source pipeline. Never add pipeline fields to `OpeningContent`
   (`openings.md` Content).
4. Every write appends audit in the same statement.

## Tests

Playwright API: each operation's success and refusals, bounds (1–15 stages,
0–50 templates, name lengths), name collision in any case, template edits
not changing Openings, create and duplicate copying, terminal Opening
refused, permission matrix, version conflict, idempotent replay.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Every Opening has a pipeline; templates exist; nothing reaches the Hub.
