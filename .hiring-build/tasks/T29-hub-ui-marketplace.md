# T29 Hub portal messages, referrals, and provider notices

Requirements: MKT-HUB-001 to MKT-HUB-004, MKT-PRF-004, HP-HUB-004,
MKT-SRC-002 (apply page).

Guides: `ui.md`, `ux.md`, `typescript.md`, `marketplace.md`,
`playwright.md`.

Mockups: `hub-02` to `hub-04`, `hub-06`, `hub-08`, `hub-10` to `hub-13`,
`phone-03`, `phone-04`.

Exemplars: T16 pages; `hub-ui/src/pages/PreferencesPage.tsx`,
`WorkEmailsPage.tsx`.

## Steps

1. Messages page (navigation entry with unread count): conversations with
   agency name, domain, and logo; reply; delete with confirmation; Opening
   suggestion cards linking to the apply page; the retry notice when the
   agency tenant does not answer.
2. Apply page "Referred by": no agency by default, agencies that suggested
   the Opening (preselected when arriving from a suggestion), or another
   agency by domain, with the one-sentence explanation and the
   not-eligible error.
3. Preferences: "Agencies may message me". Professional emails: what
   agencies see.
4. Application detail names the provider performing a step.
5. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`,
   including 390px.

## Tests

Playwright UI: reply and delete, apply from a suggestion, declared referral
refused then corrected, turning messages off.

## Checks

`make hub-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

Hub users handle agencies and referrals from the portal.
