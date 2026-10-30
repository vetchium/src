# T09 Question and feedback form fixtures

Requirements: HP-TST-002.

Guides: `database.md` (seeds), `hiring-pipeline.md`, `playwright.md`.

Exemplars: `backend/cmd/dev-seed/org_openings.go`, `applications.go`,
`marketplace.go`; `playwright/lib/hiring-seed.ts`.

## Steps

1. `dev-seed`: in each seeded Org, Openings with questions covering every
   type (including bounded numbers and multiple choice), applications
   answering them, and one Opening revised after answers arrived so detail
   shows `changed` and `removed`.
2. Pipeline templates with feedback forms on interview stages; seeded
   interviews with submitted feedback answering criteria, in-house and by the
   `itv1` provider.
3. Extend `playwright/lib/hiring-seed.ts` only if specs from T01–T08 repeat
   setup that a helper would remove.
4. Run `make dev-seed` and check the seeded screens in both portals.

## Tests

`make dev-seed` completes; the screens show the seeded states.

## Checks

`make test-go`, `make test-go-static`, `make dev-seed`.

## Acceptance

A fresh `make dev-seed` demonstrates every question type, stale answers, and
feedback forms in-house and through a provider.

## Carried over
- From T08: the Hub apply page sends `answers` from `hub-ui/src/features/applications/QuestionInputs.tsx` (`answersFor`); seeded applications with answers appear in the Hub "Your answers" card and the Orgs `AnswersCard`.
