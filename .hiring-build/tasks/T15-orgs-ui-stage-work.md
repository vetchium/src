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
