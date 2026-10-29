# T07 Orgs portal: Feedback forms and criteria answers

Requirements: HP-FRM-002 (warning), HP-FRM-004, HP-FRM-005, HP-WRK-004,
MKT-WRK-002, HP-ORG-003.

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`marketplace.md`, `playwright.md`.

Exemplars: `orgs-ui/src/features/pipelines/StageListEditor.tsx`,
`TemplateDrawer.tsx`, `PipelineTab.tsx`, `stageRows.ts`;
`orgs-ui/src/features/applications/InterviewFeedbackDialog.tsx` and
`StageWork.tsx`; `orgs-ui/src/pages/WorkItemDetailPage.tsx`; T06's question
editor for the shared editing pattern (extract a shared component when the
two editors would otherwise duplicate code).

## Steps

1. Stage editor (templates and the Opening Pipeline tab): a feedback form
   editor on `interview` stages only (criteria text, type, required; add,
   reorder, remove; at most 10). On the Pipeline tab, when a changed stage has
   `feedback_submitted_count > 0`, warn per HP-FRM-002 before saving.
2. Feedback dialog, in-house and in the Work queue item: an input per
   criterion (rating 1–5, yes/no, text up to 2,000) beside recommendation and
   notes; required criteria enforced; map
   `org-interview-feedback-answers-invalid` to the fields it names.
3. Application detail interviews: the HP-FRM-005 comparison (criteria rows,
   interviewer columns, average of `same` ratings), stale answers marked with
   the criterion as asked; hidden feedback stays hidden per HP-WRK-004.
4. Every string in `en`, `de`, `ta`; the `ux.md` screenshot check.

## Tests

`playwright/ui/orgs-pipelines.spec.ts`: build a form on a template and on an
Opening pipeline; the warning when feedback exists.
`playwright/ui/orgs-stage-work.spec.ts`: submit feedback with criteria; the
comparison with two interviewers and a changed criterion.

## Checks

`make orgs-ui-check`, `make playwright-check`, the changed UI specs against
`make test-environment`.

## Acceptance

Managers define forms, interviewers fill them in-house or as a provider, and
readers compare the answers.

## Carried over
- From T04: replace-opening-pipeline and update-pipeline-template replace whole forms, so the editors must send every stage's `feedback_form` back with its ids (omission clears it); `OpeningPipeline.stages` are `OpeningPipelineStage` with `feedback_submitted_count` for the HP-FRM-002 warning.
- From T05: `Interview.stage.feedback_form` (in-house and Work item reads) is the form the dialog renders; `InterviewFeedback.criteria_answers` are `AnsweredCriterion` with `current`; the refusal is `org-interview-feedback-answers-invalid` with `criterion_ids` (`InterviewFeedbackAnswersInvalidDetails` in `typespec/problem/orgs/applications.ts`); bounds are in `typespec/orgs/applications/answers.ts` (`minCriterionRating`, `maxCriterionRating`, `maxCriterionTextValue`).
- From T06: `orgs-ui/src/features/openings/QuestionsEditor.tsx` is the pattern for a nested Form.List editor (move, remove, add limit with reason, per-type inputs); `AnswersCard.tsx` shows answers with `changed`/`removed` tags and "as asked" text. `useStageCountsQuery(openingNumber, enabled)` now takes `enabled`.
