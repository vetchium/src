# T22 Agency Contacts, notes, and profile view

Requirements: MKT-CON-001 to MKT-CON-006, MKT-NOTE-001 to MKT-NOTE-006,
MKT-PRF-001 to MKT-PRF-005, MKT-DAT-003 (pointers without a conversation),
MKT-DAT-006, MKT-DAT-012 (the parts that exist), MKT-DAT-013,
`org-contact-*` and `org-hub-user-not-found` problems.

Guides: `marketplace.md`, `hub-profile.md`, `federation.md`,
`typespec.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: `backend/internal/profileclient/` and `backend/handlers/mesh/profile.go`
(remote profile reads); T03 and T04.

## Steps

1. Agency profile view: `PublicProfile` plus verified professional-email
   domains with first and last verification month and year, by handle or
   alias, local or remote; never record the view.
2. Schema in the agency tenant: Contacts (agency, Hub user DID, recorded
   display name and handle, creator, messages-off state) and notes (author,
   text, created and edited times). Hub tenant: the agency pointer per
   Contact, never returned by any Hub API.
3. Writing the first note creates the Contact (cap 200 per UTC day under
   the agency Org lock) and enqueues the pointer; the Hub tenant answers an
   unknown account with the deletion notice. Notes: add, author-only edit,
   any user deletes; the last deletion removes a Contact without a
   conversation.
4. A `workers` job deletes Contacts 730 days after their last note or
   message. Hub account deletion does not exist yet; build the receiver for
   its notice so T31 needs no change.
5. Contacts list (name, handle, last activity, note count; unread and
   credited counts arrive in T23 and T24) and Contact detail.

## Tests

Playwright API: profile view fields and refusals, note bounds and
permissions, both caps, pointer created and hidden from Hub responses, no
note text in any Hub, consumer, or mesh response, last-note deletion,
retention, notice receiver.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Agencies keep private notes on people in any region; Hub users never see
them.
