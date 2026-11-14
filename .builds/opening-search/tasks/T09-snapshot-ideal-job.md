# T09 Applications: Ideal job in the application snapshot

## Requirements

HP-APP-002, PROF-JOB-004, PROF-JOB-005, MKT-ACC-001.

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/go.md`,
`agent-guides/backend.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/hiring-pipeline.md`,
`agent-guides/marketplace.md`, `agent-guides/playwright.md`.

## Exemplars

`ApplicantSnapshot` in `typespec/hub/profile/snapshot.tsp` with
`snapshot.go` (`Biography`, `maxSnapshotBiography`, `Normalized`,
`Validate`), `snapshot.ts`, and `snapshot_test.go`; `applicantSnapshot` in
`backend/handlers/hub/applications/apply.go`; `MyApplicationDetail` in
`typespec/hub/applications/applications.tsp` with `applications.go`
(`Valid`); `GetOrgApplicationForApplicant` in
`backend/internal/db/queries/org_applications.sql` and its use in
`backend/internal/hubapplications/hubapplications.go`;
`playwright/api/hub-applications.spec.ts`,
`playwright/api/orgs-applications.spec.ts`,
`playwright/api/org-provider-work.spec.ts`.

## Steps

1. Contract: `ApplicantSnapshot` gains `ideal_job?: Vetchium.Hub.IdealJob`
   (doc: the applicant's saved ideal job at apply time, PROF-JOB-005); fix
   the model doc, which says it holds only profile view fields.
   `MyApplicationDetail` gains `ideal_job?` (doc: as shared when applying).
   Go: `IdealJob *hub.IdealJob` with `omitempty` (the scalar T07 put in
   `typespec/hub/types.go`); `Normalized` trims it and drops an empty value;
   `Validate` refuses more than 2,000 code points as `ideal_job`. TypeScript
   to match. Tests in `snapshot_test.go` and `snapshot.test.ts`.
2. New query `GetHubIdealJob :one` in
   `backend/internal/db/queries/hub_profile.sql` returning `ideal_job` for an
   active `hub_user_did`. `applicantSnapshot` reads it after
   `GetHubPublicProfile` and sets `IdealJob`. Never read `looking_for_job`.
3. Hub detail: `GetOrgApplicationForApplicant` also selects `snapshot ->>
   'ideal_job'`; `hubapplications` sets `MyApplicationDetail.IdealJob`, and
   `Valid` accepts it absent or within bounds. Retention (HP-RET-001) already
   replaces the snapshot, so a retained application returns none.
4. The Org application detail and the provider work item already return the
   stored snapshot; confirm with the tests below that `ideal_job` reaches
   them unchanged.
5. Playwright API, extending existing specs:
   - `playwright/api/hub-applications.spec.ts`: an applicant with a saved
     ideal job applies (local Org and a `usa1` Org); the applicant's detail
     shows it; changing or clearing the ideal job afterwards leaves the
     detail unchanged; an applicant with none has no `ideal_job`; an
     applicant with `looking_for_job: true` has no such key in any response.
   - `playwright/api/orgs-applications.spec.ts`: the Org's application
     detail snapshot carries `ideal_job` as applied.
   - `playwright/api/org-provider-work.spec.ts`: the stage provider's work
     item snapshot carries it; a sourcing provider's credited-application
     view does not.

## Tests

`typespec/hub/profile/snapshot_test.go`, `typespec/hub/profile/snapshot.test.ts`,
`playwright/api/hub-applications.spec.ts`,
`playwright/api/orgs-applications.spec.ts`,
`playwright/api/org-provider-work.spec.ts`.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the three specs against
`make test-environment`, then `make test`.

## Acceptance

- New applications freeze the applicant's ideal job, and the Org, the stage
  provider, and the applicant read it; `looking_for_job` appears nowhere.

## Carried over
