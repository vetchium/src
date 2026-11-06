# Agency chat requests brief

## Summary

Agencies (Orgs with a listed `sourcing` Listing; users with
`org:fulfil_engagements`) may start a conversation with a Hub user only by a
chat request carrying one `published` Opening the agency is assigned to, plus
an optional note; the Hub user accepts or declines in Hub Messages. Hub users
may, from a `published` Opening's page, see every agency assigned to it and
send one a chat request; any agency user with `org:fulfil_engagements`
accepts or declines it (shared inbox) and sees pending requests on Orgs Home
and as a navigation count. An accepted conversation stays open per side for
a window (default 90 days, `marketplace.conversationWindow` in the Hub user's
tenant config) after the other side's latest activity; once it lapses, that
side needs a new accepted request. The handle-based "start conversation" is
removed; notes and the profile view stay. Touches orgs-api, hub-api,
mesh-api, workers, the Orgs and Hub portals, dev-seed, Playwright, and the
demo video. Out of scope: attachments, blocking an agency outright,
withdrawing a request, email to Org users, migrating existing data
(pre-launch).

Specification: `agent-guides/marketplace.md` MKT-REQ-001 to MKT-REQ-012,
MKT-DAT-003 to MKT-DAT-006, MKT-DAT-014, MKT-CNV-002/003/005/006/010,
MKT-CON-001/003/005/006, MKT-PRF-002/003/005, MKT-SRC-004, MKT-UI-006 to
MKT-UI-008, MKT-UI-011, MKT-UI-012, MKT-HUB-001/002/005, MKT-TST-001 to
MKT-TST-003, and the problem table.

## Questions and answers

1. Summary as written? — Yes.
2. What keeps a conversation open? — The other party's activity: a side may
   write while the other side's latest message or acceptance is within the
   window, so neither side keeps it open alone.
3. Which agencies may a Hub user request? — Only agencies with an active
   `sourcing` engagement assigned to the Opening, from its page.
4. When does the Hub Opening page list its agencies? — Always.
5. What does a request carry? — The Opening plus an optional note of up to
   1,000 code points.
6. Decline? — The decliner picks "Not this Opening" (that sender may never
   request with that Opening again) or "Not for <N> days" (no request from
   that sender for one window). Unanswered requests expire after 14 days with
   no block. The decliner may still send its own request.
7. The Hub setting "Agencies may message me"? — Becomes "Agencies may send me
   chat requests": off refuses agency requests only; accepted conversations
   continue.
8. Org notifications? — In-portal only: Home card and navigation count.
9. Daily limits? — Agency 50 requests per UTC day, Hub user 10; one pending
   request per (agency, person) pair.
10. Withdrawing a pending request? — Not allowed.

Stated from the code and accepted: request and conversation state stay in
the agency's tenant; the Hub tenant stamps its window on every command it
sends; one conversation per pair, reopened by a later request; the request
becomes a `request` message on acceptance and an agency request's Opening
becomes a suggestion only then; a Hub-created Contact does not count toward
the agency's Contact cap; Hub user emails for a new agency request and for
an agency accepting; delete, 365-day message retention, notes, and the
profile view are unchanged.

## API

| Operation | API | Permission | Request | Success | Problems added |
| --- | --- | --- | --- | --- | --- |
| `POST /api/orgs/send-chat-request` (replaces `start-conversation`) | orgs | `org:fulfil_engagements` | `address` or `contact_id`, `suggestion`, `note?` | 200 `ChatRequest` | `org-chat-request-exists`, `org-chat-request-blocked`, `org-chat-request-limit-reached` (replaces `org-conversation-limit-reached`), `org-conversation-open`, `org-agency-requests-off` (replaces `org-agency-messages-off`) |
| `POST /api/orgs/list-chat-requests` | orgs | same | `direction`, `pagination_key?`, `limit?` | 200 page | — |
| `POST /api/orgs/count-pending-chat-requests` | orgs | same | `{}` | 200 `{count}` | — |
| `POST /api/orgs/accept-chat-request` | orgs | same | `request_id` | 200 `ConversationDetail` | `org-chat-request-not-found` |
| `POST /api/orgs/decline-chat-request` | orgs | same | `request_id`, `scope` | 200 | `org-chat-request-not-found` |
| `POST /api/orgs/send-message`, `/get-conversation` (changed) | orgs | same | unchanged | adds window instants and the pending request | `org-conversation-closed` |
| `POST /api/hub/list-opening-agencies` | hub | signed in | `org_domain`, `opening_number` | 200 agencies with chat state | `hub-org-unavailable` |
| `POST /api/hub/send-chat-request` | hub | signed in | `org_domain`, `opening_number`, `agency_domain`, `note?` | 200 or 202 `PendingOperation` | `hub-agency-not-assigned`, `hub-chat-request-exists`, `hub-chat-request-blocked`, `hub-chat-request-limit-reached`, `hub-conversation-open` |
| `POST /api/hub/list-chat-requests` | hub | signed in | `direction`, `pagination_key?`, `limit?` | 200 page | — |
| `POST /api/hub/accept-chat-request` | hub | signed in | `request_id` | 200 or 202 | `hub-chat-request-not-found` |
| `POST /api/hub/decline-chat-request` | hub | signed in | `request_id`, `scope` | 200 or 202 | `hub-chat-request-not-found` |
| `POST /api/hub/reply-to-conversation`, `/get-conversation` (changed) | hub | signed in | unchanged | adds window instants and the pending request | `hub-conversation-closed` |
| `POST /api/hub/set-agencies-may-message` (meaning changes) | hub | signed in | unchanged | unchanged | — |

Mesh: new durable commands and events for requests, answers, and the
assigned-agency read with the Opening (`federation.md`). A `workers` job
expires unanswered requests after 14 days.

## UI

| Portal | Route | Navigation | Screen | Who |
| --- | --- | --- | --- | --- |
| Orgs | `/` Home | pinned | "Chat requests" card: five oldest pending, See all | `org:fulfil_engagements` in an agency |
| Orgs | `/sourcing/contacts` | Sourcing › Contacts; count adds pending requests | Requests tab (to the agency, then sent) | same |
| Orgs | `/sourcing/contacts/:id` | — | Request banner (Accept, Not this Opening, Not for N days); closed notice with Send chat request | same |
| Orgs | Job detail, profile view (`/sourcing/contacts/new`) | — | "Send chat request" dialog | same |
| Hub | `/org/:domain/openings/:number` | — | "Agencies working on this Opening" with per-agency state and Request chat | signed-in Hub user |
| Hub | `/messages`, `/messages/:contactId` | Messages | Requests to the user first; sent requests' state; closed notice | signed-in Hub user |
| Hub | `/settings/preferences` | Settings | "Agencies may send me chat requests" | signed-in Hub user |

## Out of scope

- Attachments, edits, read receipts.
- Withdrawing a request; blocking an agency outright; reporting an agency.
- Email notifications to Org users.
- Hub requests to agencies not assigned to an Opening.
- Migrating existing conversations (pre-launch; data is disposable).
