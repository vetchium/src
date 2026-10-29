# T08 Hub portal: Answering application questions

Requirements: HP-QST-004 (inputs and refusal), HP-QST-008, HP-HUB-005.

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`playwright.md`.

Exemplars: `hub-ui/src/pages/ApplyPage.tsx` (cover note, referral, problem
handling), `hub-ui/src/pages/ApplicationDetailPage.tsx` and
`hub-ui/src/features/applications/` cards; locale files
`hub-ui/src/i18n/locales/{en,de,ta}.ts`.

## Steps

1. Apply page: one input per live question in order: text inputs with the
   length limits, a number input with `min`, `max`, and integer steps that
   cannot go outside the bounds, yes/no radios, single-choice radios,
   multiple-choice checkboxes; required marks. Blank optional answers are
   omitted from the request.
2. On `hub-application-answers-invalid`, reload the Opening, keep the answers
   whose questions still exist, mark the named questions, and explain that the
   Org changed its questions.
3. Application detail: a "Your answers" card from `answers`, read-only,
   showing unanswered optional questions as such.
4. Every string in `en`, `de`, `ta`; the `ux.md` screenshot check.

## Tests

`playwright/ui/hub-applications.spec.ts`: apply answering every type; the
number input refuses an out-of-range value; the answers-invalid recovery
after a revise; "Your answers" on detail.

## Checks

`make hub-ui-check`, `make playwright-check`, the changed UI specs against
`make test-environment`.

## Acceptance

Hub users answer questions within their bounds and later read their answers.

## Carried over
- From T02: until the apply page sends `answers`, applying to an Opening with a required question fails with `hub-application-answers-invalid` (`typespec/problem/hub/applications.ts` exports `ApplicationAnswersInvalidDetails`); bounds are in `typespec/orgs/applications/answers.ts`.
- From T03: `MyApplicationDetail.answers` is the applicant's `AnsweredQuestion[]` snapshot (no `current`); the read-only Hub view renders it.
- From T06: `OpeningContentView` takes an optional `questions` presentation (`heading`, `describe`) and shows `content.questions` only when given; Orgs builds it in `orgs-ui/src/features/openings/presentation.ts` (`describeQuestion`). `typespec/common/openings.ts` now exports `maxQuestionText` and `maxQuestionOption`.
