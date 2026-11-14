# T07 Hub profile: Ideal job and looking-for-a-job settings

## Requirements

PROF-JOB-001, PROF-JOB-002, PROF-JOB-003, PROF-JOB-004, PROF-GEN-006.

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/go.md`,
`agent-guides/backend.md`, `agent-guides/database.md`,
`backend/internal/db/AGENTS.md`, `agent-guides/playwright.md`,
`playwright/AGENTS.md`, `agent-guides/hub-profile.md`.

## Exemplars

`MyInfoResponse`, `SetPreferredJobCountriesRequest`, and
`setPreferredJobCountries` in `typespec/hub/users/profile.tsp` with
`profile.go` and `profile.ts`; `MyInfo` and `SetPreferredJobCountries` in
`backend/handlers/hub/users/profile.go`; `GetHubMyInfo` and
`SetHubPreferredJobCountries` (update plus audit CTE) in
`backend/internal/db/queries/hub_profile.sql`; the route in
`backend/internal/routes/hub_routes.go`; the `set-preferred-job-countries`
cases in `playwright/api/hub-auth.spec.ts` and `playwright/api/hub-audit.spec.ts`.

## Steps

1. Contract in `typespec/hub/users/profile.tsp`:
   - `MyInfoResponse` gains `ideal_job?: IdealJob`, `looking_for_job:
     boolean`, `job_search_prompt_dismissed: boolean`.
   - Scalar `IdealJob extends string` with `@maxLength(2000)` in
     `typespec/hub/types.tsp` beside `HubHandle` (doc: plain text, 1–2,000
     code points after trimming, PROF-JOB-001), with its Go type in
     `typespec/hub/types.go` and TypeScript type in `types.ts`, so T09's
     snapshot can use it.
   - `SetIdealJobRequest { ideal_job: string; }` (doc: empty after trimming
     removes it), `SetLookingForJobRequest { looking_for_job: boolean; }`,
     `DismissJobSearchPromptRequest {}`.
   - Operations `POST /set-ideal-job`, `POST /set-looking-for-job`,
     `POST /dismiss-job-search-prompt` in `ProfileOperations`, each `204`
     with `Cache-Control: no-store`, `invalid-json`,
     `hub-authentication-required`, `internal-server-error`; the first two
     also `validation-failed`.
2. Go companion `typespec/hub/users/profile.go`: the fields
   (`IdealJob *IdealJob` with `omitempty`; the two booleans without), the
   requests, `SetIdealJobRequest.Normalize` (`strings.TrimSpace`),
   `Validate` refusing more than 2,000 code points (`utf8.RuneCountInString`)
   as `ideal_job`; `SetLookingForJobRequest.LookingForJob *bool`, refusing
   nil as `looking_for_job` (like `SetAgenciesMayMessageRequest`). TypeScript
   companion `profile.ts` with `normalizeSetIdealJobRequest`,
   `validateSetIdealJobRequest`, `validateSetLookingForJobRequest` matching
   field for field. Tests in `typespec/hub/users/profile_test.go` (create if
   missing) and `typespec/hub/contract.test.ts`: 2,000 and 2,001 code points
   with astral characters, whitespace-only normalizing to empty, missing
   boolean. Regenerate the OpenAPI output as `make typespec-check` expects.
3. Schema in `db/migrations/00001_init.sql`, `hub_users` after
   `preferred_job_countries`: `ideal_job text`, `looking_for_job boolean NOT
   NULL DEFAULT false`, `job_search_prompt_dismissed_at timestamptz`, and
   `CONSTRAINT hub_users_ideal_job_check CHECK (ideal_job IS NULL OR
   (ideal_job = btrim(ideal_job) AND char_length(ideal_job) BETWEEN 1 AND
   2000))`. Check `btrim` against Go's `strings.TrimSpace` whitespace set the
   way the biography column does, and copy that column's check if it differs.
4. Queries in `backend/internal/db/queries/hub_profile.sql`:
   - `GetHubMyInfo` also returns `ideal_job`, `looking_for_job`, and
     `job_search_prompt_dismissed_at IS NOT NULL AS
     job_search_prompt_dismissed`.
   - `SetHubIdealJob :one` (`NULLIF(sqlc.arg(ideal_job), '')`), audit
     `hub.profile.ideal-job-set` with `jsonb_build_object('ideal_job_set',
     ideal_job IS NOT NULL)`.
   - `SetHubLookingForJob :one`, audit `hub.profile.looking-for-job-set` with
     `{looking_for_job}`.
   - `DismissHubJobSearchPrompt :one`: `SET job_search_prompt_dismissed_at =
     coalesce(job_search_prompt_dismissed_at, now())`, audit
     `hub.profile.job-search-prompt-dismissed` with `'{}'::jsonb`.
   Each updates only `hub_user_state = 'active'` rows, sets `updated_at`,
   and returns `EXISTS (SELECT 1 FROM audit) AS changed`. Do not add the new
   columns to `GetHubPublicProfile` or any profile-view, federation,
   application, agency, or search query. Run `make sqlc`.
5. Handlers `SetIdealJob`, `SetLookingForJob`, `DismissJobSearchPrompt` in
   `backend/handlers/hub/users/profile.go`, shaped like
   `SetPreferredJobCountries` (not `changed` is
   `hub-authentication-required`); `MyInfo` maps the new fields. Register
   the three routes behind `hubAuth` in `hub_routes.go`.
6. Playwright: add `setIdealJob`, `setLookingForJob`,
   `dismissJobSearchPrompt` to `playwright/lib/hub-api.ts`. New
   `playwright/api/hub-job-search-preferences.spec.ts`: defaults from
   `my-info` (`ideal_job` absent, both booleans false); set, replace with
   surrounding whitespace trimmed and internal line breaks kept, clear with
   `""` and with whitespace; 2,000 code points accepted and 2,001 refused as
   `validation-failed` `ideal_job`; missing or non-boolean
   `looking_for_job`; dismiss twice stays dismissed; `invalid-json` and an
   unknown field; `hub-authentication-required` for all three; one audit
   row per write with the action names and payloads of PROF-JOB-003 and no
   ideal-job text anywhere in it; and PROF-JOB-004/005: after setting both,
   the user's own and another user's profile reads (local and through the
   mesh) contain neither `ideal_job` nor `looking_for_job`.

## Tests

`typespec/hub/users/profile_test.go`, `typespec/hub/contract.test.ts`,
`playwright/api/hub-job-search-preferences.spec.ts`.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make migration-check`,
`make test-go`, `make test-go-static`, `make playwright-check`, the new spec
against `make test-environment`, then `make test`.

## Acceptance

- `my-info` reports the three values and the three setters work, audited,
  with no text in audit records or logs.
- No profile or other response carries either field.

## Carried over
