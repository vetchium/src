# T14 Orgs portal Applicants, Candidates, and application detail

Requirements: HP-ORG-001 to HP-ORG-003, HP-STA-006 (warning), HP-APP-005
(close dialog), HP-AUTH (actions shown only when allowed).

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`playwright.md`.

Mockups: `orgs-01` to `orgs-03`, `orgs-06`, `orgs-07` (layout), `orgs-10`
(layout).

Exemplars: commits `f2ee56a` and `19dae16`; `orgs-ui/src/pages/OpeningsPage.tsx`
(server-side list with filters and state tabs).

## Steps

1. Applicants tab: server-side list with name search and filters, shortlist
   (stage choice) and not progressing.
2. Candidates tab: counts per stage, state filter for terminal ones, the
   HP-ORG-001 filters; leave the routed-provider filter hidden until T26.
3. Application detail page: snapshot, cover note, stage progress, current
   stage actions from T08 (move, mark review completed, not progressing,
   joining dates and corrections), dates, history. Leave interview, result,
   and offer panels to T15 and the credit panel to T24.
4. Close dialog with the bulk not-progressing choice; positions warning.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: list filters and URL state, shortlist, move with skipped
stages, not progressing, close with bulk choice, read-only team member sees
no actions.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

A recruiter can take an applicant from Applicants to a final outcome other
than an offer in the portal.

## Carried over

- Over-hiring warning: `ApplicationDetail.joined_count > positions` (T08).
- Close dialog sends `mark_applications_not_progressing` on
  `request-opening-change`; show that choice on a pending close request.
- From T10: the `pending_applicant_action` filter (`interview_response`, `offer_response`, and T11's consent) on the applications list.
- From T11: add `background_check_consent` to the pending applicant action filter; show assessments and background checks in the detail and history.
