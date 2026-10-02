# Global Uniqueness of Hub Emails — Implementation Plan

> **Partly superseded** by [`frontend-consolidation.md`](frontend-consolidation.md):
> the Hub and Orgs portals are now one global site each, the browser picks the
> region from a compiled-in table instead of a discovery API, the region
> catalog no longer carries portal URLs, and homed-elsewhere problems carry
> only `tenant_id` (no `hub_url` or `orgs_url`). Where this document says
> otherwise, that document and `agent-guides/` win.

Status: implemented on branch `cleanup/global-uniqueness`; §9 is the ledger
and §10 records deviations and review fixes.

This document is self-contained. An implementer with no prior conversation
context should be able to finish the work from it plus the repository. Read
`AGENTS.md` and every guide it routes to for the files you touch (at minimum
`change-design.md`, `review.md`, `verification.md`, `go.md`, `backend.md`,
`database.md`, `federation.md`, `typespec.md`, `typescript.md`, `ui.md`,
`playwright.md`, `hub-signup.md`, `hub-profile.md`) before changing code.

## 1. Goal and scope

Today a Hub account email is unique only inside one tenant
(`hub_users.email_address` has a tenant-local unique constraint), and
`agent-guides/hub-signup.md` says "The same email may identify independent
accounts in different tenants". Verified professional (work) emails are unique
only per Hub user.

After this change:

| Identifier | Uniqueness | Status |
| --- | --- | --- |
| Org domain | global, one Org | already done (`org_domains` in the global DB) |
| Org user email | per Org | unchanged, beyond argument |
| Hub account email | **global**, one Hub user | this plan |
| Verified professional email | per Hub user | **dropped**, see below |
| Hub handle / alias | global | already done |

**Dropped: global uniqueness of verified professional (work) emails.**
Implemented in M1/M2/M5, then reverted after product review. Recorded here
rather than deleted so a future session does not re-derive and re-implement
it. Rationale:

- Agencies searching by employer only ever see the verified domain, never the
  address (PROF-WEM-011); a global claim protected an address no authorized
  reader can see.
- Verification evidence is explicitly a dated record of past mailbox control
  that the owner is prompted to refresh yearly (PROF-WEM-007..009), not a
  live identity assertion; global "only one holder at a time" semantics do
  not match that model.
- Duplicate verification of the same mailbox or domain by unrelated accounts
  is an abuse-detection concern, not an identity invariant. It belongs to a
  later admin feature that flags and blocks abused domains or addresses
  (see `docs/todo.md`), which can act on all holders at once rather than
  forcing a single transfer.
- The global claim, its per-tenant supersession feed, and the periodic
  holdings sweep cost meaningfully more (a new global table set, a pull-feed
  protocol, two extra workers per tenant) than the property was worth once
  the above was considered.

Per-user professional-email verification and its existing local uniqueness
constraint (`hub_professional_emails`, one verified address per user per
normalized domain) are unchanged and outside this plan's scope either way.

Out of scope, listed in `docs/todo.md` by this work:

- **Hub login redirect to the home region.** It is deliberately not built. For
  Orgs the domain is public, so a homed-elsewhere answer leaks nothing. For Hub,
  an unauthenticated "this email lives in region X" answer would be an
  account-enumeration oracle. Only flows where the caller has proven control of
  the mailbox (a signup link, an emailed notice) may reveal the home region.
- **Hub account deletion.** It does not exist yet. When it is built it must
  release the account-email claim. Add a todo line.
- **Digest key rotation.** Build the key id hook (GU-KEY-004) but not a rotation
  procedure.
- Tenant-to-tenant outbox delivery (none exists today; not needed by anything
  this plan still implements, since the professional-email supersession feed
  that would have used it was dropped — see §1).

There is no production data to migrate. The Org signup work edited
`db/migrations/00001_init.sql` and `db/global-migrations/00001_init.sql` in
place, and this plan does the same. Development and CI databases are
disposable. Seeded Hub users are created through the signup API by
`backend/cmd/dev-seed`, so they acquire claims automatically. There is no
backfill.

## 2. Decisions (fixed; do not re-litigate)

1. **The global directory stores keyed digests, never addresses.** The
   coordinator stores no tenant-owned business data or personal data
   (`federation.md`), so it cannot hold email addresses. It holds only
   `HMAC-SHA256(identity_digest_key, label || normalized_address)`. A plain
   SHA-256 would be dictionary-reversible. The key is shared by every tenant and
   **never** mounted into the global coordinator or mesh-api.
2. **Namespaces are separated.** An account-email digest and a
   professional-email digest of the same address differ (different labels), so
   the global DB cannot correlate a person's account and work addresses. An
   address may therefore be one user's account email and another user's (or
   the same user's) professional email. That is allowed.
3. **Normalization is the existing canonical form**: `lower(btrim(address))`,
   exactly what the current DB `CHECK` constraints enforce. There is no Gmail
   dot or plus folding. Go must produce byte-identical output. Add a test.
4. **Signup collision:**
   - At *request* time the response stays the generic `202` (no enumeration).
     If the address is homed in another tenant, the email sent is "you already
     have an account in region X — sign in there" instead of a signup link.
   - At *completion* time the caller has proven mailbox control, so a
     conflict returns `409` with the home region's Hub URL.
5. **Email change** claims the new digest globally before the local change and
   releases the old digest after it. This uses a durable operation modeled on
   the alias-change saga (`202` `PendingOperation` when the outcome is
   uncertain). The address stays claimed by the user until the change is final.
6. **Professional email uniqueness: dropped.** Originally specified as
   "newest proof of control wins" with a transferable global claim (a
   verification by user B of an address user A held would supersede A's
   evidence). Implemented in M1/M2/M5, then reverted per product decision;
   see §1's "Dropped" note for the rationale. Per-user professional-email
   verification, and its existing local (per-user, per-domain) uniqueness
   constraint, are unaffected.
7. **Fail closed.** No claim-dependent write completes locally without the
   directory's definite answer. The directory being unreachable yields `202`
   pending (after local state is durable) or a retryable `503` (before anything
   durable exists), per `federation.md`. In CI, `ind1` cannot reach the
   coordinator; use it to test this.
8. **Privacy of logs and audit:** complete addresses and digests never appear in
   audit payloads, outbox or mesh payload logs, `last_error`, or structured logs.
   Mesh request bodies carry digests and are not logged. Global audit
   `entity_id` for claim rows is the Hub user DID, never the digest.

## 3. Requirements

Requirement ids are for the ledger (§9) and test names.

### 3.1 Digest key

- **GU-KEY-001:** New secret `identity_digest_key` (file), read by
  `appconfig.IdentityDigestSecret()` from `IDENTITY_DIGEST_KEY_FILE`, default
  `/run/secrets/identity_digest_key`. Mirror `HubCredentialSecret()` in
  `backend/internal/appconfig/config.go`, including the empty-file rejection in
  `credentialSecret`.
- **GU-KEY-002:** The secret is mounted into every tenant's `hub-api` and
  `workers`, and nowhere else. It is **not** mounted into orgs-api, admin-api,
  mesh-api, mcp-server, or global-coordinator. Add an architecture test, next to
  `backend/internal/architecture/portal_boundaries_test.go`, asserting that
  `backend/cmd/global-coordinator` and `backend/cmd/mesh-api` do not
  transitively import `backend/internal/identitydigest`.
- **GU-KEY-003:** New package `backend/internal/identitydigest`:
  - `type Key` holds 32 bytes derived from the secret string. Derive it the same
    way the credential secrets are turned into keys (see
    `credentials`/`auth.DeriveCredentialSubkey`), with its own purpose string.
  - `func (k Key) HubAccountEmail(address string) []byte`
  - `func (k Key) HubProfessionalEmail(address string) []byte`
  - `func (k Key) ID() string`
  - `func Normalize(address string) string`

  Digest = `HMAC-SHA256(key, "vetchium/identity-digest/v1/" + namespace + "\x00" + Normalize(address))`,
  where namespace is `hub-account-email` or `hub-professional-email`. Unit
  tests must cover:
  - fixed vectors
  - namespace separation
  - normalization (`"  A@B.Example "` → `"a@b.example"`)
  - Normalize matching what the DB check accepts
- **GU-KEY-004:** `Key.ID()` = the lowercase hex of the first 8 bytes of
  `HMAC-SHA256(key, "vetchium/identity-digest/key-id/v1")`.
  - Every directory request that carries a digest also carries
    `digest_key_id`.
  - The coordinator config (`config/global-coordinator.json`, CI and deploy
    copies) gets `identity_digest_key_id`.
  - The coordinator rejects a mismatch with a new problem,
    `directory-digest-key-mismatch` (409). A tenant configured with a different
    key would otherwise silently break uniqueness.
  - The id reveals nothing about any address.
- **GU-KEY-005:** Wiring:
  - `Makefile`: add `IDENTITY_DIGEST_KEY ?= dev_identity_digest_key` and
    `IDENTITY_DIGEST_KEY_FILE := $(DEV_SECRETS_DIR)/identity_digest_key`, and
    write the file in the dev-secrets target the same way as `HUB_KEY_FILE`.
  - `docker-compose.json` and `docker-compose-ci.json`: add the top-level secret
    and mount it in each tenant's hub-api and workers (search for the existing
    `hub_credential_key` mounts to find the services).
  - Update the `Tiltfile` if it enumerates secrets.
  - Put the dev key id (computed from `dev_identity_digest_key`) in the
    coordinator configs.
  - Production (`deploy/Makefile`, `deploy/*/stack.json`, `deploy/README.md`):
    unlike the per-region credential keys, this value **must be identical in
    every region**. The Makefile must not `openssl rand` it per region. It
    requires `IDENTITY_DIGEST_KEY_FILE` to be supplied and creates
    `<region>_identity_digest_key` from it. Document the id computation for
    `deploy/global-coordinator` config.

### 3.2 Global schema (`db/global-migrations/00001_init.sql`)

- **GU-GDB-001:** Account email claims:

  ```sql
  CREATE TYPE vetchium.global_account_email_claim_state AS ENUM (
      'provisioning', 'active', 'pending_change'
  );

  CREATE TABLE vetchium.hub_account_email_claims (
      email_digest bytea PRIMARY KEY CHECK (octet_length(email_digest) = 32),
      hub_user_did uuid NOT NULL
          REFERENCES vetchium.hub_principals (hub_user_did) ON DELETE CASCADE,
      state vetchium.global_account_email_claim_state NOT NULL,
      command_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (updated_at >= created_at)
  );
  CREATE UNIQUE INDEX hub_account_email_claims_one_current
      ON vetchium.hub_account_email_claims (hub_user_did)
      WHERE state IN ('provisioning', 'active');
  CREATE UNIQUE INDEX hub_account_email_claims_one_pending_change
      ON vetchium.hub_account_email_claims (hub_user_did)
      WHERE state = 'pending_change';
  ```

  `ON DELETE CASCADE` lets the existing provisioning reaper remove the claim
  together with the reaped principal. The reaper's audit must say so; see
  GU-DIR-010.
