# Review fixes for init-agencies

Temporary resumption aid; delete this directory in the final commit.
Spec: `agent-guides/hiring-pipeline.md`, `agent-guides/marketplace.md`.
Original build plan (removed in 1123654): `git show 1123654^:.hiring-build/`.

## Rules for whoever resumes

- Read this file, `git log --oneline -15`, and `git status`; continue at the
  first unchecked item. Check an item (`[x]`) in the commit that finishes it.
- Commit per group, push after each commit. No AI attribution in commits.
- `make fmt`, then the narrow checks from `agent-guides/verification.md`
  while working; `make test` must pass before the last commit.
- Test data is created through APIs. SQL in Playwright only where `main`
  does it: creating active Hub users/sessions (`seedActiveHubUser`,
  `seedHubSession`), aging timestamps for time rules, cleanup, and
  fault injection.

## User decisions (2026-10-24)

- Hub agency logos: defer. Remove the broken logo field end to end, note it
  in `docs/todo.md`, and say so in MKT-HUB-001.
- Orgs navigation: spec plus a way in. `org:manage_listings` holders always
  see Listings; Clients and Work queue appear once the Org has a Listing or
  a provider engagement; the Agency group once it has a `sourcing` Listing
  or `sourcing` engagement as provider. `my-info` carries the flags.

## A. Agency Contacts and conversations (backend)

- [x] A1 SEC: `agencyconversations` reply/delete refuse a Contact whose
      `hub_user_did` differs from the payload's (`hub-conversation-not-found`).
- [x] A2 One helper builds every agency pointer event from the database
      (contact, conversation, suggestions query, agency name/domain), and
      bumps `pointer_version` on every event. Fixes: StartConversation on a
      notes-first Contact re-sending the old version (Hub never sees it);
      Hub reply wiping pointer suggestions (breaks suggested referral).
- [x] A3 Hub deletes conversation: delete a Contact with no notes in the same
      transaction (pointer `present: false`).
- [x] A4 `hub-account-deleted` receiver: delete the person's notes; keep a
      Contact that has a conversation and mark the conversation
      `hub_user_deleted` + `party_deleted_at` (scoped to the agency Org);
      delete a Contact without one. Notes on such a Contact are refused
      (`org-conversation-party-deleted`).
- [x] A5 Suggestion (start/send): confirm assignment + `published` with the
      consumer's tenant via the jobs mesh read, not the local projection.
- [x] A6 Agency unread is a count (`agency_unread_count`), incremented per Hub
      message, reset by mark-read; `MarkOrgConversationRead` scoped by Org.
- [x] A7 Suggestions from a dedicated query, not by loading every message.
- [x] A8 Conversation retention never touches Contact `last_activity_at`;
      stop swallowing errors in `retainConversation`.
- [x] A9 Hub `set-agencies-may-message`: turning on clears only
      `messages_off` reasons; enqueue without a query loop if possible.
- [x] A10 Hub `get-conversation` maps agency not-found to
      `hub-conversation-not-found`; Hub delete handles the local pointer
      write error.
- [x] A11 Remove agency logo from pointer table, payload, Hub contract, UI
      (todo + MKT-HUB-001 note in E1).
- [x] A13 Contacts list: server-side `not_contacted` filter and name search
      (at least two characters), tab counts in the response (nav badge uses
      the unread count); UI stops filtering one page client-side.
- [x] A14 Peer conversation read answers only the tenant homing the Hub
      user; relay passes not-found and invalid cursor through; conversation
      messages paginate (Orgs, mesh, Hub); mesh read names the agency, not
      its users, and carries no agency unread state.
- [x] A12 Go tests for `agencycontacts` and `agencyconversations` handlers.

## B. Other backend fixes

- [ ] B1 DID leaks: drop `agency_org_did` from Hub conversation summary;
      `applicant_did` only on the mesh credited-application type, never on
      the Orgs browser type.
- [ ] B2 `list-credited-applications`: keyset position fan-out like
      work/jobs, applicant DID filter pushed to peers for `contact_id`;
      Contact credited counts from a per-applicant count read, not the first
      50 credits.
- [ ] B3 Reroute, route cleared, stage unassigned, engagement ended: cancel
      the previous performer's upcoming interviews and end its requested
      consents, with history and Hub projection events. Remove the
      `docs/todo.md` deferral.
- [ ] B4 Provider work replay: skip the interviewer precheck when an
      operation already exists for (kind, aggregate, key). Remove deferral.
- [ ] B5 `my-info` marketplace flags + navigation per user decision.
- [ ] B6 Provider statement locates the consumer by DID, not recorded domain.
- [ ] B7 Activity fact pruning in bounded batches.

## C. Tests

- [ ] C1 Replace SQL application seeding (`seedApplication`,
      `seedSubmittedBatch`, inline INSERTs of applicants, applications,
      history, interviews, opening state/suspension) with Hub apply + Orgs
      API transitions; SQL only to age timestamps. Use small `limit` for
      pagination instead of 100+ rows.
- [ ] C2 Remove forged mesh events that stand in for real flows
      (messages-off, referral pointer); poll the real outbox delivery. Keep
      the origin-mismatch security test and the account-deleted receiver
      (account deletion is not built).
- [ ] C3 Cover every response listed missing by `make api-coverage-report`
      for this branch's operations (baseline list in git history of this
      file's commit message is not kept; rerun the report).
- [ ] C4 Tests for A1-A11 and B1-B6 behavior.
- [ ] C5 Fix `ui/hub-applications.spec.ts:364` (fails on baseline).

## D. UI

- [ ] D1 Hard-coded strings: `ListingEditorPage.tsx` aria-label,
      `WorkItemDetailPage.tsx` placeholder.
- [ ] D2 Contacts nav unread badge from a count, not page length.
- [ ] D3 Navigation per B5; UI tests.

## E. Finish

- [ ] E1 Guides and `docs/todo.md` match the result.
- [ ] E2 `make test` green; `make test-go-lint`, `make test-go-vuln`.
- [ ] E3 `make dev-seed` runs on a fresh stack.
- [ ] E4 Delete `.review-build/`, final commit, push.
