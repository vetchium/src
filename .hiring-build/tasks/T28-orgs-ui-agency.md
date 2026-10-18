# T28 Orgs portal agency Jobs, Contacts, and credits

Requirements: MKT-UI-006 to MKT-UI-010, the Agency row of the navigation
table, MKT-CON-003, MKT-CNV-010, MKT-PRF-005, MKT-NOTE.

Guides: `ui.md`, `ux.md`, `typescript.md`, `marketplace.md`,
`playwright.md`.

Mockups: `agency-01` to `agency-11`, `dark-02`.

Exemplars: T26 and T27 pages.

## Steps

1. Agency navigation group with the unread count on Contacts.
2. Jobs and Job detail (Opening as Hub users see it, credits, suggested-to
   contacts, Suggest to a contact).
3. Contacts as the shared inbox (All, Unread, In conversation, Not
   contacted; search; New contact by handle or alias opening the profile
   view).
4. Contact detail: Conversation, Notes, Profile (with notes), Suggested
   Openings, Credited applications; the messages-off and account-deleted
   states.
5. Credited applications with filters.
6. Every string in `en`, `de`, `ta`; screenshot each state per `ux.md`.

## Tests

Playwright UI: new contact with a note, start a conversation, suggest an
Opening, messages-off state, edit and delete notes.

## Checks

`make orgs-ui-check`, `make playwright-check`, new UI specs against
`make test-environment`.

## Acceptance

An agency works its contacts and jobs from the portal.
