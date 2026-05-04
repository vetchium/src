## Stage 1: Requirements

Status: DRAFT (READY FOR IMPLEMENTATION — both prerequisites are now drafted)
Authors: @psankar
Dependencies:

- **hub-employer-ids** — verified work-email stints with multi-stint support. Spec at `specs/hub-employer-ids/README.md`. The eligibility query in this spec joins on the `hub_employer_stints` table defined there; the cross-tenure-overlap math relies on `(first_verified_at, last_verified_at)` from active+ended rows.
- **hub-profile** — handle-keyed profile pages where the Connect-button widget is rendered. Spec at `specs/hub-profile/README.md`. This spec owns the connection state machine and the `connections/get-status` endpoint; hub-profile owns the page chrome and renders our widget table.
  Future specs: hub-job-applications (endorsement request/response flow, which relies on both connections and employer-id verifications)

### Overview

HubUsers who have verifiably worked at the same employer can connect with each other as colleagues. A connection is a bilateral relationship: one user initiates a request and the other accepts or rejects it. Once connected, colleagues form the trust network used for peer endorsements — when a HubUser applies for a job, they can request endorsements from connected colleagues who have a verified association with the same employer.

Two users cannot connect simply by choosing to — both must present evidence of shared employment. Two users may connect only if at least one of A's employment stints at a shared employer domain overlaps with at least one of B's stints at that same domain. hub-employer-ids stores one record per stint; a stint ends when the user stops re-verifying (their `last_verified_at` freezes). This directly captures "they were there at the same time" and correctly handles users who had multiple separate stints at the same employer. The full verification and re-verification process is defined in the hub-employer-ids spec. Handle-based discovery of potential colleagues (profiles to connect with) is out of scope here and belongs to the hub-profile spec.

This spec covers the connection lifecycle (eligibility check, send / accept / reject / withdraw / disconnect) and blocking (block / unblock), plus the connection-state field exposed when a HubUser views another's profile. Endorsement mechanics are deferred to hub-job-applications.

Portal affected: Hub only. All write operations are initiated by HubUsers.

### Connection State Machine

**Connection lifecycle**

```
[no record]
    │
    └── A sends request ──> pending   (A = requester, B = recipient)
                               │
                               ├── B accepts ──> connected
                               │                    │
                               │                    ├── A disconnects ──> disconnected
                               │                    │     (A may re-request B later;
                               │                    │      B may NOT request A)
                               │                    │
                               │                    └── B disconnects ──> disconnected
                               │                          (B may re-request A later;
                               │                           A may NOT request B)
                               │
                               ├── B rejects ──> rejected
                               │                  (A cannot re-request B;
                               │                   B may still send a fresh request to A)
                               │
                               └── A withdraws ──> [record deleted]
                                                    (either party may request the other later)
```

**Block lifecycle** (stored separately; overrides the connection lifecycle)

```
[any state, including no record]
    │
    └── A blocks B ──> blocked
          │   (any pending request between A and B is cancelled;
          │    any active connection between A and B is severed;
          │    B can still view A's profile but sees `blocked_by_them` state with no action;
          │    B cannot send any connection request to A while the block is active;
          │    A also cannot request B while the block is active)
          │
          └── A unblocks B ──> [block record deleted; prior connection history preserved]
                                (prior rejected / disconnected records survive;
                                 eligibility resumes from the state before the block,
                                 not from a clean slate)
```

**Eligibility — A may send a request to B if and only if all of the following are true:**