- **GU-GDB-002:** A trigger `enforce_account_email_claim_transition` allows only
  these transitions:
  - `provisioning → active`, only when its principal is active
  - `pending_change → active`, only when the same user has no other current
    claim at that moment (finalize deletes the old claim first)
  - deletion

  It rejects changing `hub_user_did` or `email_digest`. Model it on
  `enforce_org_principal_transition`.
- **GU-GDB-002a:** Email-change reservations and their fences. A
  `pending_change` claim always belongs to exactly one reservation, identified
  by the tenant's local change id. A cancelled reservation stays as a tombstone,
  so a delayed reserve can never resurrect it:

  ```sql
  CREATE TYPE vetchium.global_email_change_reservation_state AS ENUM (
      'reserved', 'cancelled', 'finalized'
  );

  CREATE TABLE vetchium.hub_account_email_change_reservations (
      change_id uuid PRIMARY KEY,          -- the tenant's local operation id
      hub_user_did uuid NOT NULL
          REFERENCES vetchium.hub_principals (hub_user_did) ON DELETE CASCADE,
      -- NULL only on a tombstone written by an abandon that arrived before
      -- its reserve: the change id alone fences it.
      email_digest bytea CHECK (octet_length(email_digest) = 32),
      state vetchium.global_email_change_reservation_state NOT NULL,
      not_after timestamptz NOT NULL,      -- no reserve is accepted after this
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT hub_account_email_change_reservations_digest_check CHECK (
          state = 'cancelled' OR email_digest IS NOT NULL
      )
  );
  ```

  Add `change_id uuid NULL REFERENCES hub_account_email_change_reservations`
  to `hub_account_email_claims`, with
  `CHECK ((state = 'pending_change') = (change_id IS NOT NULL))`.

  Allowed reservation transitions:
  - `reserved → cancelled`
  - `reserved → finalized`
  - an abandon for an unknown `change_id` inserts a `cancelled` row directly,
    with a null `email_digest`; that tombstone is the fence. A
    `reserved → cancelled` transition keeps its digest.

  Terminal rows are pruned only after `not_after + 7 days`. By then the
  coordinator itself rejects any reserve for that change id, because it
  compares `not_after` with its own clock, so correctness does not depend on
  tenant clocks.
