# T09 Offers and offer letters

Requirements: HP-WRK-008, HP-STA-004, the offer rows of the States table,
HP-HUB-003 (offer), `object-storage.md` rules applied to a new PDF object.

Guides: `hiring-pipeline.md`, `object-storage.md`, `federation.md`,
`typespec.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: `backend/handlers/orgs/settings/logo.go` and commit `0652e37`
(Org upload lifecycle, deletion through an outbox task);
`backend/handlers/hub/profile/picture_upload.go`;
`backend/internal/workers/expire_org_openings.go` (state-guarded expiry);
`backend/internal/workers/delete_org_logos.go`.

## Steps

1. Add an "Offer letters" section to `object-storage.md` before coding:
   PDF only (check the `%PDF-` signature, not just the declared type), at
   most 5 MiB, Org-owned, readable by the Opening's readers and the
   applicant, kept for the Org only after withdrawal.
2. Orgs writes: extend offer (letter, optional proposed joining date,
   response deadline 1–60 days) from any stage; withdraw offer (back to
   `in_pipeline`).
3. Hub commands through T03: accept and decline. A `workers` job moves
   offers past their deadline to `offer_declined` in one state-guarded
   statement with history and audit.
4. The Hub detail shows the offer and a letter link the applicant can open
   from any region.

## Tests

Playwright API: extend from several stages, wrong type and oversized
letters, withdraw, accept, decline, expiry, letter access for each reader
and refused for others, Hub user in another region.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Offers run from extension to acceptance, decline, withdrawal, or expiry.

## Carried over

- Security (from T07): an event receiver never checks that the sending
  tenant homes the principal the event is about, so a peer could forge
  projection rows. Mirror T07's command `Initiator` check generically for
  events in `backend/internal/federation/events`: each event kind names its
  origin principal; the receiver verifies it is homed at the source tenant
  (peer certificate, or local) through the directory before applying, and
  refuses a mismatch deterministically. Apply it to
  `hub-application-changed`, add one bullet to `federation.md`, test it, and
  remove the related item T07 added to `docs/todo.md`.
- Add `offer` to the Hub pending actions (projection and live detail).
