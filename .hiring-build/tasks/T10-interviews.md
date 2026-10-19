# T10 Interviews and feedback

Requirements: HP-WRK-002 to HP-WRK-004, HP-AUTH-003, HP-STA-002
(cancellation), HP-HUB-003 (interview responses). In-house only; provider
interviews are T21.

Guides: `hiring-pipeline.md`, `federation.md`, `typespec.md`, `backend.md`,
`database.md`, `authorization.md`, `playwright.md`.

Exemplars: T08 writes; the website URL validator `IsWebsiteURL` and
`NormalizeWebsiteURL` in `typespec/hub/profile/public.go` (PROF-WEB-002),
with its TS companion; reuse them for every HTTPS link in this build.

## Steps

1. Schema: interviews (candidacy, start UTC, duration 15–480, mode `video`
   with an HTTPS URL or `in_person` with a location ≤500, state, applicant
   response, reschedule note ≤500), interviewers (1–10 active users of the
   performing Org), feedback (once per interviewer: recommendation, notes
   ≤10,000).
2. Orgs writes: schedule (0–10 per candidacy at an `interview` stage),
   change (time or mode change resets the response), cancel, record
   `completed` or `no_show` after the start (interviewer or recruiter),
   submit feedback. Reads hide others' feedback from an interviewer until
   they submitted theirs.
3. Hub commands through T03: accept, request reschedule with a note.
4. Leaving the pipeline cancels upcoming interviews (finish HP-STA-002).

## Tests

Playwright API: bounds and validation, response reset, timing of outcome
recording, feedback once and visibility before and after submitting, the
interviewer-only access path, Hub responses from another region,
cancellation on leaving the pipeline.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

In-house interviews run from scheduling to feedback, with Hub responses.

## Carried over

- Extend `vetchium.org_user_reads_applications` (T06) so an interviewer
  without other access reads only the candidacies of their interviews
  (HP-AUTH-003).
- Add the HP-ORG-001 "pending applicant action" filter to
  `list-applications` for interview responses; T11 extends it for consent
  and T09's offer response if not already present.
- Withdrawal (T07 `hub-withdraw`) and every other exit from the pipeline
  must cancel upcoming interviews (HP-STA-002).
- Add interview responses to the Hub pending actions (projection and live
  detail).
- T08 left the pipeline-exit hooks in `MarkOrgApplicationNotProgressing`
  and `MarkClosedOpeningApplicationsNotProgressing`; cancel interviews
  there and in `hub-withdraw`.
