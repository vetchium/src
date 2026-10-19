# T15 Orgs portal interviews, results, offers, and joining

Requirements: HP-WRK-001 to HP-WRK-008, HP-ORG-002, HP-ORG-003,
HP-AUTH-003.

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`playwright.md`.

Mockups: `orgs-07` to `orgs-12`.

Exemplars: T14's application detail; `orgs-ui/src/features/openings/`
(forms, problems); the logo upload in `orgs-ui` (`git grep -n -i logo
orgs-ui/src`) for the PDF upload.

## Steps

1. Interview panel: schedule, change, cancel, outcome, feedback dialog with
   the "others after you submit" rule; the interviewer-only view.
2. Assessment and background-check panels: results, check selection,
   consent state.
3. Offer: extend dialog with PDF upload, withdraw, state and letter link;
   record joining and did not join; corrections within the window.
4. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: schedule and give feedback, record an assessment, extend and
withdraw an offer with a letter, record joining.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

Every stage's work and the offer run from the portal.

## Carried over

- From T09: the offer dialog is upload-then-extend: `upload-offer-letter` (raw PDF body, ≤ 5 MiB) returns `letter_id`, then `extend-application-offer` claims it. Map `org-offer-letter-invalid`, `org-offer-letter-too-large`, `org-offer-letter-conflict`.
- From T09: show the over-hiring warning when `joined_count >= positions` before extending an offer; list letters from `ApplicationDetail.offers` (newest first, withdrawn ones included); signed links last ten minutes, so re-read before opening.
- From T10: interviews from `ApplicationDetail.interviews` (schedule, change, cancel, record outcome, submit feedback; others' feedback hidden until the viewer submits). An interviewer-only "My interviews" page on `list-my-interviews`. Interviewers see no offers. Strings in en, de, ta.
- From T11: record assessment result, request background-check consent (check types), record background-check results; re-ask after a declined or ended request. Interviewer-only readers see no results. Strings in en, de, ta.
- From T12: removed applications have no offers, interviews, or results; hide the stage-work actions for them.
- From T14: put the stage-work actions in `orgs-ui/src/features/applications/ApplicationActions.tsx` (Actions card; "Extend offer" and offer withdraw for `offered`) and panels in `StageWork.tsx` (currently read-only). Replace the text-only interviewer lists with an Org user picker. Reuse `playwright/lib/orgs-applications.ts` and `playwright/lib/orgs-ui.ts`.