1. A ≠ B
2. Both A and B have at least one **stint** at the **same employer domain** whose tenure ranges overlap. hub-employer-ids stores one record per stint per domain (a new stint is created when a user re-adds an email on a domain they previously left, implicitly ending the prior stint). Each stint carries its own `[first_verified_at, last_verified_at]` interval. The eligibility check passes if **any** of A's stints at a shared domain overlaps with **any** of B's stints at that same domain.
3. No block record exists in either direction (A has not blocked B, and B has not blocked A)
4. No `pending` record exists in either direction between A and B
5. No `connected` record exists between A and B
6. No `rejected` record exists where A is the requester (B previously rejected A's request)
7. No `disconnected` record exists where **B was the disconnector** (B ended the connection, signalling they did not want it — A should not be able to force reconnection)

Condition 2 is enforced as a gateway: if the users share no employer domain with overlapping tenure ranges, the request is rejected with 453 regardless of connection history.

Condition 3 takes precedence over all others: a block check is performed first; if either party has blocked the other, the request returns 457 (caller blocked target) or 460 (target blocked caller) regardless of connection history or employer eligibility.

**Disconnection is asymmetric.** The person who disconnects may re-request the other later (colleagues may patch up). The person who was disconnected from may not re-request — the other party signalled they wanted out. This mirrors the rejection asymmetry: the actor who ends the relationship retains the option to restart it; the other party does not.

**Unblocking preserves prior history.** On unblock, only the block record is deleted. Any prior `rejected` or `disconnected` records between the two users survive and continue to govern eligibility. This prevents a blocked-then-unblocked user from bypassing a rejection they received before the block. Both parties resume from the state they were in before the block was placed — not from a clean slate.

**Connection state visible from another user's profile** — from the perspective of viewer V looking at target T:

| State                      | Meaning                                                                                  | Actions available to V |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| `not_connected`            | No relationship; V meets eligibility criteria                                            | Send Request           |
| `ineligible`               | No relationship; V and T share no employer domain with overlapping tenure ranges         | None                   |
| `request_sent`             | V sent a pending request to T                                                            | Withdraw               |
| `request_received`         | T sent a pending request to V                                                            | Accept · Reject        |
| `connected`                | Both are connected colleagues                                                            | Disconnect · Block     |
| `i_rejected_their_request` | V rejected T's earlier request; T cannot re-request; V may now send a fresh request to T | Send Request · Block   |
| `they_rejected_my_request` | T rejected V's request; V cannot re-request T                                            | Block                  |
| `i_disconnected`           | V disconnected from T; V may re-request T; T may not request V                           | Send Request · Block   |
| `they_disconnected`        | T disconnected from V; T may re-request V; V may not request T                           | Block                  |
| `i_blocked_them`           | V has blocked T; T cannot interact with V                                                | Unblock                |
| `blocked_by_them`          | T has blocked V; V can view T's profile but cannot send a connection request             | None — indicator shown |

### Custom Error Codes

Each distinct error condition uses a unique HTTP status code so clients can handle each case programmatically without parsing the response body. Standard codes (`400`, `401`, `404`) are reserved for their standard meanings only. All connection-specific errors use codes from the unallocated 4xx range:

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 452  | Self-targeting — caller and target are the same account                                     |
| 453  | Ineligible — no shared employer domain with overlapping tenure ranges                       |
| 454  | State conflict — a pending, connected, or incompatible record already exists                |
| 455  | Requester barred — target previously rejected this requester; cannot re-request             |
| 456  | Requester barred by disconnect — target disconnected from this requester; cannot re-request |
| 457  | Blocked by caller — caller has blocked the target; unblock first to interact                |
| 458  | Already blocked — caller has already blocked this user                                      |
| 459  | Not blocked — attempted to unblock a user the caller has not blocked                        |
| 460  | Blocked by target — target has blocked the caller; caller cannot interact                   |

### Acceptance Criteria

- [ ] An authenticated HubUser (A) can send a connection request to active HubUser (B) identified by handle, provided both share a valid overlapping employer verification (condition 2 above); a `pending` record is created with 201
- [ ] `send-request` returns 404 if the handle does not match any active HubUser
- [ ] `send-request` returns 452 if A and B are the same user
- [ ] `send-request` returns 453 if A and B share no employer domain on which any of A's stints overlaps with any of B's stints
- [ ] `send-request` returns 457 if A has blocked B (A must unblock first)
- [ ] `send-request` returns 460 if B has blocked A
- [ ] `send-request` returns 454 if a pending or connected record already exists in either direction between A and B
- [ ] `send-request` returns 455 if B previously rejected A's request
- [ ] `send-request` returns 456 if B disconnected from A
- [ ] B rejecting A's request does **not** block B from later sending a fresh connection request to A (eligibility rules still apply)
- [ ] Recipient (B) can accept a pending incoming request from A → state becomes `connected`; `accept-request` returns 404 if no pending request from that handle exists (or handle is unknown)
- [ ] Recipient (B) can reject a pending incoming request from A → state becomes `rejected`; A cannot re-request B; `reject-request` returns 404 if no pending request from that handle exists
- [ ] Requester (A) can withdraw a pending outgoing request to B → record is deleted; either party may re-request (subject to eligibility); `withdraw-request` returns 404 if no pending outgoing request to that handle exists
- [ ] Either connected party can disconnect from the other → state becomes `disconnected`; disconnector may re-request later; the other party may not; `disconnect` returns 404 if no connected relationship with that handle exists
- [ ] `connections/list` returns a paginated list of the caller's connections (state = `connected`), sorted by `connected_at DESC`; keyset cursor encodes `(connected_at, handle)` to break ties; supports optional `filter_query` prefix search on handle and full name
- [ ] `connections/list-incoming-requests` returns paginated pending requests received by the caller, sorted by `created_at DESC`; keyset cursor encodes `(created_at, requester_handle)`
- [ ] `connections/list-outgoing-requests` returns paginated pending requests sent by the caller, sorted by `created_at DESC`; keyset cursor encodes `(created_at, recipient_handle)`
- [ ] `connections/get-status` returns an 11-value connection state enum for the relationship between caller and a given handle; returns `ineligible` when no overlapping employer domain exists and no prior record exists; returns `blocked_by_them` when target has blocked caller
- [ ] `connections/search` returns up to 20 connected users matching a name/handle prefix; no pagination; for endorsement-selection dropdowns
- [ ] HubUser (A) can block any other HubUser (B) by handle; a block record is created; any pending request in either direction is deleted; any active connection is severed; `connections/block` returns 201
- [ ] `connections/block` returns 404 if the handle does not match any active HubUser
- [ ] `connections/block` returns 452 if A and B are the same user
- [ ] `connections/block` returns 458 if A has already blocked B
- [ ] While B is blocked by A: `connections/get-status` returns `blocked_by_them` when B queries A; B can view A's full profile page and the connection widget displays "You have been blocked by this user" with no connection action rendered; if B attempts `connections/send-request` to A despite the UI block, the API returns 460
- [ ] While B is blocked by A: A cannot send a connection request to B (returns 457); A can view B's profile and sees `i_blocked_them` state with an Unblock action
- [ ] A can unblock B; only the block record is deleted; any prior `rejected` or `disconnected` records between A and B survive and continue to govern eligibility; `connections/unblock` returns 204
- [ ] `connections/unblock` returns 459 if A has not blocked the given handle
- [ ] `connections/list-blocked` returns a paginated list of users the caller has blocked, sorted by `blocked_at DESC`; keyset cursor encodes `(blocked_at, handle)`
- [ ] `connections/counts` returns `{ pending_incoming, pending_outgoing, connected, blocked }` as lightweight integer counts; used by the dashboard and navigation badges without fetching full lists
- [ ] Email notification sent to recipient when a new connection request arrives (existing outbox email pattern); no email on rejection (to avoid social awkwardness)
- [ ] Email notification sent to requester when their request is accepted
- [ ] Audit log written inside the same transaction for every state-changing operation (send, accept, reject, withdraw, disconnect, block, unblock)
- [ ] All endpoints require a valid HubUser session (HubAuth); no additional role beyond an active hub account

### User-Facing Screens

**Screen: My Connections**

Portal: hub-ui | Route: `/connections`

Header: Back to Dashboard button | "My Connections" h2 (left) | "Requests" button with pending-count badge (right)

<input type="search" placeholder="Search by name or handle" style="width:300px;margin-bottom:16px"/>

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr style="background:#f5f5f5">
      <th>Name</th>
      <th>Handle</th>
      <th>Connected Since</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Priya Sharma</td>
      <td>@priya-sharma</td>
      <td>12 Apr 2026</td>
      <td><a href="#">View Profile</a> &nbsp; <button>Disconnect</button></td>
    </tr>
    <tr>
      <td>Marco Rossi</td>
      <td>@marco-r</td>
      <td>3 Mar 2026</td>
      <td><a href="#">View Profile</a> &nbsp; <button>Disconnect</button></td>
    </tr>
  </tbody>
</table>

<p><em>Keyset pagination: &lt; Prev | Next &gt;</em></p>

"Disconnect" opens a confirmation dialog: _"Disconnect from {name}? You will be able to send them a new request later, but they will not be able to request you."_

Empty state: _"You have no connections yet. Your connections will appear here once you share a verified employer with someone and they accept your request."_

---

**Screen: Connection Requests**

Portal: hub-ui | Route: `/connections/requests`

Header: Back to My Connections button | "Connection Requests" h2

**Received** (incoming pending requests — accept or reject)

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:24px">
  <thead>
    <tr style="background:#f5f5f5">
      <th>Name</th>
      <th>Handle</th>
      <th>Sent On</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alex Kim</td>
      <td>@alex-kim</td>
      <td>1 May 2026</td>
      <td><button>Accept</button> &nbsp; <button>Reject</button></td>
    </tr>
  </tbody>
</table>

Accept and Reject act immediately with no confirmation dialog. After accept the row disappears from this list and the person appears in My Connections. After reject the row is removed silently.

**Sent** (outgoing pending requests — withdraw)

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr style="background:#f5f5f5">
      <th>Name</th>
      <th>Handle</th>
      <th>Sent On</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Sam Okonkwo</td>
      <td>@sam-ok</td>
      <td>28 Apr 2026</td>
      <td><button>Withdraw</button></td>
    </tr>
  </tbody>
</table>

Withdraw shows a brief confirmation: _"Withdraw your connection request to {name}? Either of you may request again later."_ After withdrawal the row is removed.

---

**Screen: Blocked Users**

Portal: hub-ui | Route: `/connections/blocked`

Header: Back to My Connections button | "Blocked Users" h2

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr style="background:#f5f5f5">
      <th>Name</th>
      <th>Handle</th>
      <th>Blocked On</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Jordan Lee</td>
      <td>@jordan-lee</td>
      <td>20 Apr 2026</td>
      <td><button>Unblock</button></td>
    </tr>
  </tbody>
</table>

<p><em>Keyset pagination: &lt; Prev | Next &gt;</em></p>

Unblock shows a brief confirmation: _"Unblock {name}? They will be able to find and interact with you again. Note: any prior rejection or disconnection between you will still apply."_ After unblock the row is removed.

Empty state: _"You have not blocked anyone."_

---

**Profile page connection widget** (rendered as part of the hub-profile spec, driven by `connections/get-status`)

The profile page shows a contextual action widget based on the returned `connection_state`:

<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
  <thead>
    <tr style="background:#f5f5f5">
      <th>connection_state</th>
      <th>Widget rendered</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>not_connected</code></td><td><button>Connect</button></td></tr>
    <tr><td><code>ineligible</code></td><td><em>(no button; no explanation shown publicly)</em></td></tr>
    <tr><td><code>request_sent</code></td><td>Request Sent &nbsp; <a href="#">Withdraw</a></td></tr>
    <tr><td><code>request_received</code></td><td><button>Accept</button> &nbsp; <button>Reject</button></td></tr>
    <tr><td><code>connected</code></td><td>✓ Connected &nbsp; <a href="#">Disconnect</a> &nbsp; <a href="#">Block</a></td></tr>
    <tr><td><code>i_rejected_their_request</code></td><td><button>Connect</button> &nbsp; <a href="#">Block</a></td></tr>
    <tr><td><code>they_rejected_my_request</code></td><td><a href="#">Block</a></td></tr>
    <tr><td><code>i_disconnected</code></td><td><button>Connect</button> &nbsp; <a href="#">Block</a></td></tr>
    <tr><td><code>they_disconnected</code></td><td><a href="#">Block</a></td></tr>
    <tr><td><code>i_blocked_them</code></td><td><button>Unblock</button></td></tr>
    <tr><td><code>blocked_by_them</code></td><td>🚫 You have been blocked by this user. <em>(no connection action available)</em></td></tr>
  </tbody>
</table>

### API Surface

All endpoints share the `/hub/connections/` namespace. Future request types (follows, mentions, etc.) will live under their own namespace and not conflict with these paths.

| Endpoint                                       | Portal | Who calls it | What it does                                                                                                                                               |
| ---------------------------------------------- | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /hub/connections/send-request`           | hub    | HubUser      | Sends a connection request to another HubUser by handle; validates shared employer eligibility                                                             |
| `POST /hub/connections/accept-request`         | hub    | HubUser      | Accepts a pending incoming request from the given requester handle → `connected`                                                                           |
| `POST /hub/connections/reject-request`         | hub    | HubUser      | Rejects a pending incoming request from the given requester handle → `rejected` (terminal for requester)                                                   |
| `POST /hub/connections/withdraw-request`       | hub    | HubUser      | Withdraws a pending outgoing request to the given recipient handle; record deleted                                                                         |
| `POST /hub/connections/disconnect`             | hub    | HubUser      | Disconnects from a connected user by handle → `disconnected`; disconnector may re-request; other party may not                                             |
| `POST /hub/connections/list`                   | hub    | HubUser      | Paginated list of the caller's connections, sorted `connected_at DESC`; keyset cursor on `(connected_at, handle)`; optional `filter_query` prefix search   |
| `POST /hub/connections/list-incoming-requests` | hub    | HubUser      | Paginated list of pending incoming requests, sorted `created_at DESC`; keyset cursor on `(created_at, requester_handle)`                                   |
| `POST /hub/connections/list-outgoing-requests` | hub    | HubUser      | Paginated list of pending outgoing requests, sorted `created_at DESC`; keyset cursor on `(created_at, recipient_handle)`                                   |
| `POST /hub/connections/get-status`             | hub    | HubUser      | Returns an 11-value `connection_state` enum for the relationship between caller and a given handle; returns `blocked_by_them` if target has blocked caller |
| `POST /hub/connections/search`                 | hub    | HubUser      | Returns up to 20 connected users matching a name/handle prefix; no pagination; for endorsement-selection dropdowns                                         |
| `POST /hub/connections/block`                  | hub    | HubUser      | Blocks a user by handle; cancels any pending request in either direction, severs any active connection; prior rejection/disconnection history is preserved |
| `POST /hub/connections/unblock`                | hub    | HubUser      | Unblocks a previously blocked user; deletes only the block record — prior rejection and disconnection history is preserved                                 |
| `POST /hub/connections/list-blocked`           | hub    | HubUser      | Paginated list of users the caller has blocked, sorted `blocked_at DESC`; keyset cursor on `(blocked_at, handle)`                                          |
| `GET /hub/connections/counts`                  | hub    | HubUser      | Returns `{ pending_incoming, pending_outgoing, connected, blocked }` integer counts; parameterless; used for badge display without fetching full lists     |

All endpoints require `HubAuth`. No additional role beyond an active hub account.

`connections/search` is intentionally narrow (max 20, prefix-only, connected users only) so it stays fast for autocomplete use. For the full paginated list use `connections/list`.

---

## Stage 2: Implementation Plan

Status: READY-FOR-IMPLEMENTATION (depends on hub-employer-ids and hub-profile being implemented first)
Authors: @psankar

### API Contract

TypeSpec definitions in `specs/typespec/hub/connections.tsp` with matching `.ts` and `.go` files.

```typespec
// specs/typespec/hub/connections.tsp
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ConnectionState {
  NotConnected:           "not_connected",
  Ineligible:             "ineligible",
  RequestSent:            "request_sent",
  RequestReceived:        "request_received",
  Connected:              "connected",
  IRejectedTheirRequest:  "i_rejected_their_request",
  TheyRejectedMyRequest:  "they_rejected_my_request",
  IDisconnected:          "i_disconnected",
  TheyDisconnected:       "they_disconnected",
  IBlockedThem:           "i_blocked_them",
  BlockedByThem:          "blocked_by_them",
}

// All write payloads identify the counterparty by handle.
model HandleRequest          { handle: Handle; }
model HandleAndNoteRequest   { handle: Handle; rejection_note?: string; }   // currently unused; reserved for future per-spec needs
model GetStatusRequest       { handle: Handle; }
model GetStatusResponse      { connection_state: ConnectionState; }

model Connection {
  handle:        Handle;
  display_name:  string;          // localised to caller's preferred language; falls back to user's preferred entry
  short_bio?:    string;
  has_profile_picture: boolean;
  profile_picture_url?: string;   // populated as `/hub/profile-picture/{handle}` when the user has a picture
  connected_at:  utcDateTime;
}

model PendingRequest {
  handle:        Handle;
  display_name:  string;
  short_bio?:    string;
  has_profile_picture: boolean;
  profile_picture_url?: string;
  created_at:    utcDateTime;
}

model BlockedUser {
  handle:        Handle;
  display_name:  string;
  blocked_at:    utcDateTime;
}

model ListConnectionsRequest {
  filter_query?:    string;      // prefix on handle or full_name
  pagination_key?:  string;
  limit?:           int32;
}
model ListConnectionsResponse {
  connections:           Connection[];
  next_pagination_key?:  string;
}

model ListPendingRequestsRequest {
  pagination_key?: string;
  limit?:          int32;
}
model ListIncomingRequestsResponse { incoming: PendingRequest[]; next_pagination_key?: string; }
model ListOutgoingRequestsResponse { outgoing: PendingRequest[]; next_pagination_key?: string; }

model ListBlockedRequest  { pagination_key?: string; limit?: int32; }
model ListBlockedResponse { blocked: BlockedUser[]; next_pagination_key?: string; }

model SearchConnectionsRequest  { query: string; }
model SearchConnectionsResponse { results: Connection[]; }   // capped at 20

model ConnectionCounts {
  pending_incoming: int32;
  pending_outgoing: int32;
  connected:        int32;
  blocked:          int32;
}

@route("/hub/connections/send-request")           @post sendRequest          (...HandleRequest):                CreatedResponse<{}> | BadRequestResponse | NotFoundResponse | { @statusCode statusCode: 452 } | { @statusCode statusCode: 453 } | { @statusCode statusCode: 454 } | { @statusCode statusCode: 455 } | { @statusCode statusCode: 456 } | { @statusCode statusCode: 457 } | { @statusCode statusCode: 460 };
@route("/hub/connections/accept-request")         @post acceptRequest        (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/reject-request")         @post rejectRequest        (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/withdraw-request")       @post withdrawRequest      (...HandleRequest):                NoContentResponse   | NotFoundResponse;
@route("/hub/connections/disconnect")             @post disconnect           (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/list")                   @post listConnections      (...ListConnectionsRequest):       OkResponse<ListConnectionsResponse>      | BadRequestResponse;
@route("/hub/connections/list-incoming-requests") @post listIncoming         (...ListPendingRequestsRequest):   OkResponse<ListIncomingRequestsResponse> | BadRequestResponse;
@route("/hub/connections/list-outgoing-requests") @post listOutgoing         (...ListPendingRequestsRequest):   OkResponse<ListOutgoingRequestsResponse> | BadRequestResponse;
@route("/hub/connections/get-status")             @post getStatus            (...GetStatusRequest):             OkResponse<GetStatusResponse>            | BadRequestResponse;
@route("/hub/connections/search")                 @post search               (...SearchConnectionsRequest):     OkResponse<SearchConnectionsResponse>    | BadRequestResponse;
@route("/hub/connections/block")                  @post blockUser            (...HandleRequest):                CreatedResponse<{}> | NotFoundResponse | { @statusCode statusCode: 452 } | { @statusCode statusCode: 458 };
@route("/hub/connections/unblock")                @post unblockUser          (...HandleRequest):                NoContentResponse   | { @statusCode statusCode: 459 };
@route("/hub/connections/list-blocked")           @post listBlocked          (...ListBlockedRequest):           OkResponse<ListBlockedResponse>          | BadRequestResponse;
@route("/hub/connections/counts")                 @get  counts                ():                                OkResponse<ConnectionCounts>;
```

The matching `.ts` and `.go` exports validators (`validateHandleRequest`, `validateListConnectionsRequest`, `validateSearchConnectionsRequest`, etc.) and the `ConnectionState` enum.

### Database Schema

Edits to `api-server/db/migrations/regional/00000000000001_initial_schema.sql`. No global-DB changes — connection records live entirely in the caller's regional DB. Cross-region peers are addressed by the global routing tables already in place; the eligibility check (overlapping verified stints from hub-employer-ids) operates intra-region for both A and B because two HubUsers can only have shared verified stints if they have at least one common region somewhere — but in our deployment a HubUser's stints live only in the user's home region. The handler therefore performs the cross-region overlap check via two regional reads (caller-region + target-region). See "Cross-region eligibility" below.

```sql
CREATE TYPE hub_connection_status AS ENUM (
  'pending',          -- A→B request awaiting B's action
  'connected',        -- bilateral, active
  'rejected',         -- B previously rejected A
  'disconnected'      -- one side ended a previously connected pair
);

CREATE TABLE hub_connections (
  connection_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical pair: (low, high) ordered by hub_user_global_id to make uniqueness easy.
  low_user_id          UUID NOT NULL,
  high_user_id         UUID NOT NULL,
  status               hub_connection_status NOT NULL,
  -- Asymmetry book-keeping:
  requester_user_id    UUID,        -- which side initiated the most recent state-changing event
  rejecter_user_id     UUID,        -- non-null when status='rejected'; the user who rejected
  disconnector_user_id UUID,        -- non-null when status='disconnected'; the user who ended the connection
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at         TIMESTAMPTZ,    -- set on transition into 'connected'
  CHECK (low_user_id < high_user_id)
);

-- One canonical row per pair.
CREATE UNIQUE INDEX uq_hub_connections_pair ON hub_connections (low_user_id, high_user_id);

CREATE INDEX idx_hub_connections_low_status   ON hub_connections (low_user_id,  status, connected_at DESC);
CREATE INDEX idx_hub_connections_high_status  ON hub_connections (high_user_id, status, connected_at DESC);
CREATE INDEX idx_hub_connections_requester    ON hub_connections (requester_user_id, status);

CREATE TABLE hub_blocks (
  blocker_user_id  UUID NOT NULL,
  blocked_user_id  UUID NOT NULL,
  blocked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);

CREATE INDEX idx_hub_blocks_blocked ON hub_blocks (blocked_user_id);
```

`hub_connections` rows survive disconnect/reject as the durable history that gates re-requests. Withdraw of a pending request DELETEs the row (no history is kept — request never landed).

`hub_blocks` is intentionally a separate table so block state overrides connection state cleanly. A block is one-way; the corresponding connection row, if any, is updated to `disconnected` (with `disconnector_user_id = blocker`) inside the same tx.

#### sqlc queries (`api-server/db/regional/queries/hub_connections.sql`)

```sql
-- name: GetConnectionPair :one
SELECT * FROM hub_connections
WHERE low_user_id = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid);

-- name: GetBlockOneWay :one
SELECT * FROM hub_blocks
WHERE blocker_user_id = @blocker AND blocked_user_id = @blocked;

-- name: InsertPendingConnection :one
INSERT INTO hub_connections (low_user_id, high_user_id, status, requester_user_id)
VALUES (LEAST(@requester::uuid, @recipient::uuid), GREATEST(@requester::uuid, @recipient::uuid),
        'pending', @requester)
RETURNING *;

-- name: AcceptPendingConnection :one
UPDATE hub_connections
SET status              = 'connected',
    connected_at        = NOW(),
    updated_at          = NOW()
WHERE low_user_id  = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid)
  AND status = 'pending'
  AND requester_user_id <> @actor    -- recipient is the actor (not the requester)
