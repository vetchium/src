## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: none (HubUser, regional storage, global email-hash table, and outbox-email infrastructure already exist)
Dependents: hub-connections (uses overlapping verified stints to gate connection eligibility), hub-profile (renders the user's verified employers on profile pages by calling `list-public-employer-stints`), hub-job-applications (uses verified stints to gate endorsement eligibility — future spec)

### Overview

HubUsers add the work email addresses they hold at their current and past employers. Each address is verified end-to-end (one-time code emailed to the address; user enters it). A successfully verified address opens a **stint** — a continuous period during which the system trusts the user as an employee at that domain. Stints are first-class records: each carries `(first_verified_at, last_verified_at, ended_at?)` and a status. They are the durable evidence used by hub-connections to decide whether two HubUsers may connect, and (in a future spec) by hub-job-applications to decide whether a colleague may be requested as an endorser.

A user re-verifies each active stint once per 365 days; a regional background worker emails a re-verification challenge on day 365, and the stint auto-ends 30 days later if the challenge isn't completed. A user can also end a stint themselves at any time (e.g. they left the company). If they later return to the same employer they re-add the email and a fresh stint is started — the old stint's history survives, so colleague overlap math works correctly across job changes.

A work email is **globally unique per active stint**: at most one HubUser may hold a non-ended stint at a given email at a time. Once the stint ends, the address may be claimed by another HubUser (covering the realistic case of a corporate inbox being reassigned to a new employee). Personal-email domains (gmail.com, hotmail.com, etc.) are blocked via a global blocklist that admins can curate.

Public visibility: another HubUser browsing a profile sees only the **domain** of each verified employer plus the year-range of each stint (e.g. `@acme.com — 2020 to 2024`, `@newjob.com — current`). The actual address, the exact verification timestamps, and the verification mechanics are private to the owning HubUser.

Portals affected: Hub portal (full lifecycle for the owning HubUser; read-side surface for other HubUsers when they view a profile). Admin portal (curating the personal-domain blocklist).

### Key Concepts and Vocabulary

- **Work email** — an email address at a non-personal domain (e.g. `alice@acme.com`). Each work email is owned by at most one HubUser at a time and goes through `pending_verification → active → ended` in its lifetime.
- **Stint** — one continuous period during which a HubUser is trusted as an employee at a given domain. Modelled as a single row in `hub_employer_stints`. A stint begins when the user verifies an email; it ends when the user removes it, when the user fails to re-verify within the cutoff window, or implicitly when the user adds a new email at the same domain (we hard-end any prior active stint at that domain to keep "one active stint per (user, domain)" invariant).
- **Re-verification** — the periodic challenge sent to keep a stint active. Issued at `last_verified_at + 365 days`; if not completed within 30 days the stint auto-ends.
- **Personal-domain blocklist** — a global table of email domains that may NOT be added as work emails (gmail.com, hotmail.com, yahoo.com, outlook.com, icloud.com, proton.me, yandex.com, qq.com, naver.com, mail.ru, gmx.com, aol.com, zoho.com, fastmail.com, tutanota.com, …). Curated by admins; the seed list is populated in the initial schema.
- **Owner view** vs **public view** — the owning HubUser sees full data (address, exact timestamps, status, pending re-verification challenges). Other HubUsers see only the domain + stint year-range, and only for stints with `status` in (`active`, `ended`) — never `pending_verification`.

### Stint State Machine

States: `pending_verification`, `active`, `ended`.

| From                 | Action / Trigger                                      | To                   | Notes                                                                                                                  |
| -------------------- | ----------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| —                    | `add-work-email` — user adds an address               | pending_verification | Sends verification code to the address (6-digit, 24h TTL); creates the stint row                                       |
| pending_verification | `verify-work-email` — user submits correct code       | active               | Sets `first_verified_at = NOW()`, `last_verified_at = NOW()`                                                           |
| pending_verification | `resend-work-email-code` — user requests a new code   | pending_verification | Old code invalidated; rate-limited to 1/min, 5/day per stint                                                           |
| pending_verification | TTL elapsed (24h) without verification                | ended                | Background worker hard-ends the stint with `ended_reason = 'verification_expired'`                                     |
| pending_verification | user calls `remove-work-email`                        | ended                | `ended_reason = 'user_removed_pending'`                                                                                |
| active               | `reverify-work-email` — user submits the 365-day code | active               | Advances `last_verified_at = NOW()`; clears any pending re-verify challenge                                            |
| active               | `remove-work-email` — user explicitly removes         | ended                | `ended_reason = 'user_removed'`; sets `ended_at = NOW()`                                                               |
| active               | re-verify worker — `last_verified_at + 395d <= NOW()` | ended                | `ended_reason = 'reverify_timeout'`; `actor_user_id = NULL` on audit row                                               |
| active               | user adds a new email at the same domain & verifies   | ended                | The PRIOR active stint at that domain is hard-ended on successful verify of the new one; `ended_reason = 'superseded'` |
| ended                | (terminal)                                            | —                    | A new stint at the same email may be started; old row is preserved for history                                         |

Notes:

- **Re-verify challenge**: a separate background worker sweeps `active` stints where `last_verified_at + 365 days <= NOW()` AND no current challenge exists; it issues a 6-digit code (24h TTL), emails it to the address, and writes a row to `hub_work_email_reverify_challenges`. The user has until `last_verified_at + 395 days` (a 30-day grace) to call `reverify-work-email` with the code. If they miss the window, the stint auto-ends.
- **One active stint per (user, domain)** is enforced via a partial unique index. Adding a new email at a domain where the user has an active stint is allowed but on successful verification the old stint is hard-ended (see `superseded` row above) so the invariant holds.
- **Globally one HubUser per active address** is enforced via a partial unique index on `email_address_hash` filtered to `status IN ('pending_verification','active')`. Once ended, the address is reusable by anyone (including the original owner).

### Acceptance Criteria

#### Adding a work email

- [ ] Authenticated HubUser calls `add-work-email` with an `email_address`. The address must:
  - parse as a valid email (RFC 5322 light parser),
  - have a domain that is NOT in the personal-domain blocklist (case-insensitive),
  - not currently be held in `pending_verification` or `active` status by anyone (caller included).
- [ ] On success: a new stint row is created with `status = 'pending_verification'`, a 6-digit code is generated (cryptographically random, 24h TTL), the code's bcrypt hash is stored on the stint row, an outbox email is enqueued in the same transaction, and 201 is returned with the new `stint_id`.
- [ ] Validation errors return 400 with the standard `[{field, message}]` array.
- [ ] Personal-domain rejection returns 422 (state-shaped: the input was structurally valid but the resource cannot be created in this domain).
- [ ] Address held by another HubUser in active or pending status returns 409.
- [ ] User has reached the 50-stint cap (active + pending across all of their domains): 422 with the "too many work emails" sentinel error.
- [ ] Adding the same address the user already holds in `active` or `pending_verification` returns 409 (no-op for idempotency would be confusing — clearer to refuse).
- [ ] Adding an address at a domain where the user already has an active stint is allowed (pre-supersede behaviour). The new stint goes to pending_verification; the existing active stint is unaffected until the new stint is successfully verified, at which point the old one is hard-ended with `ended_reason = 'superseded'`.

#### Verifying a work email

- [ ] HubUser calls `verify-work-email` with `stint_id` and `code`. The stint must be owned by the caller, status `pending_verification`, code TTL not elapsed, and the bcrypt-hashed code must match.
- [ ] On success: status → `active`, `first_verified_at = NOW()`, `last_verified_at = NOW()`, the code hash is wiped, any prior active stint at the same `(user, domain)` is hard-ended with `ended_reason = 'superseded'`, and 200 is returned with the updated stint.
- [ ] Wrong / expired / unknown code returns 422.
- [ ] Caller doesn't own the stint or stint not in `pending_verification`: 422.
- [ ] Stint not found: 404.
- [ ] Three consecutive bad codes within 10 minutes locks the stint (status stays pending but code-attempts counter freezes); user must call `resend-work-email-code` to get a fresh code.

#### Re-sending the verification code

- [ ] HubUser calls `resend-work-email-code` with `stint_id`. Stint must be owned and in `pending_verification`.
- [ ] Rate limit: at most 1 send per minute per stint, at most 5 sends per 24h per stint. Exceeding either returns 429.
- [ ] On success: a fresh code is generated, the stint's `code_hash` and `code_ttl_at` are replaced, an outbox email is enqueued in the same transaction, and 200 is returned.

#### Re-verifying an active stint

- [ ] HubUser calls `reverify-work-email` with `stint_id` and `code`. Stint must be owned and in `active` status, AND a current re-verify challenge row must exist for it (issued by the worker), AND its TTL must not have elapsed, AND the code's bcrypt hash must match.
- [ ] On success: `last_verified_at = NOW()`, the challenge row is deleted, 200 is returned.
- [ ] If no current challenge exists, return 422 (user hit the endpoint speculatively; no-op).
- [ ] Wrong / expired / unknown code: 422.
- [ ] Stint not found or not owned: 404.

#### Removing a work email

- [ ] HubUser calls `remove-work-email` with `stint_id`. Caller must own the stint.
- [ ] If status is `pending_verification`: stint moves to `ended` with `ended_reason = 'user_removed_pending'`. Any unsent code stays untouched (the row is preserved for history).
- [ ] If status is `active`: stint moves to `ended` with `ended_reason = 'user_removed'`, `ended_at = NOW()`. Any pending re-verify challenge is deleted in the same tx.
- [ ] If status is `ended`: 422 (idempotent end is not a valid request — user must add a new stint to re-acquire).
- [ ] Stint not found: 404.
- [ ] **Side effects on connections**: ending a stint does NOT retroactively dissolve any `connected` records that relied on this stint's overlap. The connection was made under the trust signal at the time; subsequent loss of trust does not unmake history. (Future hub-connections enhancement may revisit this; out of scope for this spec.)

#### Listing & getting

- [ ] `list-my-work-emails` returns the caller's stints, paginated, sorted by `(status_priority, created_at DESC)` where status_priority is `active=0, pending_verification=1, ended=2`. Keyset cursor encodes `(status_priority, created_at, stint_id)`. Optional filters: `filter_status` (single status or array), `filter_domain` (exact match).
- [ ] `get-my-work-email` returns a single stint by `stint_id` with full owner-view fields.
- [ ] `list-public-employer-stints` returns the **public-view** stints for any handle. Public view contains `domain`, `is_current` (= `status = 'active'`), `start_year` (= year of `first_verified_at`), and `end_year` (= year of `ended_at` for ended stints; null for active). `pending_verification` stints are NEVER returned. Sorted: active first (most-recent `first_verified_at` first), then ended (most-recent `ended_at` first).
- [ ] `list-public-employer-stints` returns an empty list (200) for unknown handles or for users who have no active/ended stints — never 404 (avoids handle enumeration).

#### Personal-domain blocklist (admin)

- [ ] Admin endpoint `admin/list-blocked-personal-domains` returns the current blocklist, paginated, filterable by domain prefix.
- [ ] Admin endpoint `admin/add-blocked-personal-domain` adds a domain (lower-cased, trimmed). 409 if already present. Requires `admin:manage_personal_domain_blocklist`.
- [ ] Admin endpoint `admin/remove-blocked-personal-domain` removes a domain. 404 if not present. Requires `admin:manage_personal_domain_blocklist`.
- [ ] The blocklist is consulted at `add-work-email` time by exact-match on the email's domain (case-insensitive). It is not consulted on already-active stints — pre-existing stints survive blocklist additions (we never auto-end real users because admin tightened the list).
- [ ] Initial seed populated by the regional/global migration: gmail.com, googlemail.com, hotmail.com, hotmail.co.uk, outlook.com, live.com, msn.com, yahoo.com, yahoo.co.uk, ymail.com, rocketmail.com, icloud.com, me.com, mac.com, proton.me, protonmail.com, pm.me, tutanota.com, tutamail.com, tuta.io, fastmail.com, fastmail.fm, hey.com, mail.com, gmx.com, gmx.de, gmx.net, web.de, t-online.de, yandex.com, yandex.ru, mail.ru, list.ru, inbox.ru, bk.ru, qq.com, 163.com, 126.com, sina.com, sohu.com, naver.com, daum.net, hanmail.net, kakao.com, aol.com, aim.com, zoho.com, zohomail.com, hushmail.com, rediffmail.com.

#### Auditing and storage

- [ ] Audit-log entry is written inside the same transaction as every state-changing write. Event types: `hub.add_work_email`, `hub.verify_work_email`, `hub.resend_work_email_code`, `hub.reverify_work_email`, `hub.remove_work_email`, `hub.expire_work_email_pending` (worker), `hub.end_work_email_reverify_timeout` (worker), `hub.supersede_work_email_stint` (verify-time supersede).
- [ ] No raw email addresses appear in `event_data` — only SHA-256 hash and the (non-sensitive) bare domain.
- [ ] Stint rows live in the **regional** DB matching the HubUser's home region. Cross-region eligibility checks (when a HubUser in region A queries connection eligibility against a user in region B) use the per-region routing already established by global routing.
- [ ] An entry in the **global** `hub_work_email_index` table mirrors `(email_address_hash, owning_hub_user_global_id, region, status)` for the partial-uniqueness check across regions. Updated atomically with the regional stint row inside a cross-DB write (global first, then regional, with compensating transaction on regional failure — same pattern as user signup).
- [ ] A re-verify challenge row in `hub_work_email_reverify_challenges` is created by the worker; deleted on successful re-verification or on stint end.

#### RBAC

- [ ] All Hub endpoints require an active HubUser session (`HubAuth`) and no additional role beyond an active hub account.
- [ ] All Admin endpoints require `AdminAuth` plus the role `admin:manage_personal_domain_blocklist`. `admin:superadmin` bypasses.
- [ ] New role `admin:manage_personal_domain_blocklist` defined in `specs/typespec/common/roles.ts`, `specs/typespec/common/roles.go`, and the global `initial_schema.sql` `roles` seed.

### Custom Error Codes

This spec uses standard HTTP codes only; no custom 45x codes needed (`add-work-email` uses 422 for personal-domain rejection and stint-cap-reached, 409 for ownership conflict; `verify-work-email` uses 422 for bad/expired code; `remove-work-email` uses 422 for invalid state, 404 for not-found).

### Field Constraints

| Field           | Type   | Required          | Constraints                                                                                          |
| --------------- | ------ | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `email_address` | string | yes (add)         | RFC 5322 light parse; max 254 chars; domain not on personal-domain blocklist; lower-cased internally |
| `stint_id`      | UUID   | yes (verify/etc.) | must be owned by caller                                                                              |
| `code`          | string | yes (verify)      | 6-digit numeric                                                                                      |
| `filter_status` | enum[] | no                | `pending_verification` / `active` / `ended`; multi-select on list                                    |
| `filter_domain` | string | no                | exact lower-cased match on `domain` column                                                           |
| `domain`        | string | yes (admin)       | lower-cased, trimmed; max 253 chars; no `@`                                                          |

### User-Facing Screens

**Screen: My Work Emails (Hub)**

Portal: hub-ui | Route: `/settings/work-emails`

Header: Back to Settings button | "Work Emails" h2 (left) | "Add Work Email" button (right)

Filter: Status segmented — All / Active / Pending / Ended (default: Active + Pending)

| Email Address | Domain | Status | Verified Since | Last Verified | Re-verify Due | Actions |
| ------------- | ------ | ------ | -------------- | ------------- | ------------- | ------- |

Actions per row:

- `pending_verification` → Enter Code · Resend Code · Remove
- `active`, no challenge → Remove
- `active`, challenge issued → Re-verify Now · Remove
- `ended` → (no actions; the row is shown only when filter includes Ended)

Adding a new email opens a modal with one field (email address). On submit the row is added in `pending_verification` and the user is taken to a "Enter the 6-digit code we just sent to {address}" screen. The screen has a re-send button (enabled after 60 s).

Empty state: _"You haven't added any work emails yet. Add the email at your current employer to connect with verified colleagues."_

**Screen: Owner-side stint detail**

Portal: hub-ui | Route: `/settings/work-emails/:stint_id`

Sidebar shows: status, first_verified_at, last_verified_at, ended_at (if any), ended_reason (if any), domain, code attempts remaining (if pending), re-verify challenge issued at + expires at (if any).

Buttons (contextual): Enter Code · Resend Code · Re-verify Now · Remove.

**Public profile widget** (rendered on profile pages by the hub-profile spec; this spec just provides the API)

Driven by `list-public-employer-stints?handle={handle}`. The widget renders a table:

| Employer      | Period         |
| ------------- | -------------- |
| `@acme.com`   | 2020 – 2024    |
| `@newjob.com` | 2025 – present |

Where "present" means `status = 'active'` and the year-range is computed from `first_verified_at` (start) and `ended_at` (end, or "present").

**Screen: Personal-domain blocklist (Admin)**

Portal: admin-ui | Route: `/personal-domain-blocklist`

Standard admin list page with a single-field "Add domain" input and a Remove button per row. Filter by domain prefix.

### API Surface

| Endpoint                                     | Portal | Who calls it                                         | What it does                                                                         |
| -------------------------------------------- | ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /hub/add-work-email`                   | hub    | HubUser                                              | Creates a stint in `pending_verification` and emails a 6-digit code                  |
| `POST /hub/verify-work-email`                | hub    | HubUser                                              | Moves a `pending_verification` stint to `active`                                     |
| `POST /hub/resend-work-email-code`           | hub    | HubUser                                              | Re-sends a fresh 6-digit code for a `pending_verification` stint                     |
| `POST /hub/reverify-work-email`              | hub    | HubUser                                              | Refreshes `last_verified_at` on an `active` stint with a current re-verify challenge |
| `POST /hub/remove-work-email`                | hub    | HubUser                                              | Ends a `pending_verification` or `active` stint                                      |
| `POST /hub/list-my-work-emails`              | hub    | HubUser                                              | Paginated list of caller's stints (owner view)                                       |
| `POST /hub/get-my-work-email`                | hub    | HubUser                                              | Single stint by id (owner view)                                                      |
| `POST /hub/list-public-employer-stints`      | hub    | HubUser                                              | Public stints (domain + year-range) for any handle                                   |
| `POST /admin/list-blocked-personal-domains`  | admin  | AdminUser (`admin:manage_personal_domain_blocklist`) | Paginated list of blocked personal-email domains                                     |
| `POST /admin/add-blocked-personal-domain`    | admin  | AdminUser (`admin:manage_personal_domain_blocklist`) | Adds a domain to the blocklist                                                       |
| `POST /admin/remove-blocked-personal-domain` | admin  | AdminUser (`admin:manage_personal_domain_blocklist`) | Removes a domain from the blocklist                                                  |

### Audit Log Events

| event_type                                | when                                                                              | actor_user_id | event_data keys                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `hub.add_work_email`                      | add-work-email success                                                            | calling user  | `stint_id`, `email_address_hash`, `domain`                        |
| `hub.verify_work_email`                   | verify-work-email success                                                         | calling user  | `stint_id`, `email_address_hash`, `domain`, `first_verified_at`   |
| `hub.resend_work_email_code`              | resend-work-email-code success                                                    | calling user  | `stint_id`                                                        |
| `hub.reverify_work_email`                 | reverify-work-email success                                                       | calling user  | `stint_id`, `last_verified_at`                                    |
| `hub.remove_work_email`                   | remove-work-email success                                                         | calling user  | `stint_id`, `email_address_hash`, `domain`, `ended_reason`        |
| `hub.expire_work_email_pending`           | worker hard-ends a pending_verification stint after 24h                           | NULL          | `stint_id`, `email_address_hash`                                  |
| `hub.end_work_email_reverify_timeout`     | worker hard-ends an active stint after 395-day cutoff                             | NULL          | `stint_id`, `domain`, `last_verified_at`                          |
| `hub.issue_work_email_reverify_challenge` | worker issues a re-verify challenge to an active stint at day 365                 | NULL          | `stint_id`, `domain`, `challenge_expires_at`                      |
| `hub.supersede_work_email_stint`          | inside verify-work-email, when an older active stint at same domain is hard-ended | calling user  | `stint_id` (the superseded one), `superseding_stint_id`, `domain` |
| `admin.add_blocked_personal_domain`       | admin add success                                                                 | admin user    | `domain`                                                          |
| `admin.remove_blocked_personal_domain`    | admin remove success                                                              | admin user    | `domain`                                                          |

All Hub events land in the regional `audit_logs` (matching the HubUser's home region). All Admin events land in the global `admin_audit_logs`.

### Out of Scope for Phase 1 (deferred)

- OAuth-based verification (e.g. "Sign in with Google Workspace" to auto-verify @company-on-google-workspace.com). Future enhancement.
- Domain MX-record probing as a sanity check on `add-work-email`. Future enhancement; for Phase 1 we just send the code and let bounces fail loudly.
- "Recently used" auto-fill across devices.
- Polished re-verify UX (banner / nudge surfaces on dashboard, scheduled-reminder emails beyond the day-365 trigger). The endpoint and the work-emails settings page ship in Phase 1; broader UX nudges land later.
- Connection re-evaluation when a stint ends. Out of scope; hub-connections records persist past stint end.

---

## Stage 2: Implementation Plan

Status: READY-FOR-IMPLEMENTATION
Authors: @psankar

### API Contract

TypeSpec definitions in `specs/typespec/hub/work-emails.tsp` (matching `.ts` and `.go` files), plus admin-side in `specs/typespec/admin/personal-domain-blocklist.tsp`. All request/response types live in the typespec package; never define API schemas locally.

```typespec
// specs/typespec/hub/work-emails.tsp
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union WorkEmailStintStatus {
  PendingVerification: "pending_verification",
  Active:              "active",
  Ended:               "ended",
}

union WorkEmailStintEndedReason {
  UserRemoved:           "user_removed",
  UserRemovedPending:    "user_removed_pending",
  VerificationExpired:   "verification_expired",
  ReverifyTimeout:       "reverify_timeout",
  Superseded:            "superseded",
}

model WorkEmailStintOwnerView {
  stint_id:                         string;
  email_address:                    string;
  domain:                           string;
  status:                           WorkEmailStintStatus;
  first_verified_at?:               utcDateTime;
  last_verified_at?:                utcDateTime;
  ended_at?:                        utcDateTime;
  ended_reason?:                    WorkEmailStintEndedReason;
  pending_code_expires_at?:         utcDateTime;
  pending_code_attempts_remaining?: int32;
  reverify_challenge_issued_at?:    utcDateTime;
  reverify_challenge_expires_at?:   utcDateTime;
  created_at:                       utcDateTime;
  updated_at:                       utcDateTime;
}

model PublicEmployerStint {
  domain:        string;
  is_current:    boolean;
  start_year:    int32;
  end_year?:     int32;     // null when is_current = true
}

model AddWorkEmailRequest        { email_address: string; }
model AddWorkEmailResponse       { stint_id: string; pending_code_expires_at: utcDateTime; }
model VerifyWorkEmailRequest     { stint_id: string; code: string; }
model ResendWorkEmailCodeRequest { stint_id: string; }
model ReverifyWorkEmailRequest   { stint_id: string; code: string; }
model RemoveWorkEmailRequest     { stint_id: string; }
model GetMyWorkEmailRequest      { stint_id: string; }

model ListMyWorkEmailsRequest {
  filter_status?:   WorkEmailStintStatus[];
  filter_domain?:   string;
  pagination_key?:  string;
  limit?:           int32;
}
model ListMyWorkEmailsResponse {
  work_emails:           WorkEmailStintOwnerView[];
  next_pagination_key?:  string;
}

model ListPublicEmployerStintsRequest  { handle: string; }
model ListPublicEmployerStintsResponse { stints: PublicEmployerStint[]; }

@route("/hub/add-work-email")              @post addWorkEmail        (...AddWorkEmailRequest):        CreatedResponse<AddWorkEmailResponse>     | BadRequestResponse | ConflictResponse        | UnprocessableEntityResponse;
@route("/hub/verify-work-email")           @post verifyWorkEmail     (...VerifyWorkEmailRequest):     OkResponse<WorkEmailStintOwnerView>       | BadRequestResponse | NotFoundResponse        | UnprocessableEntityResponse;
@route("/hub/resend-work-email-code")      @post resendWorkEmailCode (...ResendWorkEmailCodeRequest): OkResponse<WorkEmailStintOwnerView>       | BadRequestResponse | NotFoundResponse        | TooManyRequestsResponse | UnprocessableEntityResponse;
@route("/hub/reverify-work-email")         @post reverifyWorkEmail   (...ReverifyWorkEmailRequest):   OkResponse<WorkEmailStintOwnerView>       | BadRequestResponse | NotFoundResponse        | UnprocessableEntityResponse;
@route("/hub/remove-work-email")           @post removeWorkEmail     (...RemoveWorkEmailRequest):     OkResponse<WorkEmailStintOwnerView>       | NotFoundResponse   | UnprocessableEntityResponse;
@route("/hub/list-my-work-emails")         @post listMyWorkEmails    (...ListMyWorkEmailsRequest):    OkResponse<ListMyWorkEmailsResponse>      | BadRequestResponse;
@route("/hub/get-my-work-email")           @post getMyWorkEmail      (...GetMyWorkEmailRequest):      OkResponse<WorkEmailStintOwnerView>       | NotFoundResponse;
@route("/hub/list-public-employer-stints") @post listPublicStints    (...ListPublicEmployerStintsRequest): OkResponse<ListPublicEmployerStintsResponse>;
```

```typespec
// specs/typespec/admin/personal-domain-blocklist.tsp
model BlockedPersonalDomain      { domain: string; created_at: utcDateTime; }
model AdminAddBlockedDomainRequest    { domain: string; }
model AdminRemoveBlockedDomainRequest { domain: string; }
model AdminListBlockedDomainsRequest  {
  filter_domain_prefix?: string;
  pagination_key?:       string;
  limit?:                int32;
}
model AdminListBlockedDomainsResponse {
  domains:              BlockedPersonalDomain[];
  next_pagination_key?: string;
}

@route("/admin/list-blocked-personal-domains")  @post listBlockedDomains  (...AdminListBlockedDomainsRequest):  OkResponse<AdminListBlockedDomainsResponse> | BadRequestResponse;
@route("/admin/add-blocked-personal-domain")    @post addBlockedDomain    (...AdminAddBlockedDomainRequest):    CreatedResponse<BlockedPersonalDomain>      | BadRequestResponse | ConflictResponse;
@route("/admin/remove-blocked-personal-domain") @post removeBlockedDomain (...AdminRemoveBlockedDomainRequest): NoContentResponse                            | NotFoundResponse;
```

The matching `.ts` and `.go` files mirror the TypeSpec one-to-one. Each writable request type exports a `validate{TypeName}` function that returns `ValidationError[]`. Validation rules are spelled out in **Field Constraints** above.

### Database Schema

All schema lives in regional + global initial-schema files; no new migration files.

#### Regional DB (`api-server/db/migrations/regional/00000000000001_initial_schema.sql`)

```sql
CREATE TYPE work_email_stint_status AS ENUM ('pending_verification','active','ended');
CREATE TYPE work_email_stint_ended_reason AS ENUM ('user_removed','user_removed_pending','verification_expired','reverify_timeout','superseded');

CREATE TABLE hub_employer_stints (
  stint_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id           UUID NOT NULL,                    -- regional hub user id
  email_address         TEXT NOT NULL,                    -- lower-cased
  email_address_hash    TEXT NOT NULL,                    -- SHA-256(lower(email)); used for partial unique idx
  domain                TEXT NOT NULL,                    -- lower-cased part after @
  status                work_email_stint_status NOT NULL DEFAULT 'pending_verification',
  first_verified_at     TIMESTAMPTZ,
  last_verified_at      TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  ended_reason          work_email_stint_ended_reason,
  pending_code_hash     TEXT,                              -- bcrypt of 6-digit code; null after verify or end
  pending_code_expires_at TIMESTAMPTZ,
  pending_code_attempts INTEGER NOT NULL DEFAULT 0,
  pending_code_locked_until TIMESTAMPTZ,                   -- set when 3 wrong attempts hit
  pending_code_resends_today INTEGER NOT NULL DEFAULT 0,   -- reset by worker daily
  pending_code_last_resent_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active or pending stint per (user, email_address) — old ended rows are kept for history.
CREATE UNIQUE INDEX uq_hub_employer_stints_user_email_active
  ON hub_employer_stints (hub_user_id, email_address)
  WHERE status IN ('pending_verification','active');

-- One active stint per (user, domain) — enforced on verify-time supersede.
CREATE UNIQUE INDEX uq_hub_employer_stints_user_domain_active
  ON hub_employer_stints (hub_user_id, domain)
  WHERE status = 'active';

-- One active or pending stint per email_address GLOBALLY within a region; cross-region uniqueness is enforced via the global mirror table.
CREATE UNIQUE INDEX uq_hub_employer_stints_email_active
  ON hub_employer_stints (email_address_hash)
  WHERE status IN ('pending_verification','active');

CREATE INDEX idx_hub_employer_stints_user_status_created
  ON hub_employer_stints (hub_user_id, status, created_at DESC, stint_id DESC);

CREATE INDEX idx_hub_employer_stints_active_domain
  ON hub_employer_stints (domain, status)
  WHERE status = 'active';

CREATE INDEX idx_hub_employer_stints_reverify_sweep
  ON hub_employer_stints (last_verified_at)
  WHERE status = 'active';

CREATE INDEX idx_hub_employer_stints_pending_expiry
  ON hub_employer_stints (pending_code_expires_at)
  WHERE status = 'pending_verification';

CREATE TABLE hub_work_email_reverify_challenges (
  stint_id           UUID PRIMARY KEY REFERENCES hub_employer_stints(stint_id) ON DELETE CASCADE,
  challenge_code_hash TEXT NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_hub_work_email_reverify_challenges_expires
  ON hub_work_email_reverify_challenges (expires_at);
```

#### Global DB (`api-server/db/migrations/global/00000000000001_initial_schema.sql`)

```sql
CREATE TABLE hub_work_email_index (
  email_address_hash    TEXT PRIMARY KEY,                  -- SHA-256(lower(email))
  hub_user_global_id    UUID NOT NULL,                     -- references hub_users in global DB
  region                TEXT NOT NULL,
  status                TEXT NOT NULL,                     -- mirrors regional 'pending_verification' or 'active'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only "live" rows live here. On stint end, the row is DELETED so the email can be re-claimed.

CREATE TABLE personal_domain_blocklist (
  domain        TEXT PRIMARY KEY,                          -- lower-cased
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_admin_user_id UUID                            -- nullable for the seeded entries
);

CREATE INDEX idx_personal_domain_blocklist_prefix ON personal_domain_blocklist (domain text_pattern_ops);

-- Seed
INSERT INTO personal_domain_blocklist (domain) VALUES
  ('gmail.com'), ('googlemail.com'), ('hotmail.com'), ('hotmail.co.uk'),
  ('outlook.com'), ('live.com'), ('msn.com'),
  ('yahoo.com'), ('yahoo.co.uk'), ('ymail.com'), ('rocketmail.com'),
  ('icloud.com'), ('me.com'), ('mac.com'),
  ('proton.me'), ('protonmail.com'), ('pm.me'),
  ('tutanota.com'), ('tutamail.com'), ('tuta.io'),
  ('fastmail.com'), ('fastmail.fm'), ('hey.com'),
  ('mail.com'), ('gmx.com'), ('gmx.de'), ('gmx.net'), ('web.de'), ('t-online.de'),
  ('yandex.com'), ('yandex.ru'), ('mail.ru'), ('list.ru'), ('inbox.ru'), ('bk.ru'),
  ('qq.com'), ('163.com'), ('126.com'), ('sina.com'), ('sohu.com'),
  ('naver.com'), ('daum.net'), ('hanmail.net'), ('kakao.com'),
  ('aol.com'), ('aim.com'),
  ('zoho.com'), ('zohomail.com'), ('hushmail.com'), ('rediffmail.com')
ON CONFLICT (domain) DO NOTHING;
```

#### sqlc queries

In `api-server/db/regional/queries/hub_work_emails.sql`:

```sql
-- name: CreateWorkEmailStint :one
INSERT INTO hub_employer_stints (
  hub_user_id, email_address, email_address_hash, domain,
  status, pending_code_hash, pending_code_expires_at, pending_code_attempts
)
VALUES (@hub_user_id, @email_address, @email_address_hash, @domain,
        'pending_verification', @pending_code_hash, @pending_code_expires_at, 0)
RETURNING *;

-- name: GetWorkEmailStintByID :one
SELECT * FROM hub_employer_stints
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id;

-- name: ListMyWorkEmailStints :many
SELECT * FROM hub_employer_stints
WHERE hub_user_id = @hub_user_id
  AND (sqlc.narg('filter_statuses')::work_email_stint_status[] IS NULL
       OR status = ANY(sqlc.narg('filter_statuses')::work_email_stint_status[]))
  AND (sqlc.narg('filter_domain')::text IS NULL
       OR domain = sqlc.narg('filter_domain')::text)
  AND (@cursor_status_priority::int IS NULL
       OR (CASE status WHEN 'active' THEN 0 WHEN 'pending_verification' THEN 1 ELSE 2 END,
           created_at, stint_id)
          < (@cursor_status_priority, @cursor_created_at, @cursor_stint_id))
ORDER BY (CASE status WHEN 'active' THEN 0 WHEN 'pending_verification' THEN 1 ELSE 2 END) ASC,
         created_at DESC, stint_id DESC
LIMIT @limit_count;

-- name: VerifyWorkEmailStint :one
UPDATE hub_employer_stints
SET status              = 'active',
    first_verified_at   = NOW(),
    last_verified_at    = NOW(),
    pending_code_hash   = NULL,
    pending_code_expires_at = NULL,
    pending_code_attempts = 0,
    pending_code_locked_until = NULL,
    updated_at          = NOW()
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id AND status = 'pending_verification'
RETURNING *;

-- name: SupersedePriorActiveStintAtDomain :one
UPDATE hub_employer_stints
SET status       = 'ended',
    ended_at     = NOW(),
    ended_reason = 'superseded',
    updated_at   = NOW()
WHERE hub_user_id = @hub_user_id
  AND domain      = @domain
  AND status      = 'active'
  AND stint_id   <> @superseding_stint_id
RETURNING *;

-- name: ReverifyWorkEmailStint :one
UPDATE hub_employer_stints
SET last_verified_at = NOW(),
    updated_at       = NOW()
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id AND status = 'active'
RETURNING *;

-- name: EndWorkEmailStintByUser :one
UPDATE hub_employer_stints
SET status       = 'ended',
    ended_at     = NOW(),
    ended_reason = CASE WHEN status = 'pending_verification' THEN 'user_removed_pending'::work_email_stint_ended_reason
                        ELSE 'user_removed'::work_email_stint_ended_reason END,
    updated_at   = NOW()
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id AND status IN ('pending_verification','active')
RETURNING *;

-- name: WorkerExpirePendingStints :many
UPDATE hub_employer_stints
SET status       = 'ended',
    ended_at     = NOW(),
    ended_reason = 'verification_expired',
    updated_at   = NOW()
WHERE status = 'pending_verification'
  AND pending_code_expires_at <= NOW()
RETURNING *;

-- name: WorkerEndReverifyTimeoutStints :many
UPDATE hub_employer_stints
SET status       = 'ended',
    ended_at     = NOW(),
    ended_reason = 'reverify_timeout',
    updated_at   = NOW()
WHERE status = 'active'
  AND last_verified_at + INTERVAL '395 days' <= NOW()
RETURNING *;

-- name: WorkerDueForReverifyChallenge :many
SELECT s.* FROM hub_employer_stints s
LEFT JOIN hub_work_email_reverify_challenges c ON c.stint_id = s.stint_id
WHERE s.status = 'active'
  AND s.last_verified_at + INTERVAL '365 days' <= NOW()
  AND c.stint_id IS NULL
LIMIT @limit_count;

-- name: UpsertReverifyChallenge :one
INSERT INTO hub_work_email_reverify_challenges (stint_id, challenge_code_hash, expires_at)
VALUES (@stint_id, @challenge_code_hash, @expires_at)
ON CONFLICT (stint_id) DO UPDATE
SET challenge_code_hash = EXCLUDED.challenge_code_hash,
    issued_at           = NOW(),
    expires_at          = EXCLUDED.expires_at,
    attempts            = 0
RETURNING *;

-- name: GetReverifyChallenge :one
SELECT * FROM hub_work_email_reverify_challenges WHERE stint_id = @stint_id;

-- name: DeleteReverifyChallenge :exec
DELETE FROM hub_work_email_reverify_challenges WHERE stint_id = @stint_id;

-- name: IncrementPendingCodeAttempts :one
UPDATE hub_employer_stints
SET pending_code_attempts = pending_code_attempts + 1,
    pending_code_locked_until = CASE
      WHEN pending_code_attempts + 1 >= 3 THEN NOW() + INTERVAL '10 minutes'
      ELSE pending_code_locked_until
    END,
    updated_at = NOW()
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id
RETURNING *;

-- name: RotatePendingCode :one
UPDATE hub_employer_stints
SET pending_code_hash      = @pending_code_hash,
    pending_code_expires_at= @pending_code_expires_at,
    pending_code_attempts  = 0,
    pending_code_locked_until = NULL,
    pending_code_resends_today = pending_code_resends_today + 1,
    pending_code_last_resent_at = NOW(),
    updated_at             = NOW()
WHERE stint_id = @stint_id AND hub_user_id = @hub_user_id AND status = 'pending_verification'
RETURNING *;

-- name: ListPublicEmployerStintsByHandle :many
SELECT s.domain,
       (s.status = 'active') AS is_current,
       EXTRACT(YEAR FROM s.first_verified_at)::int AS start_year,
       CASE WHEN s.status = 'ended' THEN EXTRACT(YEAR FROM s.ended_at)::int ELSE NULL END AS end_year,
       s.first_verified_at, s.ended_at
FROM hub_employer_stints s
JOIN hub_users u ON u.hub_user_id = s.hub_user_id
WHERE u.handle = @handle
  AND s.status IN ('active','ended')
ORDER BY (s.status = 'active') DESC,
         COALESCE(s.first_verified_at, s.created_at) DESC;
```

In `api-server/db/global/queries/hub_work_email_index.sql`:

```sql
-- name: ClaimWorkEmailGlobal :one
INSERT INTO hub_work_email_index (email_address_hash, hub_user_global_id, region, status)
VALUES (@email_address_hash, @hub_user_global_id, @region, @status)
ON CONFLICT (email_address_hash) DO NOTHING
RETURNING *;

-- name: PromoteWorkEmailGlobalToActive :one
UPDATE hub_work_email_index
SET status = 'active', updated_at = NOW()
WHERE email_address_hash = @email_address_hash AND hub_user_global_id = @hub_user_global_id
RETURNING *;

-- name: ReleaseWorkEmailGlobal :exec
DELETE FROM hub_work_email_index
WHERE email_address_hash = @email_address_hash AND hub_user_global_id = @hub_user_global_id;
```

In `api-server/db/global/queries/personal_domain_blocklist.sql`:

```sql
-- name: ListBlockedPersonalDomains :many
SELECT * FROM personal_domain_blocklist
WHERE (sqlc.narg('filter_prefix')::text IS NULL
       OR domain LIKE sqlc.narg('filter_prefix')::text || '%')
  AND (@cursor_domain::text IS NULL OR domain > @cursor_domain)
ORDER BY domain ASC
LIMIT @limit_count;

-- name: AddBlockedPersonalDomain :one
INSERT INTO personal_domain_blocklist (domain, created_by_admin_user_id)
VALUES (@domain, @admin_user_id)
RETURNING *;

-- name: RemoveBlockedPersonalDomain :exec
DELETE FROM personal_domain_blocklist WHERE domain = @domain;

-- name: IsDomainBlocked :one
SELECT EXISTS (SELECT 1 FROM personal_domain_blocklist WHERE domain = @domain) AS blocked;
```

### Backend

Handlers in `api-server/handlers/hub/work_emails.go` and `api-server/handlers/admin/personal_domain_blocklist.go`. All Hub handlers use `OrgAuth`-equivalent `HubAuth` middleware (active session required, no role check). Admin handlers use `AdminAuth` + `AdminRole(s.Global, "admin:manage_personal_domain_blocklist")`.

#### Endpoints

| Method | Path                                    | Handler file                                  | Auth + role                                            |
| ------ | --------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| POST   | `/hub/add-work-email`                   | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/verify-work-email`                | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/resend-work-email-code`           | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/reverify-work-email`              | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/remove-work-email`                | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/list-my-work-emails`              | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/get-my-work-email`                | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/hub/list-public-employer-stints`      | `handlers/hub/work_emails.go`                 | `HubAuth`                                              |
| POST   | `/admin/list-blocked-personal-domains`  | `handlers/admin/personal_domain_blocklist.go` | `AdminAuth` + `admin:manage_personal_domain_blocklist` |
| POST   | `/admin/add-blocked-personal-domain`    | `handlers/admin/personal_domain_blocklist.go` | `AdminAuth` + `admin:manage_personal_domain_blocklist` |
| POST   | `/admin/remove-blocked-personal-domain` | `handlers/admin/personal_domain_blocklist.go` | `AdminAuth` + `admin:manage_personal_domain_blocklist` |

#### Handler implementation notes

- **`add-work-email`** flow:
  1. Decode + validate the request body. Reject empty / overlong / unparseable email with 400.
  2. Lower-case both the local-part and domain. (Local-case-folding is fine for our purposes; we treat the email as case-insensitive.)
  3. Compute `email_address_hash = SHA-256(lower(email))` and split out `domain`.
  4. Single global-DB read: `IsDomainBlocked(domain)`. If true, return 422.
  5. Cross-DB write per CLAUDE.md ("global first, then regional"):
     - Global tx: `ClaimWorkEmailGlobal(hash, hub_user_global_id, region, 'pending_verification')`. If RETURNING is empty (conflict), check who owns it: if it's the same caller in `pending_verification`, return 409 with sentinel `EMAIL_ALREADY_PENDING_FOR_YOU`; otherwise 409 `EMAIL_HELD_BY_ANOTHER_USER`.
     - Regional tx (`s.WithRegionalTx`): `CountActiveOrPendingStintsForUser` first; if `>= 50`, abort and return 422. Otherwise `CreateWorkEmailStint(hub_user_id, lower(email), hash, domain, code_hash, NOW()+24h)`. Enqueue an outbox email row. Write `audit_logs` row with `event_type = 'hub.add_work_email'`, `event_data = {stint_id, email_address_hash, domain}`. Commit.
     - On regional-tx failure: compensate by `ReleaseWorkEmailGlobal(hash, hub_user_global_id)` and log `CONSISTENCY_ALERT` if compensation also fails.
  6. Return 201 `{ stint_id, pending_code_expires_at }`.
- **`verify-work-email`** flow (single regional tx):
  1. `GetWorkEmailStintByID(stint_id, hub_user_id)`. 404 if not found.
  2. If status != `pending_verification` or `pending_code_locked_until > NOW()`: 422.
  3. If `pending_code_expires_at <= NOW()`: 422.
  4. `bcrypt.CompareHashAndPassword(stint.pending_code_hash, code)`. If mismatch: `IncrementPendingCodeAttempts`, return 422.
  5. `VerifyWorkEmailStint(stint_id, hub_user_id)` — flips to active.
  6. `SupersedePriorActiveStintAtDomain(hub_user_id, domain, superseding_stint_id = stint_id)` — hard-end any other active stint at same domain.
  7. Global tx in same logical operation: `PromoteWorkEmailGlobalToActive(hash, hub_user_global_id)`. (Global mirror's status flips from `pending_verification` to `active`.) Note: per CLAUDE.md, do not perform >1 round-trip per logical DB; here the regional tx already encompasses verify + supersede + audit; the global update is a single round-trip.
  8. Audit: `hub.verify_work_email`. If a supersede happened, also `hub.supersede_work_email_stint`.
  9. Return 200 with the updated stint (owner view).
- **`resend-work-email-code`** flow (single regional tx):
  1. `GetWorkEmailStintByID`. 404 if not found.
  2. If status != pending: 422.
  3. Rate-limit check: if `pending_code_last_resent_at > NOW() - 60s`: 429 `RATE_LIMITED_RESEND`. If `pending_code_resends_today >= 5` and a daily worker hasn't reset it: 429 `DAILY_RESEND_LIMIT`.
  4. Generate fresh code; `RotatePendingCode(stint_id, code_hash, NOW()+24h)`.
  5. Enqueue outbox email row.
  6. Audit: `hub.resend_work_email_code`.
  7. Return 200 with stint (owner view).
- **`reverify-work-email`** flow (single regional tx):
  1. `GetWorkEmailStintByID`. 404.
  2. If status != active: 422.
  3. `GetReverifyChallenge(stint_id)`. If null: 422.
  4. If `expires_at <= NOW()`: 422.
  5. bcrypt-compare against `challenge_code_hash`. Mismatch: increment attempts; if attempts >= 3, delete challenge (forces worker to re-issue, or admin intervention); 422.
  6. On match: `ReverifyWorkEmailStint(stint_id, hub_user_id)` and `DeleteReverifyChallenge(stint_id)`.
  7. Audit: `hub.reverify_work_email`.
  8. Return 200.
- **`remove-work-email`** flow (single regional tx, plus global release):
  1. `GetWorkEmailStintByID`. 404.
  2. `EndWorkEmailStintByUser` — returns the row with `ended_reason` set to either `user_removed_pending` or `user_removed` based on prior status. If no row updated → 422 (already ended).
  3. Global tx: `ReleaseWorkEmailGlobal(hash, hub_user_global_id)`.
  4. Delete any reverify-challenge row.
  5. Audit: `hub.remove_work_email`.
  6. Return 200 with the now-ended stint (owner view).
- **`list-my-work-emails`** flow: single regional read with sqlc query above. Decode keyset cursor (base64 of `status_priority|created_at|stint_id`). Limit defaults to 25, max 100.
- **`get-my-work-email`**: single regional read; 404 on not-owned / not-found.
- **`list-public-employer-stints`**: cross-region routing — handle is on a HubUser whose home region is determined by global lookup. The handler uses `s.GetRegionalDB(region)` after one global read on `hub_users` to find the region, then runs `ListPublicEmployerStintsByHandle` against that region. Returns 200 + empty list when handle unknown (avoid enumeration).
- **Admin handlers**: list paginates, add returns 201 (or 409 if exists), remove returns 204 (or 404 if absent). Audit events `admin.add_blocked_personal_domain` / `admin.remove_blocked_personal_domain` written to `admin_audit_logs` (global) inside the same tx.

#### Outbox emails

Two new templates rendered in `api-server/internal/email/templates/`:

1. `work_email_verification_code.{subject,html,text}.tmpl` — with placeholders `{{.Code}}`, `{{.ExpiresAt}}`, `{{.HubUserDisplayName}}`, `{{.Domain}}`.
2. `work_email_reverify_challenge.{subject,html,text}.tmpl` — same placeholders.

The outbox email row is INSERTed inside the same regional tx as the stint write. The existing outbox-worker dispatches it to the SMTP gateway.

### Workers

Two new workers in `api-server/cmd/regional-worker/`:

#### `expire_pending_work_emails.go`

- Runs every 30 minutes.
- One iteration:
  1. `WorkerExpirePendingStints` — flips all pending stints whose code_expires_at has elapsed to `ended` with `verification_expired`.
  2. For each row affected, in parallel: `ReleaseWorkEmailGlobal(hash, hub_user_global_id)` against the global DB.
  3. Per-row audit `hub.expire_work_email_pending` written inside the original regional tx (collected as a batch and inserted before commit).
  4. Reset the `pending_code_resends_today` counter on any `pending_verification` row whose `pending_code_last_resent_at < NOW() - 24h`.

#### `manage_active_work_emails.go`

- Runs every 6 hours.
- Two passes per iteration:
  1. **Issue re-verify challenges**: `WorkerDueForReverifyChallenge(limit=500)`. For each stint, generate a 6-digit code (24h TTL), `UpsertReverifyChallenge`, enqueue outbox email, write `hub.issue_work_email_reverify_challenge` audit row. All inside the same regional tx for that stint.
  2. **End reverify timeouts**: `WorkerEndReverifyTimeoutStints` — flips active stints where `last_verified_at + 395d <= NOW()` to `ended` with `reverify_timeout`. For each row, `ReleaseWorkEmailGlobal` and audit `hub.end_work_email_reverify_timeout`.

Both workers run per-region (the framework already runs the regional worker as N processes — one per region — using a shared codebase).

### Frontend

#### New Routes

| Portal   | Route path                              | Page component                                       |
| -------- | --------------------------------------- | ---------------------------------------------------- |
| hub-ui   | `/settings/work-emails`                 | `src/pages/WorkEmails/WorkEmailsListPage.tsx`        |
| hub-ui   | `/settings/work-emails/:stintId`        | `src/pages/WorkEmails/WorkEmailDetailPage.tsx`       |
| hub-ui   | `/settings/work-emails/:stintId/verify` | `src/pages/WorkEmails/EnterVerificationCodePage.tsx` |
| admin-ui | `/personal-domain-blocklist`            | `src/pages/PersonalDomainBlocklistPage.tsx`          |

#### Implementation notes

- Standard feature page layout (maxWidth 1200, back-to-Settings button, Title level 2, no outer Card).
- `WorkEmailsListPage` uses Ant Design `Table` with status segmented filter, "Add Work Email" primary button (always available), per-row contextual actions described in the Stage-1 Screens section.
- "Add Work Email" opens a Modal with one input. On submit calls `add-work-email`, on success navigates to `/settings/work-emails/:stintId/verify`.
- `EnterVerificationCodePage` has a 6-input OTP component, "Resend code" link (disabled for 60s after most-recent send), and a "Cancel and remove" button.
- `WorkEmailDetailPage` shows the owner-view sidebar with status badges; renders a "Re-verify" button when a challenge is issued; on click opens an OTP modal.
- Wrap network calls with `<Spin>` to prevent double-submit. Disable submit while form has validation errors.
- Public widget on profile pages renders a small Ant Design `Table` (Domain, Period). The widget is OWNED by the hub-profile spec; this spec only ships the API and the WorkEmail-related UI under `/settings/`.

### RBAC

#### New roles (admin only)

All four locations must be kept in sync:

- `specs/typespec/common/roles.ts` — append `admin:manage_personal_domain_blocklist` to `VALID_ROLE_NAMES`
- `specs/typespec/common/roles.go` — append matching constant
- `specs/typespec/admin/admin-users.ts` and `.go` — add `AdminRoleManagePersonalDomainBlocklist` constant
- `api-server/db/migrations/global/00000000000001_initial_schema.sql` — add INSERT into `roles`

| Role name                                | Portal | Description                                                                                 |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `admin:manage_personal_domain_blocklist` | admin  | Add/remove entries in the personal-email-domain blocklist used by Hub work-email validation |

#### Existing roles reused

- `admin:superadmin` (bypasses).
- No new Hub role; HubAuth + active session is sufficient.

### i18n

Add `hub-ui/src/locales/{en-US,de-DE,ta-IN}/workEmails.json`.

```json
{
	"title": "Work Emails",
	"backToSettings": "Back to Settings",
	"addWorkEmail": "Add Work Email",
	"filter": {
		"all": "All",
		"active": "Active",
		"pending": "Pending",
		"ended": "Ended"
	},
	"table": {
		"emailAddress": "Email Address",
		"domain": "Domain",
		"status": "Status",
		"verifiedSince": "Verified Since",
		"lastVerified": "Last Verified",
		"reverifyDue": "Re-verify Due",
		"actions": "Actions",
		"enterCode": "Enter Code",
		"resendCode": "Resend Code",
		"reverify": "Re-verify",
		"remove": "Remove"
	},
	"status": {
		"pendingVerification": "Pending verification",
		"active": "Active",
		"ended": "Ended"
	},
	"addModal": {
		"title": "Add a work email",
		"emailLabel": "Work email address",
		"submit": "Send Verification Code",
		"personalDomainError": "This domain is on our personal-email blocklist. Please use the email at your employer.",
		"alreadyHeldError": "This email is already in use by another HubUser."
	},
	"verifyPage": {
		"title": "Enter the 6-digit code",
		"subtitle": "We sent a code to {{email}}. The code expires in 24 hours.",
		"submit": "Verify",
		"resend": "Resend code",
		"cancel": "Cancel and remove",
		"wrongCodeError": "That code didn't match. Please try again."
	},
	"removeConfirm": "Remove this work email? You can always re-add it later, but doing so will require a fresh verification.",
	"success": {
		"added": "Verification code sent. Check your inbox.",
		"verified": "Work email verified.",
		"resent": "A fresh code has been sent.",
		"reverified": "Re-verified successfully.",
		"removed": "Work email removed."
	},
	"errors": {
		"loadFailed": "Failed to load your work emails.",
		"addFailed": "Could not add this work email.",
		"verifyFailed": "Could not verify this work email.",
		"resendFailed": "Could not resend the code.",
		"removeFailed": "Could not remove this work email.",
		"reverifyFailed": "Could not re-verify this work email."
	}
}
```

Mirror the keys (with placeholder English strings) in `de-DE/workEmails.json` and `ta-IN/workEmails.json`.

For the admin blocklist UI: `admin-ui/src/locales/{en-US,de-DE,ta-IN}/personalDomainBlocklist.json` with keys: `title`, `backToDashboard`, `addDomain`, `domain`, `createdAt`, `addModal.title`, `addModal.submit`, `removeConfirm`, `success.{added,removed}`, `errors.{loadFailed,addFailed,removeFailed,exists}`.

### Test Matrix

Tests in `playwright/tests/api/hub/work-emails.spec.ts` and `playwright/tests/api/admin/personal-domain-blocklist.spec.ts`. All types imported from `vetchium-specs/hub/work-emails` and `vetchium-specs/admin/personal-domain-blocklist`.

New test helpers in `playwright/lib/db.ts`:

- `addPersonalDomainBlocklistEntry(domain)` / `removePersonalDomainBlocklistEntry(domain)`
- `createTestWorkEmailStintDirect(hubUserId, email, status='active')` — bypasses the API for setup.
- `setStintLastVerifiedAt(stintId, dateTime)` / `setStintPendingCodeExpiresAt(stintId, dateTime)` — manipulate clock state for worker tests.
- `expireWorkEmailReverifyChallenge(stintId)` / `setStintEnded(stintId, endedReason)`.

Add to `playwright/lib/hub-api-client.ts`:

- `addWorkEmail`, `addWorkEmailRaw`
- `verifyWorkEmail`, `verifyWorkEmailRaw`
- `resendWorkEmailCode`, `resendWorkEmailCodeRaw`
- `reverifyWorkEmail`, `reverifyWorkEmailRaw`
- `removeWorkEmail`, `removeWorkEmailRaw`
- `listMyWorkEmails`, `listMyWorkEmailsRaw`
- `getMyWorkEmail`, `getMyWorkEmailRaw`
- `listPublicEmployerStints`, `listPublicEmployerStintsRaw`

#### Hub endpoint scenarios

| Endpoint                    | Scenario                                                  | Expected                                                                                     |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| add-work-email              | Success — valid corporate email                           | 201 + stint_id + pending_code_expires_at                                                     |
| add-work-email              | Personal-domain rejection (gmail.com)                     | 422                                                                                          |
| add-work-email              | Address held by another HubUser (active)                  | 409                                                                                          |
| add-work-email              | Caller already holds in pending                           | 409                                                                                          |
| add-work-email              | Caller already holds in active                            | 409                                                                                          |
| add-work-email              | Stint cap (50) reached                                    | 422                                                                                          |
| add-work-email              | Caller already has an active stint at the same DOMAIN     | 201 — new pending stint created; the active one is unaffected until verify                   |
| add-work-email              | Validation: empty email                                   | 400                                                                                          |
| add-work-email              | Validation: malformed email                               | 400                                                                                          |
| add-work-email              | Unauthenticated                                           | 401                                                                                          |
| add-work-email              | Audit: `hub.add_work_email` row written                   | 1 entry with hashed email + domain in event_data                                             |
| add-work-email              | No audit on 4xx                                           | count unchanged                                                                              |
| verify-work-email           | Success                                                   | 200 + status=active + first_verified_at + last_verified_at                                   |
| verify-work-email           | Wrong code                                                | 422; pending_code_attempts incremented                                                       |
| verify-work-email           | 3rd wrong attempt locks the stint                         | 422; subsequent verify within lock window also returns 422 even with correct code            |
| verify-work-email           | Expired code                                              | 422                                                                                          |
| verify-work-email           | Stint owned by someone else                               | 404                                                                                          |
| verify-work-email           | Stint not in pending                                      | 422                                                                                          |
| verify-work-email           | Supersedes a prior active stint at the same domain        | 200; the old stint flips to ended/superseded; audit `hub.supersede_work_email_stint` written |
| verify-work-email           | Audit: `hub.verify_work_email` row written                | 1 entry                                                                                      |
| resend-work-email-code      | Success                                                   | 200; new code emailed; old code invalidated                                                  |
| resend-work-email-code      | Within 60s                                                | 429                                                                                          |
| resend-work-email-code      | 6th send in 24h                                           | 429                                                                                          |
| resend-work-email-code      | Stint not pending                                         | 422                                                                                          |
| reverify-work-email         | Success when challenge issued                             | 200; last_verified_at advances; challenge row deleted                                        |
| reverify-work-email         | No active challenge                                       | 422                                                                                          |
| reverify-work-email         | Challenge expired                                         | 422                                                                                          |
| reverify-work-email         | Wrong code                                                | 422; attempts incremented                                                                    |
| remove-work-email           | Success on pending                                        | 200; ended_reason=user_removed_pending                                                       |
| remove-work-email           | Success on active                                         | 200; ended_reason=user_removed; reverify-challenge cleaned up if any                         |
| remove-work-email           | Already ended                                             | 422                                                                                          |
| remove-work-email           | Removed email is reusable by another HubUser              | (separate test) the second user can add+verify the same address                              |
| list-my-work-emails         | Success                                                   | 200; sorted active→pending→ended, then by created_at DESC                                    |
| list-my-work-emails         | filter_status=active only                                 | 200; only active rows returned                                                               |
| list-my-work-emails         | filter_domain                                             | 200; only matching domain returned                                                           |
| list-my-work-emails         | Pagination                                                | 200; next_pagination_key returned when more rows; second page fetched correctly              |
| get-my-work-email           | Success                                                   | 200                                                                                          |
| get-my-work-email           | Stint owned by someone else                               | 404                                                                                          |
| list-public-employer-stints | Success — known handle with active and ended stints       | 200; pending_verification stints excluded; year-range correct                                |
| list-public-employer-stints | Unknown handle                                            | 200; empty list                                                                              |
| list-public-employer-stints | Cross-region (handle's home region differs from caller's) | 200; correct region used                                                                     |
| (any)                       | Unauthenticated                                           | 401                                                                                          |

#### Worker scenarios

| Worker                              | Scenario                                                          | Expected                                                                 |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| expire_pending_work_emails          | Pending stint with code_expires_at in past                        | flipped to ended/verification_expired; global mirror released; audit hit |
| expire_pending_work_emails          | Pending stint within TTL                                          | untouched                                                                |
| expire_pending_work_emails          | Resends-today counter reset after 24h                             | counter resets to 0                                                      |
| manage_active_work_emails (issue)   | Active stint at last_verified_at + 365d, no challenge             | challenge row created; outbox email enqueued; audit row written          |
| manage_active_work_emails (issue)   | Active stint at last_verified_at + 365d, challenge already exists | no duplicate; existing challenge survives                                |
| manage_active_work_emails (timeout) | Active stint at last_verified_at + 396d                           | flipped to ended/reverify_timeout; mirror released; audit hit            |
| manage_active_work_emails (timeout) | Active stint at last_verified_at + 380d                           | untouched                                                                |

#### Admin endpoint scenarios

| Endpoint                       | Scenario                                                                                       | Expected                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| list-blocked-personal-domains  | Success                                                                                        | 200 + array                     |
| list-blocked-personal-domains  | filter_domain_prefix                                                                           | 200 + filtered                  |
| add-blocked-personal-domain    | Success                                                                                        | 201                             |
| add-blocked-personal-domain    | Already exists                                                                                 | 409                             |
| add-blocked-personal-domain    | Validation: empty domain                                                                       | 400                             |
| add-blocked-personal-domain    | RBAC negative (no role)                                                                        | 403                             |
| add-blocked-personal-domain    | RBAC positive (`admin:manage_personal_domain_blocklist`)                                       | 201                             |
| add-blocked-personal-domain    | Adding a domain after a Hub user already has an active stint at it does NOT auto-end the stint | the existing stint stays active |
| remove-blocked-personal-domain | Success                                                                                        | 204                             |
| remove-blocked-personal-domain | Not found                                                                                      | 404                             |
| remove-blocked-personal-domain | Audit: `admin.remove_blocked_personal_domain`                                                  | row in admin_audit_logs         |
| Effect on Hub validation       | Domain present in blocklist blocks `add-work-email`                                            | Hub returns 422                 |
| Effect on Hub validation       | After remove from blocklist, Hub `add-work-email` succeeds                                     | 201                             |

### Out-of-spec dependencies (forward links)

- **hub-connections** uses `hub_employer_stints` (active rows by default; ended rows when computing eligibility 6+7) directly via internal queries inside its own handlers. The eligibility query is intra-region for both A and B (since hub-connections is region-bound to the caller's region). The cross-region edge cases live with the hub-connections worker / cross-region resolver.
- **hub-job-applications (future)** will gate endorsement-eligibility on stints whose `(domain, [first_verified_at, last_verified_at])` overlap the applicant's stints at the same domain — i.e. the same query shape that hub-connections uses.
- **hub-profile** (`specs/hub-profile/README.md`) renders the public-stints widget on profile pages by calling `list-public-employer-stints`.

This spec ships everything implementation needs: TypeSpec, regional + global schema, sqlc queries, handler step lists, two workers, RBAC roles, i18n keys, and a full test matrix. A Haiku-tier implementer can follow this in order without spec re-interpretation.
