# T14 Dev seed: Openings for every search filter and ideal jobs

## Requirements

OPN-TST-003 (search filters), PROF-JOB-001, HP-APP-002 (ideal job in
seeded snapshots).

## Guides

`agent-guides/database.md` (seeds), `agent-guides/go.md`,
`agent-guides/openings.md`, `agent-guides/hub-profile.md` (Fixtures).

## Exemplars

`backend/cmd/dev-seed/org_openings.go` (`seedOpeningContent`,
`seedOrgOpenings`); `backend/cmd/dev-seed/hub_profiles.go` and
`hub_profiles_fixture.go` (`Biography`, its limit check, and
`hub_profiles_fixture_test.go`); seeding order in `main.go`.

## Steps

1. Vary `seedOpeningContent` by index so published Openings across the
   seeded Orgs (in more than one region) include: on-site, hybrid, remote
   `worldwide`, and remote `countries`; every employment type; with and
   without salary; experience ranges with open and closed bounds and none;
   each education level and none; shared tags between Orgs.
2. Give the seeded Openings descriptions and titles that share words with
   the seeded ideal jobs, so `ideal_job_match` returns ranked results in
   more than one region.
3. Add optional `ideal_job` and `looking_for_job` to the Hub profile fixture
   (`hub_profiles_fixture.go`, with a 2,000-code-point check and a test) and
   set them through `set-ideal-job` and `set-looking-for-job` for most
   seeded Hub users, leaving at least one without an ideal job (so Home shows
   the job-search card) and one with the prompt dismissed. Do this before
   applications are seeded, so their snapshots carry the ideal job.
4. Keep every fixture going through the portal APIs.

## Tests

`make dev-seed` against a fresh `make dev` stack completes; check
`/openings` shows results for each filter and for the match sort, and an
Org application shows the applicant's ideal job.

## Checks

`make test-go`, `make test-go-static`, a `make dev-seed` run, then
`make test`.

## Acceptance

- A developer sees results for every search filter and the match sort, and
  the job-search card for the user without an ideal job, after
  `make dev-seed`.

## Carried over