- **GU-GDB-003: dropped**, with global professional-email uniqueness itself
  (see §1's "Dropped" note for the full rationale). Would have added
  `hub_professional_email_claims`, `hub_professional_email_feed_cursors`, and
  `hub_professional_email_supersessions`, plus a per-tenant row-locked
  sequence allocator for the supersession feed (`UPDATE ... SET
  last_issued_seq = last_issued_seq + 1 ... RETURNING`, never an identity or
  sequence object, since Postgres hands those out independently of commit
  order). Implemented in M1/M2, reverted in the same change that dropped
  M5. The row-locked sequence allocation technique itself remains valid
  and documented for any future feed that needs the same ordering
  guarantee.
- **GU-GDB-004:** Every mutation of these tables happens inside
  `runCommand[R]` (`backend/internal/globaldirectory/service.go`), so the
  command ledger, `global_audit_events`, and `global_outbox_events` rows are
  written in the same transaction as the change. Nothing is ever written to
  them outside a command, except the reaper and prune jobs, which audit
  themselves.

### 3.3 Directory commands

Add these to `typespec/directory/directory.tsp`, both in `interface Operations`
(`/api/global-coordinator/directory/...`) and in `interface MeshOperations`
(`/mesh/directory/...`), with hand-written companions in
`typespec/directory/directory.go` and `.ts` and their tests
(`directory_test.go`, `directory.test.ts`). Follow `typespec.md`.

Implement each in four places:

1. A coordinator service method in the new
   `backend/internal/globaldirectory/hub_email.go`, using the generic
   `runCommand` / `mutation[R]` as in `org.go`.
2. The coordinator HTTP handler and route (see how `claim-org-domain` is routed
   in the global-coordinator routes).
3. A mesh relay handler and route in `backend/handlers/mesh/directory.go` and
   `backend/internal/routes/mesh_routes.go`, via the generic
   `relayRead`/`relayOutcome`.
4. A `backend/internal/directoryclient/client.go` method (generic
   `commandResult`).

Global queries go in the new `backend/internal/globaldb/queries/hub_email_directory.sql`.
Run `make sqlc`.

New coordinator problems go in `typespec/problem/global-coordinator/`:

| Problem type | Status | Meaning |
| --- | --- | --- |
| `directory-email-claim-conflict` | 409 | The digest is held by another user. It must be distinct from `directory-claim-conflict`, which the signup saga uses to rotate handles. |
| `directory-digest-key-mismatch` | 409 | `digest_key_id` differs from the configured id. |
| `directory-reservation-expired` | 409 | An email-change reserve arrived after its `not_after`, by the coordinator's clock. Definite, with no side effects. |
| `directory-reservation-cancelled` | 409 | An email-change reserve for a `change_id` that was already abandoned (tombstone). Definite, with no side effects. |

Every command checks the caller tenant against the principal's
`home_tenant_id` (`DirectoryCallerTenantMismatchError`) and requires an active
principal, except where stated otherwise.

- **GU-DIR-001 `resolve-hub-account-email`** (read):
  - Request `{email_digest, digest_key_id}`.
  - Returns `{home_tenant_id}` for a `provisioning` or `active` claim, or 404
    (`ErrNotFound`).
  - It never returns the DID.
- **GU-DIR-002 `reserve-hub-principal`** (extended): add required
  `account_email_digest` and `digest_key_id`.
  - In the same transaction as the principal and handle insert, insert a
    `provisioning` claim.
  - A primary-key violation on the claim returns
    `directory-email-claim-conflict`.
  - A handle collision still returns `directory-claim-conflict`.
  - Check the email first, so a doomed signup does not burn handle attempts.
- **GU-DIR-003 `activate-hub-principal`** (extended): in the same transaction,
  set the principal's `provisioning` claim to `active`.
- **GU-DIR-004 `reserve-hub-account-email-change`:**
  - Request `{command_id, change_id, hub_user_did, new_email_digest,
    not_after, digest_key_id}`.
  - Checks, in order, under a lock on the reservation row:
    - `now() > not_after` (coordinator clock): new definite problem
      `directory-reservation-expired`, with no side effects
    - the reservation row exists as `cancelled`: new definite problem
      `directory-reservation-cancelled`
    - the row exists as `reserved`/`finalized` for the same digest and user:
      success without a change
  - Otherwise, in one transaction, it:
    - cancels any other `reserved` reservation of this user and deletes its
      `pending_change` claim. The tenant allows only one live change per user,
      so another live reservation is necessarily stale.
    - inserts the reservation (`reserved`) and the `pending_change` claim
  - The digest held by anyone, including this user's own current claim,
    returns `directory-email-claim-conflict` and creates no reservation row.
    The tenant pre-checks "unchanged address" locally.
  - Audit `global_directory.hub_account_email_change_reserved`.
- **GU-DIR-005 `finalize-hub-account-email-change`:**
  - Request `{command_id, change_id, hub_user_did}`.
  - Requires the reservation to be `reserved`. It deletes the user's `active`
    claim, promotes the reservation's `pending_change` claim to `active`, and
    marks the reservation `finalized`, all in one transaction.
  - `finalized` already: success without a change.
  - `cancelled` or missing: `DirectoryStateConflictError`.
  - Audit `global_directory.hub_account_email_changed`.
- **GU-DIR-006 `abandon-hub-account-email-change`:**
  - Request `{command_id, change_id, hub_user_did, not_after}`.
  - `reserved`: mark it `cancelled` and delete its `pending_change` claim.
  - Missing: insert a `cancelled` tombstone with the given `not_after` and a
    null `email_digest`. The request deliberately carries no digest, because
    the change id alone fences the reservation. This fences a reserve that is
    still in flight: whichever arrives first, the address ends up unclaimed.
  - `cancelled`: success without a change.
  - `finalized`: `DirectoryStateConflictError`. The tenant never abandons
    after applying locally, so this means a bug; log it at error level.
  - Audit it only when a row changed.
- **GU-DIR-007..009, GU-DIR-011: dropped** with global professional-email
  uniqueness (§1). Would have been `claim-hub-professional-email`,
  `release-hub-professional-email`, `pull-hub-professional-email-supersessions`,
  and `check-hub-professional-email-holdings`. Implemented in M1/M2, reverted
  with M5.
- **GU-DIR-010 Reaper and prune:**
  - Extend the existing reservation reaper (`ReapExpiredHubPrincipalReservations`
    or its equivalent in `backend/internal/globaldb/queries`). Reaping a
    provisioning principal cascades its claim. Add `email_claim_released: true`
    to that audit payload.
  - Prune terminal `hub_account_email_change_reservations` older than
    `not_after + 7 days`, with a summary global audit event, run by the
    coordinator's existing periodic loop (find where the reaper is scheduled).
  - `pending_change` claims are **not** reaped by time. They leave only through
    finalize or abandon, and the tenant's durable operation always reaches one
    of them (GU-ECH-006).
  - (Its professional-email supersession-feed pruning and decommissioning
    bullets are dropped along with GU-DIR-009 above.)

### 3.4 Hub signup (tenant)

Files:

- `db/migrations/00001_init.sql`
- `backend/internal/db/queries/hub_signup.sql`
- `backend/internal/hub/signupcompletion/service.go`
- `backend/handlers/hub/auth/signup.go`
- `typespec/hub/auth/signup.*`
- `typespec/problem/hub/signup.*`
- `backend/internal/email/` (renderer and templates)
- `backend/internal/workers/deliver_hub_email.go`

Requirements:

- **GU-SIG-001:** Schema changes:
  - `hub_users.email_digest bytea NOT NULL UNIQUE CHECK (octet_length = 32)`.
  - `hub_signup_completions.account_email_digest bytea NOT NULL`.
  - `hub_signup_completions.failure_reason text` constrained to
    `('expired', 'email_registered_elsewhere')`, required exactly when
    `state = 'failed'`. Check how Org completions model `failure_reason` in the
    same file and match it; set `'expired'` in the existing abandon path.
  - `hub_signup_completions.conflicting_home_tenant_id text NULL`, with the
    tenant id regex.
- **GU-SIG-002 Request signup:**
  - Before running `CreateHubSignupRequest`, the handler computes the account
    digest and calls `resolve-hub-account-email` with a short timeout.
  - Pass the result to the statement as `registered_elsewhere_tenant_id`
    (nullable). It is null when the address is not found, when it resolves to
    this tenant, or when the directory call errored. The completion step fails
    closed anyway, so an errored resolve only degrades the email wording.
  - The statement keeps the local `existing_user` branch unchanged.
  - When not local and `registered_elsewhere_tenant_id` is set, it does not
    create a signup request. Instead, in the same statement, it:
    - queues a `hub_email_outbox` row of new kind `signup-registered-elsewhere`
      (add it to the `kind` `CHECK`) whose encrypted payload carries the home
      region's Hub sign-in URL, from `regions.Catalog`
    - audits `hub.signup.rejected` with
      `{reason: 'email_registered_elsewhere', home_tenant_id, resident_country}`
  - The HTTP response is the same `202` in every case.
- **GU-SIG-003:** Add the email kind to `backend/internal/email/renderer.go`
  with templates in all Hub locales (`en-US`, `de-DE`, `ta`, the
  `hub_frontend_locale` values). Validate the payload in the Hub delivery
  worker as `orgEmailKind` does for Org mail. The copy names the region and
  links to its sign-in page, and it never contains a signup link.
- **GU-SIG-004 Completion saga:**
  - `PrepareHubSignupCompletion` stores `account_email_digest`, computed by the
    service from the request's email. The service gets an
    `identitydigest.Key`.
  - `Advance`/`prepared` sends it with `digest_key_id` in `ReserveHubPrincipal`.
  - On `directory-email-claim-conflict`, which is distinct from the
    handle-rotation branch:
    - call `ResolveHubAccountEmail` for the home tenant (null on error)
    - run the new `FailHubSignupCompletionRegisteredElsewhere`, which in one
      statement:
      - sets `state = 'failed'`, `failure_reason`,
        `conflicting_home_tenant_id` and `completed_at`
      - deactivates the signup request
      - audits `hub.signup.rejected` with
        `{reason: 'email_registered_elsewhere', home_tenant_id}` (tenant id,
        source)
    - return the new `ErrRegisteredElsewhere{HomeTenantID}`
  - A replay of a failed completion with this reason returns the same error.
  - `ErrExpired` stays for `failure_reason = 'expired'`.
  - `createLocal` writes `hub_users.email_digest`.
  - A completion owns its signup request from prepare until it completes,
    fails, or is abandoned. `PrepareHubSignupCompletion` sets the request's
    `consumed_at` and leaves it active. `CreateHubSignupRequest` refuses to
    replace a consumed active request (same `202`, audited
    `hub.signup.rejected` `{reason: 'signup_completion_in_progress'}`, no
    mail). Completion, the registered-elsewhere failure, and abandonment each
    deactivate the request, so the address can sign up again.
    `CreateProvisioningHubUser` inserts no user unless it also deactivates the
    active request, so a user row never exists without its completion
    reaching `local_created`.
- **GU-SIG-005 Completion response:**
  - Add a `409` `HubAccountHomedElsewhereDetails` to `completeSignup`,
    modeled on `OrgHomedElsewhereDetails` in
    `typespec/problem/orgs/authentication.tsp`:
    - `type: "vetchium-problem-details/hub-account-homed-elsewhere"`
    - `tenant_id`
    - `hub_url`
  - `hub_url` comes from `regions.Catalog`. If the home tenant is unknown
    (the resolve failed), return the existing invalid-token problem instead.
  - Add Go and TS companions and their tests.
- **GU-SIG-006:** hub-ui `SignupCompletePage` (find the complete-signup route):
  - On the new 409, show "You already have a Vetchium account in {region}"
    with a button to that region's Hub sign-in page.
  - Get the region display name the same way as the Org signup region step
    (`Intl.DisplayNames`).
  - Add i18n in all hub-ui locales.
  - Match how `orgs-ui` handles `org-homed-elsewhere`.
- **GU-SIG-007:** Update `agent-guides/hub-signup.md`. Replace the "same email
  may identify independent accounts" bullet with: account email is globally
  unique through a keyed digest claim; the request answer stays generic; the
  completion reveals the home region only after mailbox proof; there is no
  unauthenticated homed-elsewhere answer at login.

### 3.5 Account email change (tenant)

Files:

- `backend/handlers/hub/auth/email_change.go`
- `backend/internal/db/queries/hub_email_change.sql`
- `typespec/hub/auth/email_change.*`
- new `backend/internal/hub/emailchange/`
- new worker `backend/internal/workers/complete_hub_email_changes.go`
- hub-ui account security email card

Templates to copy from:

- `backend/handlers/hub/profile/alias_set.go` (enqueue plus `PendingOperation`)
- `backend/internal/hub/aliaschange/payload.go`
- `backend/internal/workers/complete_hub_alias_changes.go` (state machine and
  retries)
- `backend/handlers/hub/operations/status.go` (polling)

Mirror them closely, including replay handling via
`GetFederationOperationByIdempotency`.

- **GU-ECH-001 Request:**
  - `RequestEmailChange` also resolves the new address's account digest
    globally.
  - If it is registered in any tenant, including this one (today's local
    check), no code is sent, and the answer is identical.
  - A resolve error still sends the code, because confirmation fails closed.
  - Pass the global result into `IssueHubEmailChangeChallenge` as a boolean.
    The statement records the challenge without queuing an email, as it
    already does for a locally taken address.
  - While the user has a non-terminal accepted change (GU-ECH-002a), the
    request returns the new `hub-email-change-in-progress` problem (409). It
    neither issues nor supersedes a challenge.
- **GU-ECH-002a Durable change row.** The challenge row cascades away when its
  session is deleted (`hub_email_change_challenges.hub_session_id ... ON
  DELETE CASCADE`), so logout would destroy the address a pending change
  needs. Accepted changes therefore live in their own table, independent of
  sessions and challenges:

  ```sql
  CREATE TYPE vetchium.hub_account_email_change_state AS ENUM (
      'accepted', 'reserved', 'applied', 'cancelling', 'succeeded', 'failed'
  );

  CREATE TABLE vetchium.hub_account_email_changes (
      operation_id uuid PRIMARY KEY
          REFERENCES vetchium.federation_operations (operation_id),
      hub_user_did uuid NOT NULL
          REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
      new_email_address text NOT NULL,   -- same normalization CHECK as hub_users
      new_email_digest bytea NOT NULL CHECK (octet_length(new_email_digest) = 32),
      old_email_digest bytea NOT NULL CHECK (octet_length(old_email_digest) = 32),
      -- Deliberately no FK: the session may end while the change is pending.
      confirming_session_id uuid NOT NULL,
      state vetchium.hub_account_email_change_state NOT NULL DEFAULT 'accepted',
      failure_reason text CHECK (failure_reason IN (
          'address_unavailable', 'reservation_expired'
      )),
      reserve_command_id uuid NOT NULL UNIQUE,
      finalize_command_id uuid NOT NULL UNIQUE,
      abandon_command_id uuid NOT NULL UNIQUE,
      not_after timestamptz NOT NULL,    -- accepted_at + 24 h; sent to the coordinator
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CHECK ((state IN ('succeeded', 'failed')) = (completed_at IS NOT NULL)),
      -- The reason is set on entering 'cancelling' and kept through 'failed'.
      CHECK ((state IN ('cancelling', 'failed')) = (failure_reason IS NOT NULL))
  );
  CREATE UNIQUE INDEX hub_account_email_changes_one_live
      ON vetchium.hub_account_email_changes (hub_user_did)
      WHERE state NOT IN ('succeeded', 'failed');
  ```

  Logout, session revocation, password reset, and new challenges do not affect
  a live change. At apply time, the user's other sessions are revoked except
  `confirming_session_id` if it still exists; if it is gone, all sessions are
  revoked. Keep `federation_operations` as the pollable operation, created in
  the same statement with the same `operation_id`; its payload holds only the
  operation id.
- **GU-ECH-002 Confirm:** `ConfirmEmailChange` runs the new
  `AcceptHubEmailChange` in place of `ConfirmHubEmailChange`. In one statement
  it:
  - checks the code with today's attempt counting and committed failure on a
    wrong code
  - consumes the challenge; it is no longer needed
  - inserts the `federation_operations` row (`kind =
    'hub-account-email-change'`, `target_authority = 'global-directory'`,
    aggregate = the user DID) and the `hub_account_email_changes` row, copying
    `new_email_address` from the challenge
  - audits `hub.email-change.accepted`

  A unique violation on `hub_account_email_changes_one_live` maps to
  `hub-email-change-in-progress` (409).
- **GU-ECH-003 Local serialization.** The inline handler and the worker may
  drive the same change at the same time. Every local transition is a single
  statement conditioned on the current state (`UPDATE ... WHERE operation_id =
  $1 AND state = '<expected>'`). A zero-row result means another driver won:
  re-read and continue from the new state. Directory calls are idempotent by
  their stable command ids, so a duplicate call is harmless. Transitions:

  | From | Event | To |
  | --- | --- | --- |
  | `accepted` | reserve succeeded | `reserved` |
  | `accepted` | reserve `email-claim-conflict` | `failed` (`address_unavailable`), with no global state to undo |
  | `accepted` | reserve `reservation-expired`/`-cancelled`, or local `now() > not_after` | `cancelling` (`reservation_expired`) |
  | `reserved` | `ApplyHubEmailChange` committed | `applied` (same statement as the email update) |
  | `reserved` | local unique violation at apply | `cancelling` (`address_unavailable`) |
  | `applied` | finalize succeeded | `succeeded` |
  | `cancelling` | abandon acknowledged | `failed` |

  - `applied` can never move to `cancelling`, and `cancelling` can never be
    applied. The conditional `WHERE state` makes that true even for racing
    drivers.
  - Once the deadline starts `cancelling`, a reserve still in flight is safe:
    if it lands first, abandon deletes it; if abandon lands first, its
    tombstone rejects the reserve (GU-DIR-006).
- **GU-ECH-004 Drive:** after committing GU-ECH-002, the handler drives the
  change inline through `emailchange.Service.Advance`, bounded by a few
  seconds. The worker runs the same `Advance` on live changes. Per state:
  1. `accepted`: `reserve-hub-account-email-change` with `change_id =
     operation_id` and `not_after`.
  2. `reserved`: run `ApplyHubEmailChange`. This is today's
     `ConfirmHubEmailChange` effects, minus the code check, reading everything
     from `hub_account_email_changes`, in one statement guarded by
     `state = 'reserved'`:
     - update `hub_users.email_address` and `email_digest`
     - set the state to `applied`
     - revoke sessions (GU-ECH-002a)
     - deactivate login challenges and reset tokens
     - queue the `email-changed` notice to the old address
     - audit `hub.email.changed`
  3. `applied`: `finalize-hub-account-email-change`, then in one statement mark
     `succeeded` and resolve the operation (`204`).
  4. `cancelling`: `abandon-hub-account-email-change`, then in one statement
     mark `failed`, resolve the operation with its stored problem (`409
     EmailAddressUnavailable` for `address_unavailable`; a retryable
     `503`-class problem for `reservation_expired`), and audit
     `hub.email-change.rejected` `{reason}`.
- **GU-ECH-005 Responses:** `confirmEmailChange` adds `202`
  `Vetchium.Hub.Operations.PendingOperation` and the in-progress 409 to its
  contract. It keeps `204`, the code-rejected problem, and
  `EmailAddressUnavailable`. It returns:
  - `204` if `Advance` reached `succeeded` in time
  - the stored problem if it reached `failed`
  - `202` otherwise

  A replay with the same idempotency key returns the resolved typed result, as
  alias change does. `requestEmailChange` adds the in-progress 409.
- **GU-ECH-006 Termination:**
  - Every live change reaches `succeeded` or `failed`. `accepted` past
    `not_after` goes to `cancelling`.
  - `reserved` and `applied` have no deadline. They only move forward.
  - A `DirectoryStateConflict` at finalize (reservation missing or cancelled)
    is impossible by construction. If it happens, keep retrying, and log it at
    error level for operator attention, without addresses or digests.
- **GU-ECH-007:** hub-ui email change flow:
  - On `202`, poll `/api/hub/operations/status`, then replay confirm with the
    same idempotency key. Reuse whatever helper the alias editor uses.
  - Show "Applying your new email…" while pending.
  - Keep the accepted change (operation id, idempotency key, and the confirm
    body) in session storage apart from the challenge, so neither a reload nor
    the code's ten-minute expiry loses the replay. Forget it only when a replay
    returns the change's final result: `204` or a problem other than a lapsed
    session or a server fault.
  - Add i18n in all locales.

### 3.6 Professional emails (tenant): dropped

Global uniqueness for verified professional emails — the claim, its
transfer-on-reverify semantics, the per-tenant supersession pull feed, and
the periodic holdings sweep — is dropped per the product decision recorded
in §1. Implemented in M1/M2/M5; reverted in the same change that dropped it.

Per-user professional-email verification and its existing local uniqueness
constraint (`hub_professional_emails`, one verified address per user per
normalized domain, `backend/internal/db/queries/hub_profile_private.sql`)
are unaffected and remain outside this plan's scope, as they were before it
started.

### 3.7 Configuration

- **GU-CFG-001:** New `appconfig.Workers` timer: `reconcileHubEmailChangeTimer`
  (implemented as such; the three professional-email timers this
  requirement originally also listed are dropped along with GU-PEM). Set it
  in `config/*.json` (10s), `config/ci/*.json` (1s, like the Org timers), and
  `deploy/*/config.json` (10s). Validate it in `appconfig` with a test,
  following how `ReconcileOrgSignupTimer` is validated.
- **GU-CFG-002:** Wire:
  - `hub-api` main: `identitydigest.Key` into `hub.Server` and the
    signup-completion and email-change services.
  - `workers` main: register the reconciliation job.
  - Coordinator: `identity_digest_key_id` config.

### 3.8 Audit rules (applies everywhere above)

- Every tenant write listed above writes its `audit_events` row in the same SQL
  statement (a CTE). Follow the existing hub queries and `database.md`.
- Every global write is inside `runCommand`, or audited in the same statement
  (reaper and prune).
- No audit payload contains an address, a digest, or a verification code.

## 4. Tests

### 4.1 Go

- `identitydigest`: GU-KEY-003 and GU-KEY-004 vectors.
- `appconfig`: the new secret reader and timers.
- `architecture`: GU-KEY-002.
- `globaldirectory` integration tests (`service_integration_test.go` and
  `org_integration_test.go` style, new `hub_email_integration_test.go`).
  `TestHubAccountEmailChangeChangeRecords` asserts the ledger, audit and
  outbox rows of reserve, finalize, abandon, and a stale cancellation, that no
  digest appears in audit or outbox JSON, and that a replay writes nothing;
  `TestHubAccountEmailChangeAuditFailureRollsBack` asserts that a failed
  audit insert rolls back the whole command; the reaper and prune tests
  assert their audit events. The remaining cases assert directory state and
  problem types:
  - reserve with a free and a taken email
  - the email conflict is distinct from a handle conflict
  - activate promotes the claim
  - the reaper cascades the claim
  - change reserve, finalize and abandon: idempotent replay, conflict, stale
    reservation replaced, finalize of a cancelled reservation
  - fencing:
    - abandon before reserve leaves a tombstone with a null digest, and the
      later reserve returns `reservation-cancelled` with no claim
    - the digest check rejects a null digest on a `reserved` or `finalized`
      row
    - reserve after `not_after` returns `reservation-expired`
    - abandon after finalize is a state conflict
  - prune of terminal reservations only after `not_after + 7 days`
  - digest key mismatch
  - caller tenant mismatch
- `signupcompletion`: email conflict → failed, registered elsewhere; handle
  conflict still rotates; replay of a failed completion. Use a fake directory.
- `emailchange` service: every GU-ECH-003 transition with a fake directory,
  including:
  - two concurrent `Advance` calls on one change, only one of which applies
  - deadline cancel racing a successful reserve
  - never cancelling after `applied`
  - apply after the confirming session was deleted revokes all sessions
- `backend/internal/db` integration: each new statement's audit row and
  rollback, in the style of `org_integration_test.go`.

### 4.2 Playwright API (`playwright/api/`)

Use `lib/hub-api.ts`, Mailpit helpers, and `lib/admin-db.ts`
(`sqlScalarForTenant`, `globalSQLScalar`, `auditEventJSONForTenant`). Use
unique addresses per test and clean up fully, including the global account-
email claim row.

New `hub-global-email.spec.ts`:

- Sign up in sgp. A signup request for the same address in usa1 returns `202`,
  Mailpit receives the registered-elsewhere mail naming sgp with no signup
  link, and the usa1 audit has `email_registered_elsewhere`.
- Race: request signup for X in sgp and usa1 (both links issued). Complete
  sgp, then complete usa1: `409` hub-account-homed-elsewhere with sgp's
  `hub_url`. usa1 has no `hub_users` row and the completion is failed. Replay
  gives the same 409.
- ind1 (coordinator unreachable): request signup still sends a signup link;
  completion returns `202` and never creates an active user.
- The email conflict does not consume handle rotation attempts. Assert
  `attempt_count`.

Extend `hub-email-change.spec.ts`:

- The address of a usa1 user: request from sgp sends no code, and the answer
  is identical.
- Race: a free X is requested in sgp, X is signed up in usa1, then confirm in
  sgp gives `409` EmailAddressUnavailable, the email is unchanged, and the
  audit is `hub.email-change.rejected`.
- Successful change: after it, the old address can be signed up in usa1 and
  the new address gets registered-elsewhere.
- ind1: confirm returns `202` and the status is `pending`; the email is
  unchanged and the other sessions are not revoked.
- While a change is pending (ind1), a new request-email-change and a second
  confirm both get the in-progress 409.
- Logout during a pending change: the `hub_account_email_changes` row survives
  (check it with `sqlScalarForTenant`) and the operation remains pollable
  after signing in again. Use ind1 for the pending state. A tenant that
  reaches the coordinator completes too fast to observe it.

`hub-profile-professional-email.spec.ts` needs no extension: professional
email verification is per-user only, unchanged from before this plan.

Also:

- Audit rollback: extend the failure-injection helper (generalize
  `installOrgAuditInsertFailure` from `lib/orgs-api.ts` to Hub audit actions)
  so a failing audit insert rolls back each new write.
- Contract coverage: every new response status is exercised, or listed with a
  reason where the CI stack cannot produce it (e.g. the digest key mismatch).

### 4.3 Playwright UI (`playwright/ui/`)

- Signup completion homed elsewhere: shows the message and the region link.
- Email change pending state: use ind1, or make the operation resolve.

## 5. Documentation updates

- `agent-guides/hub-signup.md` (GU-SIG-007)
- `agent-guides/federation.md`:
  - what the directory stores for Hub users: digests only, with the key
    location and (now singular) namespace
  - the email-change claim workflow
- `agent-guides/glossary.md`: add *Account email*, *Identity digest*
- `deploy/README.md`: the shared identity digest key and the coordinator key id
- `docs/todo.md`: the out-of-scope items from §1, plus the deferred abuse-
  detection admin feature §1's "Dropped" note names

## 6. Suggested commit sequence

Commit after each phase, with detailed messages and **no** `Co-Authored-By` or
other contributor trailers. Keep `make test` green at the end. Intermediate
phases need at least `make sqlc`, `go build ./...` and the relevant Go tests.

1. `identitydigest` package, secret wiring (compose, Makefile, Tiltfile,
   deploy), coordinator key id config, architecture test.
2. Global schema, `globaldirectory` commands, typespec directory contracts and
   problems, coordinator routes, mesh relay, `directoryclient`, Go integration
   tests.
3. Hub signup: schema, queries, saga, request-time notice email and templates,
   completion 409 contract, hub-ui completion page, tests.
4. Email change durable operation: schema, queries, service, worker,
   contracts, hub-ui, tests.
5. ~~Professional email claims, supersession feed worker, contracts,
   hub-ui, tests.~~ Dropped per §1; implemented then reverted.
6. Guides and docs, Playwright UI tests, final `make fmt` and `make test`.

## 7. Verification

- `make sqlc` after query changes; `make fmt`.
- `make test` is the gate: lint, vuln, unit tests, the CI stack, Playwright,
  and the API coverage report. It must exit 0 with no contract mismatches.
- Before calling it done, check manually:
  - grep the new SQL and Go for any audit `jsonb_build_object` containing
    `email` or `digest`
  - confirm `docker-compose*.json` mounts `identity_digest_key` only into
    hub-api and workers
  - confirm the coordinator image and config never reference the key

## 8. Pitfalls

- The signup saga distinguishes handle conflicts by problem type. Keep the
  email-conflict type distinct, or users will loop through handle rotation and
  then 202 forever.
- Do not compute digests in SQL. The key must never reach PostgreSQL.
- `pending_change` claims must never be reaped by time (GU-DIR-010). They
  leave through finalize or abandon, and abandon writes a tombstone that
  fences late reserves.
- Never read pending email-change data from the challenge row; it cascades
  with its session (GU-ECH-002a).
- Every email-change state transition is conditional on the expected state
  (GU-ECH-003). An unconditional update reintroduces the apply/cancel race.
- An errored resolve at request time must not block signup or code delivery;
  the completion and confirm steps are the fail-closed points.
- CI `ind1` has no coordinator path. Never create ind1 fixtures that need a
  claim.

## 9. Implementation ledger

- [x] GU-KEY-001..005
- [x] GU-GDB-001..002 (incl. 002a). Every email-change command writes a
      digest-free outbox event versioned by its reservation; see §10.
      GU-GDB-003: **dropped**, see §1/§3.2.
- [x] GU-DIR-001..006, GU-DIR-010 (the email-change-reservation half).
      GU-DIR-007..009, GU-DIR-011: **dropped**, see §1/§3.3.
- [x] GU-SIG-001..007
- [x] GU-ECH-001..007 (incl. 002a) — schema, queries, `emailchange` service
      and worker, handlers, contracts, integration tests (including the
      concurrent-`Advance` race) all against a live Postgres, the hub-ui
      poll/replay flow, and two audit-completeness fixes found by running
      hub-email-change.spec.ts against a live CI stack (M6). All six of its
      cases pass.
- [ ] GU-PEM-001..009: implemented in M5, then **dropped** per the product
      decision recorded in §1. See §10 for the revert commits.
- [x] GU-CFG-001, for the email-change timer (`reconcileHubEmailChangeTimer`);
      the three professional-email timers it also named are dropped along
      with GU-PEM. GU-CFG-002 (the identitydigest.Key wiring into hub-api and
      workers via the AccountEmailDigester interface, not the concrete type)
      is done for signup and email-change; professional-email's wiring was
      implemented in M5 and removed with it.
- [x] Tests §4.1 for GU-DIR-001..006/010, GU-SIG-001..007, and GU-ECH-003
      (incl. the concurrent-`Advance` race, stable under `-race`), all
      against a live Postgres. GU-DIR-007..011 and GU-PEM's tests were
      implemented in M5 and removed with it.
- [x] Tests §4.2, §4.3 (Playwright), account-email scope: new
      `hub-global-email.spec.ts` (signup registered-elsewhere, the sgp/usa1
      signup race, ind1's pending completion); `hub-email-change.spec.ts`
      extended with the cross-tenant no-code case, the usa1-race conflict,
      the successful-change-frees-the-old-address/protects-the-new-one case,
      and a consolidated ind1 pending-confirm case (unchanged address, other
      sessions intact, in-progress 409, deterministic replay, survives
      logout); `hub-account-security.spec.ts` gained the pending-confirm UI
      case and a new `hub-signup-completion.spec.ts` covers the
      homed-elsewhere UI case. Contract coverage: no new exemptions needed,
      these add coverage of previously-unexercised statuses
      (hub-account-homed-elsewhere, the ind1 202s) rather than requiring any.
      Also fixed a pre-existing gap from M2 (`c121359`): `mesh.spec.ts` and
      `global-directory.spec.ts`'s shared `freshReservation` helper never set
      `account_email_digest`/`digest_key_id`, which `ReserveHubPrincipalRequest`
      has required since that commit — a `tsc` error caught it (`playwright
      typecheck` is part of `make test`), not a runtime failure someone had
      hit yet.
- [x] Documentation §5: `agent-guides/hub-signup.md` (GU-SIG-007),
      `docs/todo.md`, this document's own dropped-scope notes,
      `agent-guides/federation.md` (the account-email-digest and
      email-change-saga paragraph; the professional-email paragraph
      GU-PEM-008 asked for is dropped), and `agent-guides/glossary.md`
      (*Account email* and *Identity digest*) are all updated.
- [x] `make test` green
- [x] Review fixes (2026-09-29); see "Review fixes" in §10.

## 10. Progress log

**Current milestone:** complete. M1–M4, M6 (account-email scope), and the
review fixes below are verified by a green full `make test` (433 Playwright
tests passed at the review fixes; 402 at M6's first close-out).
M5 (professional email claims) was fully implemented, then reverted whole:
the product owner decided against global uniqueness for professional emails
after the M5 commits landed (see §1's "Dropped" note for the rationale). M6
was therefore finished in account-email scope only (signup and email
change); the professional-email Playwright/doc items §4.2/§4.3/§5
originally listed are dropped along with GU-PEM.

M4 delivered: schema, queries, the `emailchange` service and worker, the
handlers, the TypeSpec contracts (`.tsp`/`.go`/`.ts` companions), the
integration tests (including the concurrent-`Advance` race test GU-ECH-003
calls for, stable under `-race` and repeated runs), and the hub-ui
poll/replay flow — plus, discovered while running `hub-email-change.spec.ts`
against a real CI stack during M6, two audit-completeness fixes (a dropped
`attempt_count` field and a missing `hub.email-change.rejected` audit on the
reserve-time-conflict path) and three test-fixture/assertion updates for
behavior that genuinely changed under the new durable-operation design (see
"M6 progress" below for the exact list). All six of that spec's cases now
pass.

M5's revert (two commits: reverting the five M5 commits, then removing the
M1/M2 GU-DIR-007..011 foundations those commits called into) left every Go
package, migration, and contract building and testing clean — see "M5
revert" below for the exact file list and verification performed.

`agent-guides/federation.md` and `agent-guides/glossary.md` had a real,
pre-existing gap this session closed: neither ever documented the
account-email digest or the email-change saga at all (the only federation.md
paragraph that would have covered it, added in M5, mixed account-email and
professional-email content together and was lost entirely on revert).
Rewritten with an account-email-only version. `docs/hub-profile.md` and
`agent-guides/hub-profile.md` have no stale email-change content (grepped:
neither ever mentioned the old synchronous `ConfirmHubEmailChange` design or
survived M5's revert with dangling references).

See "M5 revert", "M6 progress", and "Exact next step" below.

**Review fixes (2026-09-29).** A branch review found these; each is fixed
and tested:

- Reservation ownership. Finalize and abandon checked that the caller owns
  the supplied Hub user but not that the locked reservation belongs to that
  user, so another user's change id could be finalized or cancelled. All
  three email-change commands now require the reservation's own
  `hub_user_did` to match and otherwise return `directory-state-conflict`.
  A reserve that reuses a change id with another digest is now the same
  problem instead of a 500.
- Recovery starvation. `ListRecoverableHubAccountEmailChanges` picked the
  oldest 100 live changes on every run, so 100 stuck changes hid every newer
  one. It now selects by the sibling `federation_operations.next_attempt_at`,
  and `Recover` records each attempt (with the shared backoff) before driving
  it and continues past a failing change.
- A concurrent confirm that hits `hub_account_email_changes_one_live` now
  returns `hub-email-change-in-progress` (409), as GU-ECH-002 requires,
  instead of the code-rejected problem.
- Audit and outbox. The Hub reaper deletes the claim explicitly and audits
  each reaped principal in the same statement with `email_claim_released`,
  following the Org reaper's precedent of naming the home tenant as actor.
  Pruning runs in bounded batches and writes one summary audit event per home
  tenant. Email-change commands write outbox events on the
  `hub_account_email_change_reservation` aggregate (version 1 when written,
  2 after its one terminal transition), including the stale reservation a
  newer reserve cancels, which satisfies PROF-XTN-002. Each email-change
  audit event carries `{schema_version, change_id, state,
  cancelled_change_ids}`, so the audit trail alone reconstructs every
  reservation transition, including the stale one a reserve cancels. The
  Org reaper's
  `:execrows` over a trailing `SELECT count(*)` always reported one row; both
  reapers now return the deleted count.
- `RequestEmailChange` resolved the address inside `RunIdempotent`'s open
  transaction. It now resolves first, as signup does.
- The completion page named the home region by tenant id. The
  homed-elsewhere problem now carries `hosting_country`, and the page shows
  its CLDR name in the viewer's language (GU-SIG-006).
- Playwright now covers the four coordinator and four mesh email-directory
  routes (authentication, validation, and every declared non-5xx problem) and
  the confirm in-progress 409 and reservation-expired 503.
- Remaining coverage gaps in the API report (`/api/orgs/complete-signup`
  403 and `/api/orgs/request-signup`'s `org-signup-unavailable`) belong to
  Org signup, which this branch does not change.

**Design decisions already validated against a real disposable PostgreSQL
container** (a scratch `postgres:17-alpine` container, not part of the repo;
torn down before finishing — a future session should not expect it to still
be running) — recorded here so the next session does not need to
re-derive them:

- The professional-email claim upsert (GU-DIR-007) is deliberately NOT one
  single-statement CTE that both reads the previous holder and writes the
  new one. A `SELECT ... FOR UPDATE` sibling CTE next to a data-modifying CTE
  in the same statement does not reliably see the pre-write snapshot in
  PostgreSQL (verified empirically: adding `FOR UPDATE` to the "previous
  holder" read CTE made it silently return zero rows instead of the
  pre-existing holder). The implemented shape is three separate queries in
  the same transaction: `InsertHubProfessionalEmailClaimIfAbsent` (INSERT ...
  ON CONFLICT DO NOTHING, handles the "absent" case and, under concurrency,
  makes a racing first-claimant block until the winner commits — verified
  with two real overlapping transactions), then, only when that returned
  `pgx.ErrNoRows`, `LockHubProfessionalEmailClaim` (a plain `SELECT ... FOR
  UPDATE`, safe here because it is not sharing a statement with a writer),
  then `TransferHubProfessionalEmailClaim` (a plain UPDATE, safe because the
  lock is already held).
- Every other multi-step mutation (reserve/finalize/abandon email change,
  activate-hub-principal's claim promotion, reserve-hub-principal's
  claim-then-handle ordering) uses forced CTE data-dependencies (a downstream
  CTE genuinely reads from an upstream one, sometimes via a trivial
  `LEFT JOIN ... ON TRUE` purely to force ordering when the two CTEs
  otherwise touch unrelated rows) to guarantee one write's effect is visible
  before the next write's uniqueness check runs. Each was individually
  tested against real Postgres, including the failure path (e.g., the
  claim-before-handle ordering was confirmed to reject a duplicate email
  digest without ever touching the handle table).
- sqlc v1.29 has at least three relevant quirks worth knowing before touching
  these queries again: (1) a bare `WHERE hub_user_did = ...` inside one CTE
  of a multi-CTE statement can be reported as "ambiguous" by sqlc's analyzer
  even though real PostgreSQL accepts it, if any other CTE/table in the same
  statement also has a `hub_user_did` column — fix by qualifying with the
  table/alias name; (2) a DELETE's RETURNING clause cannot reference a
  column from a CTE reached only via its USING clause — restructure so the
  DELETE is itself a CTE and a final plain SELECT pulls from both CTEs via
  scalar subqueries; (3) `unnest(arr1, arr2)` (multi-argument unnest) is
  rejected by sqlc's analyzer even though PostgreSQL supports it — use two
  single-argument `unnest(...) WITH ORDINALITY` calls joined on the ordinal
  instead, and avoid wrapping a nullable result in `CASE WHEN ... END`
  inside SQL (sqlc infers it as non-nullable regardless of an `ELSE
  NULL::type`); return the raw nullable source columns instead and compute
  the "effective" nullable value in Go.

**Last commit before this checkpoint:** `c121359` (M2 schema/contracts). This
checkpoint's commit implements the remaining M2 layers described below (see
the commit message for the exact list) plus this log update.

**What M2 actually implemented, for a resumed session's reference:**

- `backend/internal/globaldirectory/hub_email.go`: all of GU-DIR-001..011,
  plus `PruneTerminalHubAccountEmailChangeReservations`. `globaldirectory.New`
  now takes a `digestKeyID string` second argument (compared against every
  digest-carrying request's `DigestKeyID` before touching the database) —
  callers updated: `backend/cmd/global-coordinator/main.go` (passes
  `config.IdentityDigestKeyID`) and both `_integration_test.go` files (pass
  the dev key id `"909577e87ebd5395"`).
- `mutation[R]` (in `service.go`) gained `skipOutbox bool` and
  `auditPayload any` fields (both since replaced by explicit `outboxEvents`
  in the review fixes). Every new Hub-email command sets
  `skipOutbox: true` (see the deviation note below) and, for professional
  email claims, a custom `auditPayload` of `{transferred: bool}` instead of
  the generic `{schema_version, principal: response}` shape (which would
  have put the response — safe here — but the pattern exists so a future
  command with a sensitive response shape doesn't have to invent this).
- `reserve-hub-principal`'s query and service method now insert the account
  email claim before the handle and distinguish
  `hub_account_email_claims_pkey` (-> `DirectoryEmailClaimConflictError`)
  from any other unique violation (-> `DirectoryClaimConflictError`, the
  handle case). `activate-hub-principal` activates the claim in the same
  statement as the principal.
- Coordinator handlers/routes, mesh relay/routes, and directoryclient all
  follow the exact existing generic patterns (`commandHandler[T]`,
  `directoryCommand[T]`, `commandResult[R]`) with no changes to those
  generic engines beyond what's listed above.
- `backend/internal/globaldirectory/hub_email_integration_test.go` covers:
  resolve (found/missing/key-mismatch), reserve-hub-principal's email-vs-handle
  conflict priority, the full email-change lifecycle (reserve, idempotent
  replay, stale-reservation replacement, collision with the user's own
  current claim, finalize, finalize replay, abandon-after-finalize
  rejection), fencing (abandon-before-reserve tombstone, late reserve
  rejected as cancelled, reserve-after-deadline rejected as expired), digest
  key mismatch, caller tenant mismatch, professional-email first
  claim/reverify/same-tenant-transfer/cross-tenant-transfer (asserting the
  supersession row and the response's DID-hiding rule), release (stale
  no-op, current clears holder, reclaim gets a higher revision), holdings
  check (held/released/never-claimed/foreign-DID-rejected), the pull feed's
  acknowledgment lifecycle (ack-ahead-of-issued conflict, delivery, deletion
  on ack, caller-scoping, regressed-request idempotence), the concurrent
  feed-ordering test (two real overlapping transactions, one holding the
  sgp cursor row lock past a synchronization channel), and reservation
  pruning. `backend/handlers/directory/directory_test.go` and
  `backend/internal/directoryclient/client_test.go` got matching new cases
  for the handler and client layers. **Not yet covered**: a dedicated
  `backend/handlers/mesh/directory_test.go` (none existed before this
  change either — mesh directory relay has never had its own handler-level
  test file; it's exercised indirectly through `*directoryclient.Client`
  satisfying `mesh.Directory` at compile time, which `go build`/`go vet`
  confirmed). Close this gap with Playwright API tests in M6, which
  exercise the mesh relay for real against the CI stack anyway.

**What M3 actually implemented, for a resumed session's reference:**

- Tenant schema (`db/migrations/00001_init.sql`): `hub_users.email_digest`
  (`bytea NOT NULL UNIQUE`), `hub_signup_completions.account_email_digest`
  (set once at prepare time), `.failure_reason` (`'expired'` or
  `'email_registered_elsewhere'`), `.conflicting_home_tenant_id` (set only
  for the latter, only when the coordinator's lookup at completion succeeded),
  and the new `'signup-registered-elsewhere'` `hub_email_outbox` kind.
- `backend/internal/db/queries/hub_signup.sql`: `CreateHubSignupRequest`
  gained a `registered_elsewhere_tenant_id` (nullable) and
  `elsewhere_payload_ciphertext` parameter; when the former is set, the
  `upserted` and normal `outbox` CTEs are skipped entirely (no signup request
  or verification email is created) and a `signup-registered-elsewhere`
  outbox row plus a `hub.signup.rejected` audit fire instead — the HTTP
  response stays the identical `202` either way. `PrepareHubSignupCompletion`
  now stores `account_email_digest`. `CreateProvisioningHubUser` copies that
  digest straight into `hub_users.email_digest`. `AbandonExpiredHubSignupCompletion`
  now also sets `failure_reason = 'expired'`. New
  `FailHubSignupCompletionRegisteredElsewhere` query (mirrors the abandon
  query's shape: locks the `prepared` operation, deactivates its signup
  request, sets `failed`/`email_registered_elsewhere`/the conflicting tenant
  id, audits `hub.signup.rejected`). All six pre-existing queries that
  explicitly listed `hub_signup_completions` columns (both `Get*` reads, both
  saga-step final `SELECT`s, the abandon query, `ListRecoverable...`) were
  updated to include the three new columns in table order, since several are
  cast via `sqlc.VetchiumHubSignupCompletion(row)` and require an exact field
  match.
- `backend/internal/hub/signupcompletion/service.go`: `Start` computes
  `account_email_digest` and stores it; `Advance`'s `prepared` case sends
  `account_email_digest`/`digest_key_id` with `reserve-hub-principal` and
  checks `DirectoryEmailClaimConflictError` **before** the existing handle
  ­conflict/rotation check (never rotates a handle for an email conflict);
  a new `failRegisteredElsewhere` helper calls `ResolveHubAccountEmail` for
  the display-only home tenant (best-effort; a resolve failure still fails
  the completion, just without naming a region) and runs the new query; the
  `failed` case in the state switch branches on `failure_reason` so a replay
  of an already-failed completion (by token or by idempotency key) returns
  the same `*ErrRegisteredElsewhere` or `ErrExpired` it originally reached,
  without re-deriving it.
- **Important architecture fix**: the first attempt at wiring
  `identitydigest.Key` directly onto `hub.Server` and
  `signupcompletion.Service` broke the GU-KEY-002 architecture test, because
  `backend/internal/routes` (imported by **every** `cmd/*/main.go`, including
  `global-coordinator` and `mesh-api`, for their own unrelated route
  registration) transitively imports `backend/internal/hub` and
  `backend/handlers/hub/auth`. Any import added to *any* file in a package
  reachable from `backend/internal/routes` leaks into every binary that
  imports that package, regardless of whether that binary's code path ever
  uses it. The fix: both `hub.Server` and `signupcompletion.Service` now
  declare their own local `AccountEmailDigester` interface
  (`HubAccountEmail(string) []byte; ID() string`) instead of importing
  `identitydigest.Key` directly; only `backend/cmd/hub-api/main.go` and
  `backend/cmd/workers/main.go` (isolated per-executable `main` packages, not
  reachable from `routes`) import `identitydigest` and construct the
  concrete key. **Remember this pattern for M4 and M5**: `emailchange` and
  `professionalemail` services/handlers must use the same
  interface-not-concrete-type approach for anything digest-related, or the
  architecture test will fail the same way. Run
  `go test ./internal/architecture/...` after wiring any new digest consumer.
- TypeSpec: `HubAccountHomedElsewhereDetails` (409) added to
  `typespec/problem/hub/signup.tsp` + Go + TS companions, modeled on
  `OrgHomedElsewhereDetails`; added to `completeSignup`'s response union.
  `requestSignup`'s doc comment (falsely said "email uniqueness is
  tenant-local") corrected.
- Email: new `email.SignupRegisteredElsewhere` kind, `TemplateData.RegionLabel`
  field, templates in all three Hub locales (en-US, de-DE, ta) — deliberately
  showing the raw tenant id as the "region" (e.g. "usa1"), not a localized
  country name. See the deviation below.
- `hub-ui/src/pages/CompleteSignupPage.tsx`: a `HomedElsewhere` component
  (modeled on `orgs-ui`'s `LoginPage.tsx` `HomedElsewhere`) shows an info
  alert with a "go to sign in" button when `complete.error` carries
  `HubAccountHomedElsewhereDetails`, instead of the generic error+password
  form. i18n added to all three locales under `completeSignup.homedElsewhere.*`.
- Tests: `backend/internal/hub/signupcompletion/service_test.go` (new) —
  email conflict → failed + replay returns the same error; handle conflict
  still rotates and then completes, using a `fakeDirectory` that echoes
  request fields back so the test never needs to predict the generated
  handle/DID. Uses `TENANT_DATABASE_URL` against a live Postgres, same
  convention as the pre-existing `backend/internal/db/*_integration_test.go`
  files. **Also had to fix 7 pre-existing raw-SQL `INSERT INTO
  vetchium.hub_users` statements** across `backend/internal/db/profile_integration_test.go`,
  `website_integration_test.go`, and
  `backend/internal/workers/complete_hub_alias_changes_integration_test.go`
  that didn't set the new `email_digest` column — each now uses
  `sha256(convert_to($n, 'UTF8'))` on the same parameter as `email_address`,
  which is a convenient way to get a deterministic, unique-enough 32-byte
  value in a raw SQL fixture without needing a real digest key.
- A local scratch PostgreSQL container (see the M2 notes below for the exact
  commands) was used for **both** `GLOBAL_DATABASE_URL` and
  `TENANT_DATABASE_URL` in the same container (two databases, `global_db` and
  `tenant_db`), migrated with `goose -dir db/global-migrations` and
  `goose -dir db/migrations` respectively.

**What M4 actually implemented so far, for a resumed session's reference:**

- Schema (`db/migrations/00001_init.sql`): `hub_account_email_change_state`
  enum (`accepted`, `reserved`, `applied`, `cancelling`, `succeeded`,
  `failed`) and `hub_account_email_changes` exactly as GU-ECH-002a specifies,
  including the `hub_account_email_changes_one_live` partial unique index
  and the completed/failure-reason CHECK constraints. Verified UP against a
  fresh scratch `tenant_db`; DOWN still fails on the pre-existing,
  already-documented `hub_email_change_challenges`-before-`hub_sessions`
  ordering bug (unrelated to this change, see `docs/todo.md`).
- `backend/internal/db/queries/hub_email_change.sql`: `ConfirmHubEmailChange`
  is replaced by `AcceptHubEmailChange` (one statement: checks the code,
  consumes the challenge, inserts both the `federation_operations` row and
  the `hub_account_email_changes` row, audits `hub.email-change.accepted`);
  new `HubAccountEmailChangeInProgress`, `GetHubEmailChangeChallengeAddress`
  (a plain pre-read so Go can compute the new address's digest before the
  atomic accept — identitydigest lives in Go, not SQL; safe because a
  challenge's address never changes after insert and the atomic accept
  re-validates everything itself), `GetHubAccountEmailChangeByOperationID`,
  `LockHubAccountEmailChange`, `MarkHubAccountEmailChangeReserved`,
  `FailHubAccountEmailChangeDirectly`, `MarkHubAccountEmailChangeCancelling`,
  `ApplyHubAccountEmailChange` (today's old `ConfirmHubEmailChange` effects
  minus the code check), `MarkHubAccountEmailChangeSucceeded`,
  `MarkHubAccountEmailChangeFailed`, `ListRecoverableHubAccountEmailChanges`.
  The three terminal-transition queries (`FailHubAccountEmailChangeDirectly`,
  `MarkHubAccountEmailChangeSucceeded`, `MarkHubAccountEmailChangeFailed`)
  deliberately do **not** also resolve the `federation_operations` row
  themselves — `emailchange.Service` calls the existing generic
  `ResolveFederationOperation` (from `federation.sql`) in the same DB
  transaction instead, avoiding a near-duplicate query. `IssueHubEmailChangeChallenge`
  gained a `globally_registered` boolean parameter that skips queuing the
  verification email, same as today's locally-taken-address case
  (GU-ECH-001). Hit the same sqlc-reports-"ambiguous"-where-real-Postgres-
  doesn't quirk noted in the M2 section, on a single-relation CTE with a
  `FOR UPDATE`; fixed the same way (qualify with a table alias even though
  Postgres does not need it).
- New `backend/internal/hub/emailchange/` package: `Service.Start` (accept +
  idempotent replay via `GetFederationOperationByIdempotency`, mirroring
  `signupcompletion.Start`'s token-hash replay pattern but keyed on
  `(kind, aggregate_id=hub_user_did, idempotency_key)` since email-change has
  no separate token) and `Service.Advance` (GU-ECH-003's transition table,
  implemented as literally as possible: `accepted`→reserve or
  direct-fail/cancel on conflict/expiry, `reserved`→local apply (with the
  `hub_users_email_address_key` unique-violation safety net moving to
  `cancelling` instead of retrying forever), `applied`→finalize→`succeeded`,
  `cancelling`→abandon→`failed`). Declares its own local
  `AccountEmailDigester` interface (GU-KEY-002 pattern from M3); only
  `backend/cmd/hub-api/main.go` and `backend/cmd/workers/main.go` import
  `identitydigest` to construct the concrete key passed in.
- `backend/internal/workers/reconcile_hub_email_change.go` +
  `Worker.reconcileHubEmailChange` (new `HubEmailChangeRecovery` interface,
  new `reconcileHubEmailChangeTimer` config field end to end through
  `appconfig`, all twelve tenant/CI/deploy config JSON files, and
  `workers.New`'s signature).
- `backend/handlers/hub/auth/email_change.go`: `RequestEmailChange` now
  checks `HubAccountEmailChangeInProgress` first (409
  `hub-email-change-in-progress`) and resolves the new address globally via
  `s.Directory.ResolveHubAccountEmail`, treating any error or "not found" as
  "not registered" (fail open to sending the code, per GU-ECH-001's explicit
  fail-closed-on-confirmation tradeoff — the reserve step is the real,
  authoritative gate). `ConfirmEmailChange` no longer uses
  `handlerauth.RunIdempotent` (that would hold a DB transaction open across
  the coordinator network calls `Advance` makes, the exact anti-pattern
  `signupcompletion`'s package doc warns about); it calls
  `s.EmailChange.Start` directly and maps its typed errors to responses:
  `ErrCodeRejected`→400, `ErrAddressUnavailable`→409,
  `ErrUnavailable`→503 (new `EmailChangeUnavailableError`), `ErrPending`→202
  `PendingOperation`, success→204.
- TypeSpec: `typespec/problem/hub/email.tsp`/`.go` gained
  `HubEmailChangeInProgressError` (409) and `HubEmailChangeUnavailableError`
  (503, retryable); `typespec/hub/auth/email_change.tsp` adds the `202`
  `PendingOperation` response and both new problems to `confirmEmailChange`,
  and the in-progress problem to `requestEmailChange`.
- Moved `isAccountEmailTaken`'s unit test from
  `backend/handlers/hub/auth/email_change_test.go` (the function moved to
  `emailchange`) into new `backend/internal/hub/emailchange/service_test.go`,
  which also covers `isEmailChangeInProgress` and `failureStatus`.
- Verified: `go build ./...`, `go vet ./...`, `gofmt -l .` clean; `make sqlc`
  clean (no manual edits to generated files); `make sql-check` (sqlc vet +
  verify + sqlfluff AM04/ST03) clean; targeted `go test` of
  `internal/hub/emailchange`, `internal/workers`, `handlers/hub/auth`,
  `internal/appconfig`, `internal/architecture` (confirms the
  identitydigest boundary still holds) all green.

**What M4's test pass added:** `backend/internal/hub/emailchange/service_integration_test.go`
(new): `fakeDirectory`/`fakeDigester` doubles mirroring
`signupcompletion/service_test.go`'s convention; `seedHubUser`/`seedChallenge`/
`seedReservedChange` fixtures against `TENANT_DATABASE_URL`. Covers the happy
path to `succeeded`; wrong code (rejects, no operation row created);
`address_unavailable` at reserve time; `reservation_expired` at reserve time;
idempotent replay of an accepted change after a transient finalize failure
(`ErrPending` then, on retry with the same idempotency key, `Completed`);
refusing a second confirm while a change is already live
(`hub_account_email_changes_one_live`). Plus the GU-ECH-003 concurrency test:
two goroutines call `Advance` on the same seeded `'reserved'` row at once;
`ApplyHubAccountEmailChange`'s `FOR UPDATE` plus its `state = 'reserved'`
guard means the loser's statement re-evaluates its `WHERE` after waiting for
the lock and gets zero rows (`pgx.ErrNoRows`), so it falls through to
`reget` and keeps advancing the now-`applied` row instead of double-applying
or erroring — both goroutines converge to `Completed`. Asserted: exactly one
`email-changed` outbox notice, and the address changes exactly once.
Verified stable across five repeated runs and under `go test -race`.
**Test-fixture gotchas hit and fixed**: `hub_users.hub_user_did` must be a
UUIDv7 (`dbvalue.NewUUIDv7`, not `NewUUID`) or `hub_users_did_uuidv7_check`
fails; `hub_users.handle` must match `^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$`
(hex digits satisfy both character classes, so `sha256(email)` hex-encoded
and split 8/11 makes a valid, unique-enough test handle); `hub_email_outbox`
has no FK to `hub_users` (it addresses arbitrary mailboxes), so a
literal-address fixture's cleanup must explicitly delete its outbox rows too,
or a later run's notice-count assertion inflates from a previous run's
leftover rows (hit this directly: the concurrency test's assertion counted
6 accumulated rows before the cleanup was added).

**M5 revert (professional email claims, implemented then dropped):** M5 was
fully implemented per plan §3.6 (schema, claim/release sagas, supersession
feed and sweep workers, contracts, hub-ui card, docs) across commits 8380f98,
b3d4cac, 4d5a0e9, a15ab96, 3d62cb7. After those landed, the product owner
decided against global uniqueness for professional emails (see §1's
"Dropped" callout for the full rationale: agencies only ever see the verified
domain, evidence is a re-verified-yearly dated record rather than an identity
invariant, and duplicate-mailbox detection belongs to a later admin
abuse-detection feature, not a global claim). The revert was done in two
commits:
- `e5fdcd6` cleanly `git revert`ed all five M5 commits (newest first), zero
  conflicts, removing exactly the 44 files M5 had touched.
- `cedba73` then removed what the earlier M1/M2 milestones had added only to
  support professional-email claims and were never reverted by the M5
  revert: the three global tables
  (`hub_professional_email_claims`/`_feed_cursors`/`_supersessions`) and
  their DROP statements from `db/global-migrations/00001_init.sql`; GU-DIR
  007-011's globaldirectory methods, queries, coordinator/mesh handlers and
  routes, directoryclient methods, and `validProfessionalClaim`; the
  TypeSpec `directory` models/routes/tests naming professional emails;
  `identitydigest.HubProfessionalEmail`/`NamespaceHubProfessionalEmail` and
  its test vector; and the now-dropped tables' references in every
  integration test's TRUNCATE list. Verified after each commit: `make sqlc`,
  `go build ./...`, `go vet ./...`, full `go test ./...` against a freshly
  recreated scratch `global_db`+`tenant_db`, `make sql-check`,
  `make typespec-check`, and `make fmt`, all clean.

Account-email uniqueness (GU-KEY, GU-GDB except -003, GU-DIR except
007-011, GU-ECH, the email-change saga) is untouched by the revert and
remains exactly as M2-M4 built it.

**M6 progress (account-email scope only):** `6682925` fixed two real audit
gaps found by running `hub-email-change.spec.ts` against a live rebuilt CI
stack: `AcceptHubEmailChange`'s verification-failed audit had lost
`attempt_count` in the M4 query redesign, and
`FailHubAccountEmailChangeDirectly` (the reserve-time address-already-taken
path) never wrote a `hub.email-change.rejected` audit at all. Both are fixed
in `backend/internal/db/queries/hub_email_change.sql`, regenerated via
`make sqlc`, with `emailchange.Service.failDirectly` gaining a `source`
parameter to supply the new audit's actor/idempotency fields. That commit
also updated two Playwright assertions to match M4's actual (correct, not a
bug) behavior: a wrong-code confirm doesn't create a durable operation, so
replaying the same idempotency key with the now-correct code is a fresh
attempt rather than a cached idempotency conflict; and the accept step's
audit is keyed by the client's idempotency key while the terminal outcome is
audited separately under the operation's own key. All 6 cases in
`playwright/api/hub-email-change.spec.ts` pass against the live stack.

**M6 completion (account-email Playwright/doc work):** all of the previous
"Exact next step" checklist is done:

1. New `playwright/api/hub-global-email.spec.ts`: signup registered-elsewhere
   (sgp then usa1, mail names sgp and carries no link, usa1 audits
   `hub.signup.rejected`/`email_registered_elsewhere`); the sgp/usa1 signup
   race (both links issued before either completes; sgp completes, usa1's
   completion gets 409 `hub-account-homed-elsewhere` naming sgp, its
   `hub_signup_completions` row is `failed`/`email_registered_elsewhere`
   with `attempt_count` untouched at 0 — proving the conflict never went
   through handle-rotation — and no local `hub_users` row exists; a replay
   with the same token/key reaches the same 409 deterministically); ind1's
   completion returns `202 PendingOperation` and never creates a local user
   while its coordinator path stays broken (`config/ci/ind1.json`).
2. Extended `playwright/api/hub-email-change.spec.ts`: a usa1 user's address
   requested from sgp sends no code and the identical challenge response;
   confirming after the address is claimed by a usa1 signup (not a same-
   tenant one) still gets 409 `EmailAddressUnavailable` and the
   `hub.email-change.rejected` audit, proving the global directory (not a
   local unique index) is the gate; after a successful change the old
   address can be signed up at usa1 and the new one gets
   registered-elsewhere there; a single consolidated ind1 case covers a
   pending confirm leaving the address unchanged on every session, a
   concurrent `RequestEmailChange` getting the in-progress 409, a same-key
   replay reaching the identical pending result, and the
   `hub_account_email_changes` row surviving a logout/re-login cycle
   (checked directly via `sqlScalarForTenant`).
3. Playwright UI: `hub-signup-completion.spec.ts` (new) mocks
   `/api/hub/complete-signup` with the homed-elsewhere problem and asserts
   the `complete-signup-homed-elsewhere` panel and its region text, mirroring
   `signup-regions.spec.ts`'s mocked-network style rather than a second real
   tenant signup. `hub-account-security.spec.ts` gained a case mocking a
   `202` confirm followed by a resolving `operations/status` poll, asserting
   the `email-change-applying` indicator and the eventual success message.
4. Audit-rollback helper: already generalized before this session
   (`installHubAuditInsertFailure` in `admin-db.ts`, used by
   `hub-audit.spec.ts`/`hub-subscriptions.spec.ts`); nothing new needed here.
5. Contract coverage: the new tests add coverage of previously-unexercised
   statuses (`hub-account-homed-elsewhere`, ind1's `202`s) rather than
   requiring new exemptions; `PLAYWRIGHT_UNTESTABLE_STATUSES`/`_VARIANTS` in
   `scripts/api-coverage-report.ts` are unchanged.
6. Added the `docs/todo.md` "Global Hub email uniqueness follow-ups" line for
   the deferred admin abuse-detection feature, and trimmed two lines from
   that section that referenced the now-dropped professional-email global
   tables.
7. Found and fixed a genuine pre-existing bug while typechecking the above:
   `playwright/api/mesh.spec.ts` and `global-directory.spec.ts` each define
   their own copy of a `freshReservation` helper that never set
   `account_email_digest`/`digest_key_id`, fields `ReserveHubPrincipalRequest`
   has required since M2's `c121359` added Hub email uniqueness to the
   directory contract. `tsc` (via `playwright typecheck`, part of
   `make test`) caught it as a type error; a random 32-byte digest plus the
   CI coordinator's configured `digest_key_id` (`909577e87ebd5395`) fixes
   both files. Neither file had ever exercised the digest-bearing fields
   before, so this was a silent gap since M2, not a regression from the M5
   scope change.

**Exact next step:** none; the plan is complete.

**Known failing tests / open issues:** none. After the review fixes, a full
`make test` passes with no contract mismatches, and every response variant
this plan added is observed by Playwright. The remaining deviation is the
signup-registered-elsewhere email naming the home region by tenant id (see
the M3 deviations below).

**Deviations from the plan (M4, in addition to the M1/M2/M3 ones below):**

- Not a plan deviation but a process mistake worth flagging for M5: the first
  M4 commit added `HubEmailChangeInProgressError`/`HubEmailChangeUnavailableError`
  to `typespec/problem/hub/email.tsp` and `.go` but missed the `.ts`
  companion (`typespec/problem/hub/email.ts`), because `make sql-check`/
  `go build`/`go vet` all stay green without it — nothing in the Go toolchain
  notices a missing TS file. It was only caught while wiring hub-ui's
  `APIErrorAlert`, which imports the TS constant directly. `make typespec-check`
  (specifically `npm run typecheck`) would have caught it immediately had it
  been run right after the `.tsp`/`.go` edit instead of only once hub-ui
  needed it. **For every M5 TypeSpec change, run `make typespec-check` in the
  same commit's verification pass, not just `go build`.**
- `FailHubAccountEmailChangeDirectly`, `MarkHubAccountEmailChangeSucceeded`,
  and `MarkHubAccountEmailChangeFailed` do not themselves resolve the
  sibling `federation_operations` row "in one statement" as plan wording
  suggested; `emailchange.Service` instead calls the pre-existing generic
  `ResolveFederationOperation` query as a second statement in the same DB
  transaction. This avoids duplicating that query's logic three times and
  matches how `complete_hub_alias_changes.go` already separates its own
  local-effect query from `ResolveFederationOperation`. Atomicity is
  preserved (same transaction, same commit); only literal single-statement-
  ness is not.
- `federation_operations.response_ciphertext` is always written as an empty,
  non-nil placeholder (`[]byte{}`), never an encrypted problem body. GU-ECH-005's
  "returns the stored problem if it reached failed" is implemented by reading
  `hub_account_email_changes.failure_reason` directly (the service always has
  that row in hand) and mapping it to a typed error/problem in Go, not by
  decoding a response payload — mirroring exactly how
  `complete_hub_alias_changes.go`'s `finalizeAliasChange`/`resolveAliasChange`
  already use an empty `ResponseCiphertext` and let `response_status` alone
  carry the signal for polling/replay.
- `GU-ECH-003 Local serialization`'s expiry description folds together
  `hub_account_email_changes.not_after` reaching this session's `s.now()`
  clock, i.e. it is checked in-process on every `Advance` call rather than
  via a separate cron sweep; matches GU-ECH-006 ("`accepted` past
  `not_after` goes to `cancelling`") without needing a dedicated query.

**Deviations from the plan (M3, in addition to the M1/M2 ones below):**

- The `hub.Server.DigestKey` and `signupcompletion.Service`'s digest field
  are typed as a locally-declared `AccountEmailDigester` interface, not
  `identitydigest.Key` directly. Required by GU-KEY-002; see the M3 summary
  above for the full explanation (the `backend/internal/routes` package
  aggregates every portal's route registration into one Go package, which
  both `global-coordinator` and `mesh-api` import for their own routes, so
  any new import in any file reachable from `routes` leaks into those
  binaries regardless of which code path is actually reachable at runtime).
- The `signup-registered-elsewhere` email template shows the raw tenant id
  (e.g. "usa1") as the "region", not a localized country name: backend Go has
  no CLDR country-name source, and adding one was judged out of scope. The
  hub-ui completion page originally did the same; the review fixes resolved
  that half by adding `hosting_country` to the homed-elsewhere problem.
- No dedicated `backend/handlers/mesh/directory_test.go` was added for the
  eight new mesh relay routes. This mirrors the pre-existing state (the mesh
  directory relay has never had its own handler-level test file for any
  operation, not just the new ones), so it is not a regression, but it does
  mean the new mesh routes are currently verified only by `go build`/`go vet`
  (interface satisfaction) and will be verified behaviorally by the M6
  Playwright API suite, which exercises the mesh relay for real against the
  CI stack. The review fixes added that Playwright coverage for all four
  mesh routes.
- Resolved by the review fixes: global outbox events were once skipped for
  the email tables, and the reaper once recorded `email_claim_released` only
  in a log line. The Org reaper already audited with the home tenant as
  actor, which the Hub reaper and pruning now follow.
- (Carried from the M1 checkpoint) GU-KEY-005 says "Update the `Tiltfile` if
  it enumerates secrets." It does not (it only calls `make dev-secrets` and
  never names an individual secret), so no Tiltfile change was made.
- (Carried from M1) `deploy/README.md` documents computing the production
  `identityDigestKeyId` with a portable `openssl`/`xxd` pipeline rather than
  a new Go CLI tool, to avoid adding a new `backend/cmd/` executable for a
  one-time operational computation. Verified to match `identitydigest.Key.ID()`
  for `dev_identity_digest_key`.
- (Carried from M1) `identitydigest.Normalize` trims only the ASCII space
  character (`strings.Trim(address, " ")`), not `strings.TrimSpace`'s full
  Unicode whitespace set, matching PostgreSQL's `btrim(text)` default
  exactly. `typespec/common.NormalizeEmailAddress` (pre-existing, unrelated)
  still uses `strings.TrimSpace`; not a behavioral regression in practice
  since `common.IsEmailAddress` never accepts other whitespace, but recorded
  per GU-KEY-003's byte-identical requirement.
- (Carried from M1) `identitydigest.Key`'s root key is
  `sha256("vetchium-identity-digest-root\x00" + secret)` with no tenant id
  folded in, unlike `credentials.DeriveKey`. Required by GU-KEY-005: the
  secret (and therefore the key) must be identical in every region.