RETURNING *;

-- name: RejectPendingConnection :one
UPDATE hub_connections
SET status            = 'rejected',
    rejecter_user_id  = @actor,
    updated_at        = NOW()
WHERE low_user_id  = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid)
  AND status = 'pending'
  AND requester_user_id <> @actor
RETURNING *;

-- name: WithdrawPendingConnection :exec
DELETE FROM hub_connections
WHERE low_user_id  = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid)
  AND status = 'pending'
  AND requester_user_id = @actor;

-- name: DisconnectConnection :one
UPDATE hub_connections
SET status               = 'disconnected',
    disconnector_user_id = @actor,
    updated_at           = NOW()
WHERE low_user_id  = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid)
  AND status = 'connected'
RETURNING *;

-- name: InsertBlock :one
INSERT INTO hub_blocks (blocker_user_id, blocked_user_id)
VALUES (@blocker, @blocked)
ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
RETURNING *;

-- name: DeleteBlock :execrows
DELETE FROM hub_blocks WHERE blocker_user_id = @blocker AND blocked_user_id = @blocked;

-- name: SeverConnectionForBlock :exec
-- On block: any pending request between the two is deleted; any active connection becomes disconnected.
WITH pair AS (
  SELECT LEAST(@a::uuid, @b::uuid) AS lo, GREATEST(@a::uuid, @b::uuid) AS hi
)
UPDATE hub_connections SET
  status               = 'disconnected',
  disconnector_user_id = @blocker,
  updated_at           = NOW()
