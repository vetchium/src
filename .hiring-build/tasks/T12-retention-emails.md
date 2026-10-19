# T12 Application retention and notification emails

Requirements: HP-RET-001, HP-RET-002, HP-GEN-006.

Guides: `hiring-pipeline.md`, `object-storage.md`, `backend.md`,
`database.md`, `federation.md`, `playwright.md`.

Exemplars: `backend/internal/workers/expire_org_openings.go`,
`deliver_hub_email.go`, `delete_org_logos.go`; `vetchium.hub_email_outbox`.

## Steps

1. A `workers` job in the Org tenant: 365 days after an application becomes
   terminal (for `joined`, 365 days after `joined_on` once the separation
   window closes) one state-guarded statement per application deletes the
   snapshot, cover note, interview details, feedback, results, notes, links,
   and offer letter reference, enqueues the letter object for deletion and
   the Hub projection deletion, and audits. Keep numbers, states, dates,
   credit, and billable facts; readers show "Removed applicant".
2. The Hub tenant sends notification emails from projection events that need
   the applicant (status change, interview, consent, offer): Org name,
   Opening title, link; never interview, offer, or result content. Email
   templates in every Hub locale.

## Tests

Go tests for the retention selection and boundaries; Playwright API that a
retained application reads as removed on both sides and that emails arrive
(Mailpit) without content.

## Checks

`make sqlc`, `make sql-check`, `make test-go`, `make test-go-static`,
`make playwright-check`, new specs against `make test-environment`.

## Acceptance

Personal data leaves on schedule; applicants are told when something needs
them.

## Carried over

- From T09: remove offer letters through retention. `org_application_offers.letter_object_id` is NOT NULL and its FK to the letter row is `DEFERRABLE INITIALLY DEFERRED`, so drop or retire the offers' reference in the same transaction before deleting a letter row.
- From T09: send the offer emails (extended, withdrawn, expiring, expired); no offer content in any email.
- From T09: add a Go test for the `delete-offer-letters` worker (unclaimed staged letters).
- From T10: retention deletes interviews, interviewers, and feedback with their application explicitly (do not rely on the cascade alone).
- From T10: interview scheduled, changed, or cancelled emails to the Hub user, driven by the projection event.
- From T10: the Hub list projection derives "upcoming"/"unanswered" interview pending actions only when an event is written (HP-HUB-007); add a time-based refresh so a passed, unanswered interview leaves the list's pending actions.
