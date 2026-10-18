# T06 Applications at the Org tenant and Orgs reads

Requirements: HP-GEN-001 to HP-GEN-003, HP-GEN-007, HP-GEN-008, HP-APP-002,
HP-APP-003, HP-STA-001, HP-AUTH-001 to HP-AUTH-006, HP-ORG-001, HP-ORG-002
(reads only), `org-pipeline-stage-in-use`, `org-application-not-found`.

Guides: `hiring-pipeline.md`, `federation.md` (Authority), `typespec.md`,
`backend.md`, `database.md`, `authorization.md`, `playwright.md`.

Exemplars: commit `6adf777` (Orgs reads, list filters, keyset pagination,
visibility in SQL); `backend/internal/db/queries/org_openings.sql`; T03's
command handler registry.

## Steps

1. Schema: applicants (one per Org and person; `kind` `hub_user` with a
   CHECK requiring `hub_user_did`; unique on Org and DID); applications
   (Opening, number from a counter on the Opening row, state, `version`,
   snapshot JSON, cover note, current stage, timestamps; unique on Opening
   and applicant); per-candidacy stage records (`pending`, `completed`,
   `skipped`); application history. Leave credit columns to T24.
2. The authority command kind `hub-apply` (T03): checks the Opening is
   `published` and the Org active (`hub-opening-not-accepting`), creates the
   applicant if absent, refuses a second application ever
   (`hub-application-exists`, safe under concurrency), allocates the number,
   writes history and audit. Hub-side sending is T07.
3. Orgs reads: list an Opening's applications (Applicants view = `submitted`;
   Candidates view = candidacies by stage, terminal states by filter) with
   the HP-ORG-001 filters, name search (≥2 characters), keyset pagination
   (≤100), counts per stage; get one application (snapshot, cover note,
   stage records, dates); application history. Visibility follows
   HP-AUTH-002 to HP-AUTH-004 in SQL; anything else is
   `org-application-not-found`.
4. T05's pipeline replace refuses removing a stage that holds a candidacy
   with `org-pipeline-stage-in-use`.

## Tests

Go integration tests for `hub-apply` (success, not accepting, duplicate,
concurrent duplicates). Playwright API for the reads: filters, search,
pagination, counts, every access path in HP-AUTH (manager, recruiter, team
member read-only, `org:manage_candidacies`, `org:view_openings` refused),
and the stage-in-use refusal. Until T07 exists, seed applications in
Playwright with SQL fixtures (`sqlScalarForTenant` in
`playwright/lib/admin-db.ts`), as other specs seed rows they cannot create
through an API.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

The Org tenant can accept an application command and every Orgs reader sees
exactly what HP-AUTH allows.