FROM pair
WHERE low_user_id = pair.lo AND high_user_id = pair.hi AND status = 'connected';

-- name: DeletePendingForBlock :exec
DELETE FROM hub_connections
WHERE low_user_id  = LEAST(@a::uuid, @b::uuid)
  AND high_user_id = GREATEST(@a::uuid, @b::uuid)
  AND status = 'pending';

-- name: ListMyConnections :many
SELECT c.*,
       CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END AS peer_user_id
FROM hub_connections c
WHERE (c.low_user_id = @me OR c.high_user_id = @me)
  AND c.status = 'connected'
  AND (sqlc.narg('filter_query')::text IS NULL OR EXISTS (
    SELECT 1 FROM hub_users u
    WHERE u.hub_user_global_id = (CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END)
      AND u.handle ILIKE sqlc.narg('filter_query')::text || '%'
  ))
  AND (@cursor_connected_at::timestamptz IS NULL OR
       (c.connected_at, peer_user_id) < (@cursor_connected_at, @cursor_peer_user_id))
ORDER BY c.connected_at DESC, peer_user_id DESC
LIMIT @limit_count;

-- name: ListIncomingPendingRequests :many
SELECT c.*, c.requester_user_id AS peer_user_id
FROM hub_connections c
WHERE c.status = 'pending'
  AND (CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END) = c.requester_user_id
  AND (c.low_user_id = @me OR c.high_user_id = @me)
  AND c.requester_user_id <> @me
  AND (@cursor_created_at::timestamptz IS NULL OR
       (c.created_at, c.requester_user_id) < (@cursor_created_at, @cursor_peer_user_id))
