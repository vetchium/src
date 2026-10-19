# T16 Hub portal apply and applications

Requirements: HP-APP-001 to HP-APP-003, HP-HUB-001 to HP-HUB-003,
HP-HUB-005. The "Referred by" choice is T29; provider notices are T29.

Guides: `ui.md`, `ux.md`, `typescript.md`, `hiring-pipeline.md`,
`playwright.md`.

Mockups: `hub-01`, `hub-02`, `hub-03` (without Referred by), `hub-05` to
`hub-09`, `phone-01`, `phone-02`. Build only what the guides list; the
mockup's "View what you sent" link is not specified, so leave it out.

Exemplars: commit `5866031` (Hub Org and Opening pages);
`hub-ui/src/pages/OrgOpeningPage.tsx`, `hub-ui/src/features/openings/`;
`hub-ui/src/app/PendingOperationContext.tsx` (the `202` flow);
`playwright/ui/hub-org-page.spec.ts`.

## Steps

1. Opening page: Apply, or "You applied" with a link when an application
   exists; not-accepting states explained.
2. Apply page: what the Org will see, cover note, submit; the `202` pending
   flow.
3. Applications page (navigation entry with the action-needed count) and
   detail: Hub status, pending actions (interview accept or reschedule,
   consent, offer accept or decline with the letter), withdraw with a
   confirmation, the `hub-org-unavailable` retry state.
4. Home: a card for applications that need an answer.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`,
   including 390px.

## Tests

Playwright UI: apply, pending outcome, list, answer an interview, consent,
accept an offer, withdraw, Org unavailable.

## Checks

`make hub-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

A Hub user applies and handles every request from the Org in the portal.

## Carried over

- From T09: offer card on the application page with accept/decline (`/api/hub/accept-application-offer`, `/api/hub/decline-application-offer`) sending `offer.offer_number`; handle 202 PendingOperation and `hub-application-state-conflict`. Show `offer_response` as a pending action.
- From T09: the letter link expires after ten minutes; re-read `get-my-application` before opening it. Strings in en, de, ta.
- From T10: interviews from `MyApplicationDetail.interviews` with accept (`accept-application-interview`) and request reschedule with a 1–500 note (`request-application-interview-reschedule`); handle 202 PendingOperation. Strings in en, de, ta.
- From T11: consent card from `MyApplicationDetail.background_check_consent` (check types, performer) with give/decline (`give-application-background-check-consent`, `decline-application-background-check-consent`) sending `check_number`; `background_check_consent` pending action.
- From T12: emails link to `<hub base>/applications?region=<tenant>`; that route must exist and the `region` parameter must pick the tenant (add a per-application route if better, and update the email link builder). Pending actions can clear after an interview starts; a removed application answers `hub-application-not-found`.
