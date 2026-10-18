# T08 Shortlisting, stage moves, outcomes, and closing

Requirements: the States table except offers, HP-STA-001 to HP-STA-006,
HP-APP-005, HP-WRK-001, HP-GEN-007, `org-application-version-conflict`,
`org-application-state-conflict`.

Guides: `hiring-pipeline.md`, `openings.md` (Lifecycle, requests),
`typespec.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: commit `7067097` (state-guarded writes with version, re-read to
pick the problem, history and audit); T06 schema; T07 projection events.

## Steps

1. Orgs writes, each with `version` and `Idempotency-Key`: shortlist to a
   chosen stage; move forward to a later stage (passed stages `skipped`);
   mark a `review` stage completed; not progressing; record joined on, did
   not join, separated on; correct joined on or separated on within 90 days
   of first recording (history keeps every value).
2. HP-STA-002: leaving the pipeline cancels upcoming interviews (once T10
   exists, wire it there) and ends provider access (T20 wires it).
3. HP-STA-006: hiring beyond `positions` succeeds; responses carry what the
   portal needs to warn.
4. HP-APP-005: closing an Opening offers to mark every non-terminal
   application `not_progressing`. Add the choice to the `close` request; it
   applies when the close applies (self-approved or approved), in that
   transaction.
5. Every write updates the Hub projection (T07) and appends history and
   audit without notes or snapshot text.

## Tests

Playwright API: every allowed transition and every refused one, skipping,
date rules and the correction window, version conflict, replay, permission
matrix, close with and without the bulk choice through both approval paths,
and the Hub status after each change.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

Every non-offer state transition works end to end and refuses everything
else.
