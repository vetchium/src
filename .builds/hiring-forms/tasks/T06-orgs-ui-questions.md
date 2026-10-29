# T06 Orgs portal: Application questions and answers

Requirements: HP-QST-009, HP-QST-006, HP-QST-007, HP-ORG-002, HP-ORG-003.

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`openings.md`, `playwright.md`.

Exemplars: `orgs-ui/src/features/openings/OpeningEditor.tsx` (form sections,
validation messages from `problems.ts`), `publication.ts` (live against
working copy comparison), `orgs-ui/src/pages/OpeningDetailPage.tsx`,
`orgs-ui/src/features/applications/SnapshotCard.tsx`, `ApplicantsTab.tsx`,
`CandidatesTab.tsx`, `listState.ts`; locale files
`orgs-ui/src/i18n/locales/{en,de,ta}.ts`.

## Steps

1. Opening editor: a Questions section (add, edit, reorder, remove; type
   select; required switch; min/max for `number`; 2–8 options for choice
   types) enforcing HP-QST-001 in the inputs, sending ids back unchanged.
   When the Opening has live content and the working copy's questions differ
   from live (compare in `publication.ts`), show the HP-QST-009 warning with
   the application count from `get-application-counts`.
2. Opening detail: show questions in the content view and in the pending
   revision comparison.
3. Application detail: an Answers card after the snapshot; unanswered
   optional questions say so; a `changed` or `removed` answer is marked with
   a tag and shows the question as asked.
4. Applicants and Candidates tabs: a column picker offering up to 3 eligible
   live questions, stored in `localStorage` under a key per Opening (wrapped
   in try/catch per `ui.md`), sent as `answer_columns`, rendered per type.
5. Every string in `en`, `de`, `ta`; the `ux.md` screenshot check for each
   new state.

## Tests

`playwright/ui/orgs-openings.spec.ts`: add each question type, the bounds in
inputs, the published-Opening warning. `playwright/ui/orgs-applications.spec.ts`:
answers card with a changed and a removed question; column picker shows and
remembers a column.

## Checks

`make orgs-ui-check`, `make playwright-check`, the changed UI specs against
`make test-environment`.

## Acceptance

Managers edit questions with the warning; readers see answers with
highlights and optional list columns.

## Carried over