ORDER BY c.created_at DESC, c.requester_user_id DESC
LIMIT @limit_count;

-- name: ListOutgoingPendingRequests :many
SELECT c.*, (CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END) AS peer_user_id
FROM hub_connections c
WHERE c.status = 'pending'
  AND c.requester_user_id = @me
  AND (c.low_user_id = @me OR c.high_user_id = @me)
  AND (@cursor_created_at::timestamptz IS NULL OR
       (c.created_at, peer_user_id) < (@cursor_created_at, @cursor_peer_user_id))
ORDER BY c.created_at DESC, peer_user_id DESC
LIMIT @limit_count;

-- name: ListBlocked :many
SELECT b.*
FROM hub_blocks b
WHERE b.blocker_user_id = @me
  AND (@cursor_blocked_at::timestamptz IS NULL OR
       (b.blocked_at, b.blocked_user_id) < (@cursor_blocked_at, @cursor_blocked_user_id))
ORDER BY b.blocked_at DESC, b.blocked_user_id DESC
LIMIT @limit_count;

-- name: SearchConnectedByPrefix :many
SELECT c.*, (CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END) AS peer_user_id
FROM hub_connections c
JOIN hub_users u ON u.hub_user_global_id = (CASE WHEN c.low_user_id = @me THEN c.high_user_id ELSE c.low_user_id END)
WHERE (c.low_user_id = @me OR c.high_user_id = @me)
  AND c.status = 'connected'
  AND (u.handle ILIKE @prefix || '%')
ORDER BY u.handle ASC
LIMIT 20;

-- name: GetCounts :one
SELECT
  (SELECT COUNT(*) FROM hub_connections c
     WHERE c.status = 'pending'
       AND (c.low_user_id = @me OR c.high_user_id = @me)
       AND c.requester_user_id <> @me) AS pending_incoming,
  (SELECT COUNT(*) FROM hub_connections c
     WHERE c.status = 'pending'
       AND c.requester_user_id = @me) AS pending_outgoing,
  (SELECT COUNT(*) FROM hub_connections c
     WHERE c.status = 'connected'
       AND (c.low_user_id = @me OR c.high_user_id = @me)) AS connected,
  (SELECT COUNT(*) FROM hub_blocks WHERE blocker_user_id = @me) AS blocked;
