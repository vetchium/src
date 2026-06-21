# Candidacy Discussion — Future Improvements

Status: NOT STARTED
Scope: hub-ui + org-ui + api-server (regional DB)

## Background

Every candidacy has a **shared discussion thread** that both parties can read and
write to:

- The candidate sees and posts to it from the Hub portal on the candidacy detail
  page (`hub-ui/src/pages/Candidacies/MyCandidacyDetailPage.tsx`).
- The hiring team sees and posts to it from the Org portal on the candidacy detail
  page (`org-ui/src/pages/candidacies/CandidacyDetailPage.tsx`).

Messages are stored in the regional `candidacy_comments` table and exposed through
`POST /hub/add-candidacy-comment`, `POST /org/add-candidacy-comment`, and the
`get-candidacy` / `get-my-candidacy` reads (`CandidacyComment` in
`api-schema/{org,hub}/candidacies.tsp`).

Today the thread is a flat list rendered with an Ant Design `Timeline`: every
message is loaded and shown at once, in creation order, with no notion of read
state. This is functional for a handful of messages but degrades badly as a
conversation grows, and neither party is alerted when the other replies.

## Goals

Turn the thread into a usable, chat-like conversation:

1. **Unread tracking.** Record, per viewer, the timestamp of the last message they
   have seen. Surface an unread count on the candidacy list rows and dashboard
   tiles, and an in-thread "new messages" divider.
2. **Notifications.** When one party posts a message, notify the other (email
   and/or in-app), with sensible batching so a burst of messages does not produce
   a burst of emails.
3. **Pagination.** Load only the most recent N messages with a "load older"
   affordance (keyset by `created_at`), instead of rendering the entire history
   eagerly. Both list endpoints must follow the project's keyset-pagination rule.

### Optional, later

- Edit / delete window for a sender's own recent message.
- Sent / delivered / read receipts.
- Attachments.

## Implementation outline

**Database (regional).** Add a way to record each viewer's last-read position —
either a `candidacy_comment_reads` table keyed by `(candidacy_id, viewer_id)` with
a `last_read_at`, or a `last_read_at` column on the existing per-party candidacy
membership. Keep audit-log and transaction rules per `CLAUDE.md`.

**API (TypeSpec + handlers).**

- Add a paginated `list-candidacy-comments` read (org + hub) returning messages
  keyset-paginated newest-first, plus an `unread_count` and the viewer's
  `last_read_at` on the candidacy summary/detail models.
- Add a `mark-candidacy-read` write (org + hub) that advances `last_read_at`.
- Enqueue a notification email on `add-candidacy-comment` for the other party,
  respecting existing notification-batching conventions.
- Handlers live in `api-server/handlers/{org,hub}/candidacies.go`; all SQL via
  sqlc in the regional query files.

**UI (both portals).** Replace the flat `Timeline` with a paginated, unread-aware
message list: show the most recent messages, a "load older" control, a "new
messages" divider at the first unread message, and call `mark-candidacy-read` when
the thread is viewed. Add an unread badge to the candidacy list and dashboard
tiles.

## Acceptance criteria

- [ ] A viewer only loads recent messages initially and can page older ones.
- [ ] Posting a message notifies the other party (batched).
- [ ] Each party sees an accurate unread count until they open the thread.
- [ ] Opening the thread clears the unread count for that viewer.
- [ ] All new list endpoints use keyset pagination (no OFFSET).
- [ ] Every new write handler records an audit-log entry in its transaction.
- [ ] RBAC positive/negative + audit-log tests accompany each new endpoint.
