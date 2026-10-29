# T05 Criteria answers on interview feedback

Requirements: HP-FRM-003, HP-FRM-004, HP-WRK-004, HP-WRK-009, HP-WRK-010,
MKT-WRK-001, MKT-WRK-002, HP-RET-002.

Guides: `hiring-pipeline.md`, `marketplace.md`, `typespec.md`, `go.md`,
`backend.md`, `database.md`, `playwright.md`.

Exemplars: T02's `ValidateAnswers` and T03's currency function (reuse the
same shapes for criteria); `submit-interview-feedback` in
`backend/handlers/orgs/applications/interviews.go` and
`SubmitOrgInterviewFeedback`; `submit-work-interview-feedback` in
`backend/handlers/orgs/work/write.go` and `SubmitProviderInterviewFeedback`;
`backend/handlers/orgs/applications/interview_view.go` (visibility).

## Steps

1. Contract: `CriterionAnswer` (`criterion_id`, `value`: int64, boolean, or
   string); `criteria_answers?` (max 10) on `SubmitInterviewFeedbackRequest`
   and the work feedback request; `AnsweredCriterion` (definition, `answer?`,
   `current`) as `InterviewFeedback.criteria_answers`; the problem
   `org-interview-feedback-answers-invalid` (422, `criterion_ids`) on both
   operations. Provider work reads gain the stage's `feedback_form`.
2. Schema: `criteria_answers jsonb NOT NULL DEFAULT '[]'` on
   `org_interview_feedback` and `org_provider_interview_feedback` (array, at
   most 10).
3. Both submit handlers: after the existing refusals, validate against the
   form of the interview's stage (rating 1–5, boolean, text 1–2,000 trimmed,
   required criteria present, no unknown or repeated id) and store the
   snapshot in the same statement as the feedback.
4. Reads: `Interview.feedback[].criteria_answers` with `current` judged
   against the stage's form at read time (`removed` when the stage or
   criterion is gone), under the existing HP-WRK-004 visibility.
5. Retention keeps deleting feedback rows by name, which removes the answers;
   assert it.

## Tests

`playwright/api/application-interviews.spec.ts`: submit with each type,
each refusal, required criteria, an empty form still accepts recommendation
and notes only, `current` after a form edit and after criterion removal,
visibility before and after the viewer submits.
`playwright/api/org-provider-work.spec.ts`: provider interviewer submits
against the consumer's form; the work read returns the form and no
application answers. `playwright/api/application-retention.spec.ts`: no
criteria answers after retention.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the changed specs against
`make test-environment`.

## Acceptance

In-house and provider interviewers answer the stage's criteria; readers see
answers with their currency under the existing visibility rule.

## Carried over
- From T04: the form lives in `org_opening_stages.feedback_form` as `hiring.FeedbackCriterion[]` (ids always set); `hiring.PipelineStage.FeedbackForm` (`omitzero`) is the field provider work reads should fill; criterion types and bounds are in `typespec/orgs/hiring/pipelines.{go,ts}` (`CriterionRating`, `CriterionYesNo`, `CriterionText`).