```

#### Eligibility query (cross-region)

The eligibility test (Stage 1 § "Eligibility — A may send a request to B") joins hub-employer-ids stints across two regions. The handler runs **one** query per region:

- In caller's region: list A's stints — `(domain, first_verified_at, last_verified_at)` for `status IN ('active','ended')`.
- In target's region (after a global lookup of target's home region): list B's stints similarly.
- Compute the overlap in handler code: for each (A_stint, B_stint) on the same domain, check `[A.first_verified_at, A.last_verified_at] ∩ [B.first_verified_at, B.last_verified_at] ≠ ∅`. (Use `ended_at` if `status='ended'` else `last_verified_at`; both are present in the row.)

This is bounded — each user has ≤ 50 stints. The cross product is ≤ 2500 comparisons; trivial. No SQL JOIN across regions is required.

### Backend

#### Endpoint registration

`api-server/internal/routes/hub-routes.go`:

```go
mux.Handle("POST /hub/connections/send-request",           hubAuth(http.HandlerFunc(hub.SendConnectionRequest    (s))))
mux.Handle("POST /hub/connections/accept-request",         hubAuth(http.HandlerFunc(hub.AcceptConnectionRequest  (s))))
mux.Handle("POST /hub/connections/reject-request",         hubAuth(http.HandlerFunc(hub.RejectConnectionRequest  (s))))
mux.Handle("POST /hub/connections/withdraw-request",       hubAuth(http.HandlerFunc(hub.WithdrawConnectionRequest(s))))
mux.Handle("POST /hub/connections/disconnect",             hubAuth(http.HandlerFunc(hub.DisconnectConnection     (s))))
mux.Handle("POST /hub/connections/list",                   hubAuth(http.HandlerFunc(hub.ListConnections          (s))))
mux.Handle("POST /hub/connections/list-incoming-requests", hubAuth(http.HandlerFunc(hub.ListIncomingRequests     (s))))
mux.Handle("POST /hub/connections/list-outgoing-requests", hubAuth(http.HandlerFunc(hub.ListOutgoingRequests     (s))))
mux.Handle("POST /hub/connections/get-status",             hubAuth(http.HandlerFunc(hub.GetConnectionStatus      (s))))
mux.Handle("POST /hub/connections/search",                 hubAuth(http.HandlerFunc(hub.SearchConnections        (s))))
mux.Handle("POST /hub/connections/block",                  hubAuth(http.HandlerFunc(hub.BlockHubUser             (s))))
mux.Handle("POST /hub/connections/unblock",                hubAuth(http.HandlerFunc(hub.UnblockHubUser           (s))))
mux.Handle("POST /hub/connections/list-blocked",           hubAuth(http.HandlerFunc(hub.ListBlocked              (s))))
mux.Handle("GET  /hub/connections/counts",                 hubAuth(http.HandlerFunc(hub.GetConnectionCounts      (s))))
```

#### Handler step lists (`api-server/handlers/hub/connections.go`)

- **SendConnectionRequest**:
  1. Decode + validate handle.
  2. Resolve target via global DB: `GetHubUserGlobalIDAndRegionByHandle(handle)`. 404 if unknown / inactive.
  3. If target == caller → 452.
  4. Cross-DB block check: `GetBlockOneWay(caller, target)` and `GetBlockOneWay(target, caller)` against caller's regional DB AND target's regional DB. (Block records live in the blocker's region.) → 457 if caller blocks target, 460 if target blocks caller.
  5. Eligibility (cross-region stints): list caller's stints in caller's region; list target's stints in target's region; compute overlap. If empty → 453.
  6. State precondition check: `GetConnectionPair(caller, target)` in caller's region. If row exists:
     - `pending` → 454
     - `connected` → 454
     - `rejected` AND `requester_user_id = caller` → 455
     - `rejected` AND `requester_user_id = target` → eligible (B previously rejected A; B now sending fresh request); the caller is B in this case so we're fine. Allow.
     - `disconnected` AND `disconnector_user_id = target` → 456
     - `disconnected` AND `disconnector_user_id = caller` → eligible (caller disconnected, may re-request). Allow.
  7. Write: regional tx in caller's region:
     a. If a row exists with `status IN ('rejected','disconnected')` and the precondition above allowed re-request, DELETE that row first (we collapse history that no longer applies). Otherwise leave.
     b. `InsertPendingConnection(requester=caller, recipient=target)`.
     c. Audit `hub.send_connection_request` with `event_data = {peer_user_id_hash}`.
     d. Enqueue outbox email to recipient (existing email pattern).
  8. Return 201.

- **AcceptConnectionRequest**:
  1. Resolve handle → target. 404 if unknown.
  2. Regional tx (caller's region — note: writes to canonical pair regardless of which region target lives in; same row across both because we store one canonical row per pair? No — we store one row in each region's database where one of the parties lives. Ordering: see "Pair storage" below).
  3. `AcceptPendingConnection(actor=caller, peer=target)` — only succeeds when `status='pending'` and `requester != caller`. If 0 rows → 404 (no incoming pending request from that handle).
  4. Audit `hub.accept_connection_request`. Enqueue email to original requester.
  5. Return 200.

- **RejectConnectionRequest**: similar to accept; calls `RejectPendingConnection`. No email on rejection (per Stage 1).

- **WithdrawConnectionRequest**: `WithdrawPendingConnection(actor=caller, peer=target)`. If 0 rows → 404. Audit `hub.withdraw_connection_request`. Return 204.

- **DisconnectConnection**: `DisconnectConnection(actor=caller, peer=target)`. If 0 rows → 404. Audit `hub.disconnect_connection`. Return 200.

- **BlockHubUser**:
  1. Resolve target. 404 / 452.
  2. Regional tx in caller's region: `InsertBlock`. If conflict (already blocked) → 458.
  3. `DeletePendingForBlock` and `SeverConnectionForBlock` to scrub state.
  4. Audit `hub.block_hub_user`.
  5. Return 201.

- **UnblockHubUser**: regional tx → `DeleteBlock`. `execrows == 0` → 459. Audit `hub.unblock_hub_user`. Return 204.

- **ListConnections / ListIncoming / ListOutgoing / ListBlocked**: read-only. Decode keyset cursor. Run the corresponding sqlc query. Bulk-resolve peer profile data via global + regional reads (one global query for `hub_user_display_names` for all peer ids; one regional query in caller's region for `hub_users(short_bio, handle, profile_picture_storage_key)` for any peer in caller's region; one global lookup of peer→region for those NOT in caller's region; one extra regional read per other-region peer batch). Cap aggregate; for the canonical case (caller's region == peer's region) only one global + one regional read.

- **GetConnectionStatus**: returns the 11-value enum. Algorithm:
  1. Resolve target. If unknown → 404 (but Stage 1 says: state still derivable; for safety we return 200 with `not_connected` for unknown/inactive targets to avoid handle-enumeration via this endpoint? — but Stage 1 acceptance criteria says `connections/get-status` returns `ineligible`/etc. for known handles; for unknown it's 404 to be consistent with `send-request`. Use 404 for unknown.) Verify: Stage 1 doesn't explicitly cover unknown handle in get-status. Adopt 404 for unknown to be consistent across the spec.
  2. Block check (caller→target, target→caller). If caller blocked target → `i_blocked_them`. If target blocked caller → `blocked_by_them`.
  3. `GetConnectionPair(caller, target)` in caller's region:
     - row not present → eligibility check → `not_connected` if eligible, else `ineligible`.
     - `pending` AND requester=caller → `request_sent`.
     - `pending` AND requester=target → `request_received`.
     - `connected` → `connected`.
     - `rejected` AND rejecter=caller → `i_rejected_their_request`.
     - `rejected` AND rejecter=target → `they_rejected_my_request`.
     - `disconnected` AND disconnector=caller → `i_disconnected`.
     - `disconnected` AND disconnector=target → `they_disconnected`.
  4. Return 200 + enum.

- **SearchConnections**: validate `query` (1..32 chars). Run `SearchConnectedByPrefix(me=caller, prefix=query)` — capped at 20 in SQL. Bulk-resolve display data. Return.

- **GetConnectionCounts**: single regional read (`GetCounts`). Return 200.

#### Pair storage in cross-region setup

A connection pair (A, B) where A is in region IND1 and B is in region USA1 lives in **A's home region only** (the region that records the action — see #note below). All subsequent reads/writes against the pair go to that region. This is sound because:

- `send-request` is initiated by A → row created in A's region.
- `accept-request` is initiated by B but B's handler resolves target (=A) and locates the existing pending pair in A's region by performing the WithRegionalTx against `s.GetRegionalDB(A.region)`. (We write the canonical row in the caller-of-send-request's region; subsequent actors must look there too.)
- The handler for any pair-mutating endpoint first reads the global routing table to find which side initially recorded the pair (we store this metadata as part of the global mirror — see below).

**Global mirror table** to resolve which region holds a pair's row:

```sql
-- Global DB
CREATE TABLE hub_connection_pair_routes (
  low_user_id   UUID NOT NULL,
  high_user_id  UUID NOT NULL,
  region        TEXT NOT NULL,                   -- region whose regional DB stores the canonical row
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (low_user_id, high_user_id),
  CHECK (low_user_id < high_user_id)
);
```

`InsertPendingConnection` is therefore a cross-DB write: regional INSERT + global INSERT into `hub_connection_pair_routes`. Pattern: global first (`INSERT … ON CONFLICT DO NOTHING`), then regional. On regional failure, compensate by deleting the global row (only if it was inserted by the failed call — handled by checking `RETURNING` from the global INSERT). On withdraw, delete both regional row and global mirror.

Same pattern for `hub_blocks`: a block lives in the blocker's region; a global mirror `hub_block_routes (blocker_user_id PK, blocked_user_id PK, region)` lets a handler executing in the blocked party's region see "I'm blocked by user X in region Y" without scanning all regions.

```sql
CREATE TABLE hub_block_routes (
  blocker_user_id UUID NOT NULL,
  blocked_user_id UUID NOT NULL,
  region          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);
