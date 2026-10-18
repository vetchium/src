# T23 Agency conversations and Hub messages

Requirements: MKT-CNV-001 to MKT-CNV-012, MKT-DAT-003 to MKT-DAT-007,
MKT-DAT-010, MKT-SRC-004 (suggestions), MKT-HUB-001, MKT-HUB-002,
`org-conversation-*`, `org-agency-messages-off`, `hub-conversation-*`.

Guides: `marketplace.md`, `federation.md`, `typespec.md`, `backend.md`,
`database.md`, `playwright.md`.

Exemplars: T22 (Contacts, pointers), T03, T04, `deliver_hub_email.go`
(notification emails).

## Steps

1. Agency side: start a conversation by handle or alias (creates the
   Contact if absent; caps per MKT-CNV-003 and MKT-CON-005), send text or an
   Opening suggestion (assigned and `published`, confirmed with the consumer
   tenant), shared inbox with per-agency unread state.
2. Hub side: conversation list from pointers that have a conversation,
   messages read live with a deadline, reply and delete as T03 commands,
   mark read on the pointer, "Agencies may message me" setting propagated
   to every pointer. Deleting a conversation keeps the Contact and notes.
3. Read-only reasons (messages off, party deleted) on both sides; message
   retention 365 days after the last message.
4. Notification emails from the Hub tenant naming the agency, never content.

## Tests

Playwright API: everything MKT-TST-001 and MKT-TST-002 list for
conversations, including tenants not answering and the setting racing a
start.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Agencies and Hub users in different regions talk inside Vetchium.
