## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: hub-employer-ids (verified official-email associations with multi-stint support — must be implemented before hub-connections), hub-profile (profile search / people-you-may-know — discovery of handles to connect with; the Connect button lives on profile pages surfaced by that feature)
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

> **Do not fill this section until Stage 1 status is APPROVED.**

Status: DRAFT
Authors: @

### API Contract

TypeSpec definitions in `specs/typespec/{portal}/{feature}.tsp` with matching `.ts` and `.go` files. These are the source of truth — all request/response types must be defined here and imported everywhere else.

```typespec
// specs/typespec/org/feature.tsp

model CreateFooRequest {
  name: string;
  description?: string;
}

model FooResponse {
  id: string;
  name: string;
  created_at: utcDateTime;
}

@route("/org/create-foo")
op createFoo(...CreateFooRequest): CreatedResponse<FooResponse> | BadRequestResponse;

@route("/org/list-foos")
op listFoo(...ListFooRequest): OkResponse<FooListResponse> | BadRequestResponse;
```

### Database Schema

Changes to `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql`. No new migration files — edit the initial schema directly.

#### Tables / Columns

```sql
-- Regional DB
CREATE TABLE foos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### SQL Queries

New query files in `api-server/db/{global,regional}/queries/`. Annotate with sqlc directives.

```sql
-- name: CreateFoo :one
INSERT INTO foos (org_id, name) VALUES ($1, $2) RETURNING *;

-- name: ListFoos :many
SELECT * FROM foos
WHERE org_id = $1
  AND ($2::uuid IS NULL OR id < $2)
ORDER BY id DESC
LIMIT $3;
```

### Backend

#### Endpoints

| Method | Path              | Handler file          | Auth middleware | Role required    |
| ------ | ----------------- | --------------------- | --------------- | ---------------- |
| POST   | `/org/create-foo` | `handlers/org/foo.go` | `OrgAuth`       | `org:manage_foo` |
| POST   | `/org/list-foos`  | `handlers/org/foo.go` | `OrgAuth`       | `org:view_foo`   |

#### Handler Notes

- Decode → validate → tx → respond
- All writes use `s.WithRegionalTx` / `s.WithGlobalTx`
- Audit log write MUST be inside the same transaction as the primary write

#### Audit Log Events

| event_type       | DB table                | actor_user_id | target_user_id | event_data keys  |
| ---------------- | ----------------------- | ------------- | -------------- | ---------------- |
| `org.create_foo` | `audit_logs` (regional) | org user      | —              | `foo_id`, `name` |

### Frontend

#### New Routes

| Portal | Route path | Page component              |
| ------ | ---------- | --------------------------- |
| org-ui | `/foo`     | `src/pages/FooListPage.tsx` |

#### Implementation Notes

- Standard page layout: maxWidth 1200, back button first, Title level=2, no outer Card
- Wrap network calls with `<Spin spinning={loading}>` to prevent double-submission
- Disable submit while form has validation errors

### RBAC

#### New roles (if any)

All three locations must be kept in sync:

- `specs/typespec/common/roles.ts`
- `specs/typespec/common/roles.go`
- `api-server/db/migrations/.../00000000000001_initial_schema.sql` (INSERT into `roles`)

| Role name        | Portal | Description               |
| ---------------- | ------ | ------------------------- |
| `org:view_foo`   | org    | Read-only access to foos  |
| `org:manage_foo` | org    | Create, edit, delete foos |

#### Existing roles reused

List any existing roles this feature checks against.

### i18n

Minimum: provide `en-US` values. Add matching keys to `de-DE` and `ta-IN`.

```json
{
	"fooList": {
		"title": "Foos",
		"addFoo": "Add Foo",
		"backToDashboard": "Back to Dashboard",
		"name": "Name",
		"status": "Status",
		"createdAt": "Created At",
		"createSuccess": "Foo created successfully",
		"deleteSuccess": "Foo deleted successfully"
	}
}
```

### Test Matrix

Tests in `playwright/tests/api/{portal}/foo.spec.ts`. All types imported from `specs/typespec/`.

| Scenario                     | Request                              | Expected status                                                             |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Success — create             | valid body                           | 201 + resource in response                                                  |
| Success — list               | valid pagination                     | 200 + items array                                                           |
| Missing required field       | `name` omitted                       | 400                                                                         |
| Invalid field value          | `name: ""`                           | 400                                                                         |
| Unauthenticated              | no / invalid token                   | 401                                                                         |
| Wrong role (RBAC negative)   | authenticated, no roles              | 403                                                                         |
| Correct role (RBAC positive) | non-superadmin with `org:manage_foo` | 201                                                                         |
| Not found                    | unknown ID                           | 404                                                                         |
| Invalid state                | e.g. already connected               | 454 / 455 / 456 / 457 / 458 / 460 (see custom error codes table in Stage 1) |
| Audit log written            | after success case                   | entry with correct `event_type`                                             |
| No audit log on failure      | after 4xx                            | count unchanged                                                             |