```

For block check at `send-request` time: read `hub_block_routes WHERE (blocker, blocked) IN ((caller, target), (target, caller))` — single global query — then short-circuit without touching regional DBs.

#### Audit Log Events

| event_type                        | when                     | actor_user_id | event_data keys                     |
| --------------------------------- | ------------------------ | ------------- | ----------------------------------- |
| `hub.send_connection_request`     | send-request success     | calling user  | `peer_user_id_hash`                 |
| `hub.accept_connection_request`   | accept-request success   | calling user  | `peer_user_id_hash`, `connected_at` |
| `hub.reject_connection_request`   | reject-request success   | calling user  | `peer_user_id_hash`                 |
| `hub.withdraw_connection_request` | withdraw-request success | calling user  | `peer_user_id_hash`                 |
| `hub.disconnect_connection`       | disconnect success       | calling user  | `peer_user_id_hash`                 |
| `hub.block_hub_user`              | block success            | calling user  | `peer_user_id_hash`                 |
| `hub.unblock_hub_user`            | unblock success          | calling user  | `peer_user_id_hash`                 |

`peer_user_id_hash` = SHA-256 of the peer's `hub_user_global_id` to keep audit logs free of raw identifiers. All entries land in the regional `audit_logs` of the actor's region (matching the standard pattern).

### Frontend

#### New Routes

| Portal | Route path              | Page component                                     |
| ------ | ----------------------- | -------------------------------------------------- |
| hub-ui | `/connections`          | `src/pages/Connections/ConnectionsListPage.tsx`    |
| hub-ui | `/connections/requests` | `src/pages/Connections/ConnectionRequestsPage.tsx` |
| hub-ui | `/connections/blocked`  | `src/pages/Connections/BlockedUsersPage.tsx`       |

The Connect-button widget on `/u/:handle` is rendered by hub-profile (the `PublicProfilePage`). The widget calls `connections/get-status` and renders the table from Stage 1 § "Profile page connection widget".

Implementation notes:

- Standard feature page layout. `<Spin>` wrap on every async action.
- "Disconnect" / "Withdraw" / "Block" / "Unblock" all use `Popconfirm` with the explicit copy from Stage 1 (asymmetry warnings). "Accept" / "Reject" act immediately with no confirmation.
- Pending-count badges in nav drawer / dashboard tile pull from `connections/counts`.
- Profile picture rendering: `/hub/profile-picture/{handle}` URL.

### RBAC

No new roles. All endpoints require `HubAuth` plus an active session — no additional role.

Per CLAUDE.md "RBAC Test Policy", since there are no role-protected endpoints in this feature, the test matrix below has only authentication tests (401), not role tests (403).

### i18n

Add `hub-ui/src/locales/{en-US,de-DE,ta-IN}/connections.json`:

```json
{
	"myConnections": {
		"title": "My Connections",
		"backToDashboard": "Back to Dashboard",
		"search": "Search by name or handle",
		"requests": "Requests",
		"blocked": "Blocked",
		"table": {
			"name": "Name",
			"handle": "Handle",
			"connectedSince": "Connected Since",
			"actions": "Actions",
			"viewProfile": "View Profile",
			"disconnect": "Disconnect"
		},
		"disconnectConfirm": "Disconnect from {{name}}? You will be able to send them a new request later, but they will not be able to request you.",
		"empty": "You have no connections yet. Your connections will appear here once you share a verified employer with someone and they accept your request."
	},
	"requests": {
		"title": "Connection Requests",
		"backToConnections": "Back to My Connections",
		"received": "Received",
		"sent": "Sent",
		"table": {
			"name": "Name",
			"handle": "Handle",
			"sentOn": "Sent On",
			"actions": "Actions",
			"accept": "Accept",
			"reject": "Reject",
			"withdraw": "Withdraw"
		},
		"withdrawConfirm": "Withdraw your connection request to {{name}}? Either of you may request again later."
	},
	"blocked": {
		"title": "Blocked Users",
		"backToConnections": "Back to My Connections",
		"table": {
			"name": "Name",
			"handle": "Handle",
			"blockedOn": "Blocked On",
			"actions": "Actions",
			"unblock": "Unblock"
		},
		"unblockConfirm": "Unblock {{name}}? They will be able to find and interact with you again. Note: any prior rejection or disconnection between you will still apply.",
		"empty": "You have not blocked anyone."
	},
	"widget": {
		"connect": "Connect",
		"requestSent": "Request Sent",
		"withdraw": "Withdraw",
		"accept": "Accept",
		"reject": "Reject",
		"connected": "Connected",
		"disconnect": "Disconnect",
		"block": "Block",
		"unblock": "Unblock",
		"blockedByThem": "You have been blocked by this user."
	},
	"errors": {
		"ineligible": "You can only connect with people you've worked with.",
		"alreadyExists": "A connection or request already exists.",
		"rejectedByThem": "This user previously declined your request.",
		"disconnectedByThem": "This user previously disconnected from you.",
		"blockedByYou": "Unblock this user to interact.",
		"blockedByThem": "This user has blocked you."
	}
}
```

Mirror in `de-DE` and `ta-IN` with English placeholders.

### Test Matrix

Tests in `playwright/tests/api/hub/connections.spec.ts`. Types from `vetchium-specs/hub/connections`.

Helpers to add to `playwright/lib/db.ts`:

- `createTestConnectionPairDirect(a, b, status, requester?, rejecter?, disconnector?)` — bypass API, write directly to `hub_connections` and the global mirror.
- `createTestBlockDirect(blocker, blocked)` — bypass API, write to `hub_blocks` and global mirror.
- `createTestStintDirect(hubUserId, email, domain, firstVerifiedAt, lastVerifiedAt, status='active')` — bypass hub-employer-ids API.

Helpers to add to `playwright/lib/hub-api-client.ts`: typed + Raw methods for all 14 endpoints.

#### Endpoint scenarios

| Endpoint               | Scenario                                                   | Expected                                                                          |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| send-request           | Both share an overlapping stint; first request             | 201                                                                               |
| send-request           | Self                                                       | 452                                                                               |
| send-request           | Unknown handle                                             | 404                                                                               |
| send-request           | Caller blocked target                                      | 457                                                                               |
| send-request           | Target blocked caller                                      | 460                                                                               |
| send-request           | No shared employer-domain stint                            | 453                                                                               |
| send-request           | Shared domain but tenure ranges don't overlap              | 453                                                                               |
| send-request           | Existing pending in either direction                       | 454                                                                               |
| send-request           | Existing connected                                         | 454                                                                               |
| send-request           | Target previously rejected caller                          | 455                                                                               |
| send-request           | Target previously disconnected from caller                 | 456                                                                               |
| send-request           | Caller previously rejected target → caller may now request | 201 (collapses prior rejected row)                                                |
| send-request           | Caller previously disconnected → caller may now request    | 201                                                                               |
| send-request           | Cross-region                                               | 201; pair stored in caller's region; mirror in global                             |
| send-request           | Audit row written; outbox email row enqueued               | 1 audit + 1 email row                                                             |
| accept-request         | Pending incoming exists                                    | 200; pair status='connected'; connected_at set; email enqueued                    |
| accept-request         | No pending incoming                                        | 404                                                                               |
| accept-request         | Caller is the original requester                           | 404                                                                               |
| reject-request         | Pending incoming exists                                    | 200; pair status='rejected'; rejecter=caller                                      |
| reject-request         | No pending incoming                                        | 404                                                                               |
| reject-request         | After reject, target sending fresh request to caller       | 201 (B may still send to A)                                                       |
| withdraw-request       | Pending outgoing exists                                    | 204; row deleted                                                                  |
| withdraw-request       | No pending outgoing                                        | 404                                                                               |
| disconnect             | Connected pair                                             | 200; pair status='disconnected'; disconnector=caller                              |
| disconnect             | Other party may not re-request                             | 456                                                                               |
| disconnect             | Caller (disconnector) may re-request                       | 201                                                                               |
| list                   | Sorted by connected_at DESC                                | 200                                                                               |
| list                   | filter_query prefix on handle                              | 200; filtered                                                                     |
| list                   | Pagination — second page                                   | 200; cursor encodes (connected_at, peer_user_id)                                  |
| list-incoming-requests | Pending incoming returned                                  | 200                                                                               |
| list-incoming-requests | Outgoing not returned                                      | 200; doesn't include them                                                         |
| list-outgoing-requests | Pending outgoing returned                                  | 200                                                                               |
| get-status             | All 11 states (one test per state)                         | 200; correct enum value                                                           |
| get-status             | Unknown handle                                             | 404                                                                               |
| get-status             | Block dominates connection state                           | 200; `i_blocked_them` even if row also indicates `connected` (block severs first) |
| search                 | Returns up to 20 connected matching prefix                 | 200                                                                               |
| search                 | Empty prefix                                               | 400                                                                               |
| block                  | Pending in either direction is deleted                     | 201; pending row gone                                                             |
| block                  | Active connection severed                                  | 201; status='disconnected', disconnector=blocker                                  |
| block                  | Caller already blocked target                              | 458                                                                               |
| block                  | Self                                                       | 452                                                                               |
| block                  | Unknown handle                                             | 404                                                                               |
| unblock                | Success                                                    | 204                                                                               |
| unblock                | Caller has not blocked target                              | 459                                                                               |
| unblock                | After unblock, prior `rejected` survives                   | 200/get-status returns the rejected state                                         |
| unblock                | After unblock, prior `disconnected` survives               | get-status returns disconnected state                                             |
| list-blocked           | Sorted by blocked_at DESC                                  | 200                                                                               |
| list-blocked           | Pagination                                                 | 200                                                                               |
| counts                 | All four counters correct for a fixture user               | 200                                                                               |
| (any)                  | Unauthenticated                                            | 401                                                                               |
| (any) write            | No audit on 4xx                                            | counts unchanged                                                                  |

Cross-region scenarios: build fixtures with users in two different regions (helpers exist in `playwright/lib/db.ts` to create users in any region) and assert that send-request, accept-request, get-status, and counts all work across the region boundary.

### Out-of-spec dependencies (already drafted)

- **hub-employer-ids** (`specs/hub-employer-ids/README.md`) — supplies the verified-tenure stints used by the eligibility query.
- **hub-profile** (`specs/hub-profile/README.md`) — owns the profile page that hosts the connect-button widget.

This Stage 2 ships everything implementation needs for hub-connections: TypeSpec, regional + global schema, sqlc queries, handler step lists, route registration, frontend route map, i18n, and a complete test matrix. Implementation depends on hub-employer-ids and hub-profile being implemented first; the eligibility join in `send-request` requires the `hub_employer_stints` table created in hub-employer-ids.
