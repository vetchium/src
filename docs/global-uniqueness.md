# Global Uniqueness of Hub Emails — Implementation Plan

Status: accepted plan, not yet implemented. Branch: `cleanup/global-uniqueness`.

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
| Verified professional email | **global**, one Hub user holds the verification at a time | this plan |
| Hub handle / alias | global | already done |

Out of scope, listed in `docs/todo.md` by this work:

- **Hub login redirect to the home region.** It is deliberately not built. For
  Orgs the domain is public, so a homed-elsewhere answer leaks nothing. For Hub,
  an unauthenticated "this email lives in region X" answer would be an
  account-enumeration oracle. Only flows where the caller has proven control of
  the mailbox (a signup link, an emailed notice) may reveal the home region.
- **Hub account deletion.** It does not exist yet. When it is built it must
  release the account-email claim and every professional-email claim. Add a
  todo line.
- **Digest key rotation.** Build the key id hook (GU-KEY-004) but not a rotation
  procedure.
- Tenant-to-tenant outbox delivery (none exists today; see GU-PEM-008 for why
  this plan uses a pull feed instead).

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
6. **Professional email: newest proof of control wins.** Work mailboxes are
   recycled (a leaver's address is reassigned), so a claim must be
   transferable. A successful verification by user B of an address held by user
   A moves the claim to B. A's evidence for that address becomes *superseded*:
   it no longer counts as verified anywhere. A can reverify to take it back.
   Verification requires reading a code sent to the mailbox, so ping-pong needs
   real control of the mailbox.
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
- **GU-GDB-003:** Professional email claims and the supersession feed:

  ```sql
  CREATE TABLE vetchium.hub_professional_email_claims (
      email_digest bytea PRIMARY KEY CHECK (octet_length(email_digest) = 32),
      -- NULL once released; the row stays so claim_revision never restarts.
      hub_user_did uuid
          REFERENCES vetchium.hub_principals (hub_user_did) ON DELETE SET NULL,
      claim_revision bigint NOT NULL CHECK (claim_revision > 0),
      claimed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX hub_professional_email_claims_user
      ON vetchium.hub_professional_email_claims (hub_user_did);

  -- Pull feed: a tenant learns that one of its users lost a professional-email
  -- claim by polling rows addressed to it. Rows are deleted only after that
  -- tenant acknowledges them; there is no time-based pruning.
  CREATE TABLE vetchium.hub_professional_email_feed_cursors (
      tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
      last_issued_seq bigint NOT NULL DEFAULT 0 CHECK (last_issued_seq >= 0),
      acknowledged_seq bigint NOT NULL DEFAULT 0,
      CHECK (acknowledged_seq BETWEEN 0 AND last_issued_seq)
  );

  CREATE TABLE vetchium.hub_professional_email_supersessions (
      previous_home_tenant_id text NOT NULL
          REFERENCES vetchium.hub_professional_email_feed_cursors (tenant_id),
      supersession_seq bigint NOT NULL CHECK (supersession_seq > 0),
      email_digest bytea NOT NULL CHECK (octet_length(email_digest) = 32),
      previous_hub_user_did uuid NOT NULL,
      superseded_by_revision bigint NOT NULL CHECK (superseded_by_revision > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (previous_home_tenant_id, supersession_seq)
  );
  ```

  **Sequence allocation must not use an identity or sequence.** PostgreSQL
  hands out sequence values independently of commit order: T1 can take 10, T2
  take 11 and commit, and a reader advance past 11 before T1 commits, skipping
  10 forever. Instead, the transfer transaction runs:

  ```sql
  INSERT INTO hub_professional_email_feed_cursors (tenant_id)
  VALUES ($1) ON CONFLICT DO NOTHING;
  UPDATE hub_professional_email_feed_cursors
     SET last_issued_seq = last_issued_seq + 1
   WHERE tenant_id = $1
  RETURNING last_issued_seq;
  ```

  The row lock is held until commit, so sequence N+1 cannot be issued, let
  alone become visible, until N has committed or rolled back (a rollback also
  undoes the increment, leaving no gap). Per tenant, visibility order equals
  sequence order, and a cursor can advance safely. Lock order is always the
  claim row, then the cursor row, which avoids deadlocks. Transfers are rare,
  so the per-tenant serialization costs nothing measurable.

  - `claim_revision` increases strictly monotonically per digest, forever:
    - every claim (first, reverify, transfer, or claim of a released row) sets
      `revision + 1`
    - a release sets `hub_user_did = NULL` and keeps the row and revision; rows
      are never deleted

    This matters because tenants supersede a local row only when its
    `claim_revision < superseded_by_revision`. If revisions restarted after a
    release, a delayed feed row could wrongly supersede a later reclaim.
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
- **GU-DIR-007 `claim-hub-professional-email`:**
  - Request `{command_id, hub_user_did, email_digest, digest_key_id}`.
  - Upsert under a row lock:
    - **Absent:** insert at revision 1.
    - **Released (`hub_user_did IS NULL`):** set the holder and bump the
      revision.
    - **Same holder:** bump the revision by 1 and set `claimed_at = now()`, so a
      reverify is a fresh proof.
    - **Other holder:** update the holder, bump the revision, and insert a
      supersession row addressed to the previous holder's current
      `home_tenant_id` (from `hub_principals`).
  - Response:
    - `{claim_revision}`
    - `superseded_same_tenant_hub_user_did`: present only when the previous
      holder's home tenant is the caller, so the caller can supersede locally
      in the same step.
  - Never reveal a DID from another tenant here.
  - Audit `global_directory.hub_professional_email_claimed`, with payload
    `{transferred: bool}` and no digest.
- **GU-DIR-008 `release-hub-professional-email`:**
  - Request `{command_id, hub_user_did, email_digest, claim_revision}`.
  - Sets `hub_user_did = NULL` only if the row is still held by that DID at
    that revision. Otherwise it is a no-op success, because a newer proof may
    already own it.
  - Audit it only when a row changed.
- **GU-DIR-009 `pull-hub-professional-email-supersessions`**
  (caller-scoped; mutates only the caller's cursor, so it is naturally
  idempotent and does not use the command ledger):
  - Request `{acknowledged_seq, limit ≤ 500}`. `acknowledged_seq` is the
    tenant's committed watermark.
  - In one transaction:
    - if `acknowledged_seq > last_issued_seq`, return
      `DirectoryStateConflictError`. The tenant is ahead of the coordinator,
      which should not happen outside a coordinator restore; the tenant logs it
      at error level and runs the GU-PEM-009 sweep.
    - set `acknowledged_seq = GREATEST(acknowledged_seq, request)`
    - delete this tenant's rows at or below it, auditing
      `global_directory.hub_professional_email_supersessions_acknowledged`
      `{count}` only when rows were deleted
    - return rows with a higher sequence, in order, as
      `{supersession_seq, hub_user_did, email_digest, superseded_by_revision}`
  - The response also returns the stored `acknowledged_seq` and
    `oldest_pending_created_at`. When the stored value exceeds the tenant's
    request, the tenant's watermark regressed (for example, a tenant database
    restore), so rows it never applied are gone: the tenant jumps its
    watermark and runs the GU-PEM-009 sweep immediately.
- **GU-DIR-010 Reaper and prune:**
  - Extend the existing reservation reaper (`ReapExpiredHubPrincipalReservations`
    or its equivalent in `backend/internal/globaldb/queries`). Reaping a
    provisioning principal cascades its claim. Add `email_claim_released: true`
    to that audit payload.
  - Prune terminal `hub_account_email_change_reservations` older than
    `not_after + 7 days`, with a summary global audit event, run by the
    coordinator's existing periodic loop (find where the reaper is scheduled).
  - Supersession rows are **never** pruned by time, only by acknowledgment
    (GU-DIR-009). Decommissioning a tenant must delete its cursor and rows; add
    a todo line.
  - `pending_change` claims are **not** reaped by time. They leave only through
    finalize or abandon, and the tenant's durable operation always reaches one
    of them (GU-ECH-006).
- **GU-DIR-011 `check-hub-professional-email-holdings`** (read,
  caller-scoped):
  - Request: up to 500 `{hub_user_did, email_digest}`. Each DID must be homed
    at the caller, or the whole request is rejected with the caller mismatch.
  - Response, per item: `{held_by_requested_user: bool, claim_revision | null}`.
  - It never reveals another holder's DID.
  - It is the authoritative repair path for any feed loss (GU-PEM-009).

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
  - Add i18n in all locales.

### 3.6 Professional emails (tenant)

Files:

- `db/migrations/00001_init.sql`
- `backend/internal/db/queries/hub_profile_private.sql`
- `backend/handlers/hub/profile/professional_email_*.go`
- `typespec/hub/profile/professional_email.*`
- new `backend/internal/hub/professionalemail/`
- new workers `complete_hub_professional_email_claims.go` and
  `sync_hub_professional_email_supersessions.go`
- hub-ui professional email card
- `docs/hub-profile.md` §5
- `agent-guides/hub-profile.md`

- **GU-PEM-001 Schema:**
  - On `hub_professional_emails`, add:
    - `email_digest bytea NOT NULL CHECK (octet_length = 32)` (professional
      namespace), set at add time
    - `claim_revision bigint NULL`: the global revision this row last applied
    - `superseded_revision bigint NOT NULL DEFAULT 0`: the highest
      `superseded_by_revision` this tenant has learned for this (user, digest),
      recorded **even when the row is unverified**, so it fences a claim result
      that arrives late
    - `superseded_at timestamptz NULL`
  - `CHECK ((superseded_at IS NOT NULL) = (claim_revision IS NOT NULL AND
    superseded_revision >= claim_revision))`.
  - A row is *verified evidence* iff `last_verified_at IS NOT NULL AND
    superseded_at IS NULL`. Every current and future reader of verification
    status (including PROF-WEM-011 Org features and the public profile, if it
    shows verified domains) must use that predicate. Grep every query reading
    `last_verified_at`/`first_verified_at` and update it.
  - New table `global_feed_watermarks (feed text PRIMARY KEY, last_seq bigint NOT NULL CHECK (last_seq >= 0))`.
- **GU-PEM-002 Verify:** `VerifyHubProfessionalEmailChallenge` keeps its code
  checks and attempt counting. On a correct code it no longer sets the
  verification times. Instead, in the same statement, it:
  - consumes the challenge
  - creates `federation_operations` `kind = 'hub-professional-email-claim'` with
    payload `{HubUserDID, ProfessionalEmailID, EmailDigest}`
  - audits `hub.profile.professional-email-proof-accepted`

  At most one pending claim op per professional email row: a partial unique
  index on `(aggregate_id)` where the kind matches and the state is pending,
  with aggregate = the professional email id. A duplicate returns the existing
  operation.
- **GU-PEM-003 Drive:** inline plus worker, as in GU-ECH-004:
  1. `claim-hub-professional-email`.
  2. `ApplyHubProfessionalEmailClaim`, in one statement:
     - If the row still exists, belongs to the user, **and** the response
       revision is greater than both `COALESCE(claim_revision, 0)` and
       `superseded_revision`:
       - set `first_verified_at = COALESCE(first_verified_at, now())`,
         `last_verified_at = now()`, `claim_revision = response revision`,
         `superseded_at = NULL`
       - if `superseded_same_tenant_hub_user_did` is present, apply the
         GU-PEM-006 supersede rule to that user's row with the same digest,
         at the response revision, and audit
         `hub.profile.professional-email-superseded` (actor `system`) for it
       - audit the existing `hub.profile.professional-email-verified`
       - resolve the op as succeeded (`204`)
     - If the row exists but the revision check fails, a newer proof already
       won. That happens when the claim response was delayed and a
       supersession for a higher revision was applied first. Change nothing
       on the row, resolve the op as succeeded (`204`, because the proof itself
       was accepted), and audit `hub.profile.professional-email-claim-outdated`.
       The owner list shows the moved state. This rule is why
       `superseded_revision` is recorded even for rows that are not verified.
     - If the row was deleted meanwhile, resolve the op as succeeded and
       enqueue a release op (GU-PEM-005) with the response revision, in the
       same statement. Claim ops reference the row by id with no foreign key,
       so they survive its deletion and must still reach a definite directory
       result.

  The contract for `verifyProfessionalEmail` adds `202 PendingOperation`, with
  the same replay semantics.
- **GU-PEM-004 Owner view:**
  - `ProfessionalEmail` in the contract gains optional
    `superseded_at: utcDateTime`.
  - PROF-WEM-013's list shows a superseded row as "Verification moved to
    another account", with a reverify action.
  - Wording must obey PROF-WEM-008: never "valid" or "invalid".
  - Never reveal who holds the address now.
- **GU-PEM-005 Delete:** the existing delete statement also enqueues, in the
  same statement, `federation_operations` `kind = 'hub-professional-email-release'`
  with payload `{HubUserDID, EmailDigest, ClaimRevision}`. It does this only
  when the row has `claim_revision IS NOT NULL AND superseded_at IS NULL`. The
  worker drives `release-hub-professional-email` to completion, with no
  browser-visible pending state; delete stays `204`.
- **GU-PEM-006 Supersession sync worker:** on its timer:
  - read the `hub-professional-email-supersessions` watermark
  - call GU-DIR-009 with it as `acknowledged_seq`
  - for each returned row, in order, run `SupersedeHubProfessionalEmail` in one
    statement:
    - on the row matching (did, digest), whether verified or not, set
      `superseded_revision = GREATEST(superseded_revision,
      superseded_by_revision)`
    - set `superseded_at = COALESCE(superseded_at, now())` where
      `claim_revision IS NOT NULL AND claim_revision <= superseded_by_revision`
    - audit `hub.profile.professional-email-superseded` (actor `system`,
      source `workers`) only when `superseded_at` changed
    - advance the watermark to that row's sequence
  - The next pull acknowledges what was applied. The coordinator deletes rows
    only after that acknowledgment, so a crash between apply and ack causes a
    harmless re-apply, never a loss.
  - Handle a stored `acknowledged_seq` greater than the local watermark as in
    GU-DIR-009: jump the watermark and run GU-PEM-009 now.
  - Log a warning (no addresses or digests) when `oldest_pending_created_at` is
    older than 1 hour.
  - The directory being unreachable is a logged, retried no-op.
- **GU-PEM-009 Holdings sweep (repair):** a daily worker job, and an
  immediate one on watermark regression:
  - Page through this tenant's rows with `last_verified_at IS NOT NULL AND
    superseded_at IS NULL`, and call GU-DIR-011 in batches.
  - For each item that is not held by the requested user at a revision at least
    the local `claim_revision`, apply the GU-PEM-006 supersede rule using the
    returned revision. For a released row (null revision), use the local
    `claim_revision`, which still fences because the next claim bumps the
    revision.
  - Skip rows with a live claim op; the op's apply is authoritative for them.
  - This bounds the damage of any feed loss, including a coordinator or tenant
    restore, to one sweep interval.
- **GU-PEM-007:** Add `docs/hub-profile.md` requirements, continuing the
  PROF-WEM numbering:
  - a verified address is held by at most one Hub user globally
  - newest proof wins
  - superseded evidence is not verified anywhere
  - the owner is shown the moved state without learning the new holder
  - staleness is bounded by the sync interval while the tenant and
    coordinator can reach each other. During an outage, supersession applies
    when connectivity returns; nothing is lost, because feed rows persist until
    acknowledged and the holdings sweep repairs any drift.

  Mirror them in `agent-guides/hub-profile.md`.
- **GU-PEM-008 (design note, record in `federation.md`):** Supersession uses a
  caller-scoped pull feed on the coordinator, not tenant-to-tenant push. No
  tenant outbox dispatcher exists (`federation_outbox` has queries but no
  delivery worker), and the pull path reuses the existing tenant → mesh-api →
  coordinator channel. Record the three properties that make it safe:
  - sequences are allocated under a per-tenant row lock, so commit order
    equals sequence order and a cursor never skips (not an identity column)
  - rows are deleted only after acknowledgment, never by age
  - per-digest revisions are fenced on the tenant side, so replays, reordering
    and late claim results are harmless

  The holdings check (GU-DIR-011) is the authoritative repair.

### 3.7 Configuration

- **GU-CFG-001:** New `appconfig.Workers` timers:
  - `CompleteHubEmailChangesTimer`
  - `CompleteHubProfessionalEmailClaimsTimer`
  - `SyncHubProfessionalEmailSupersessionsTimer`
  - `SweepHubProfessionalEmailHoldingsTimer` (CI 5s, deploy 24h)

  Set them in `config/*.json`, `config/ci/*.json` (CI: 2s, like the Org
  timers), and `deploy/*/config.json` (1m, 1m, 5m, 24h). Validate them in
  `appconfig` with tests, following how `ReconcileOrgSignupTimer` is validated.
- **GU-CFG-002:** Wire:
  - `hub-api` main: `identitydigest.Key` into `hub.Server` and the
    signup-completion, email-change and professional-email services.
  - `workers` main: register the three jobs.
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
  `org_integration_test.go` style, new `hub_email_integration_test.go`). Each
  case asserts the ledger, audit and outbox rows, and that no digest appears in
  audit JSON:
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
  - feed ordering: two concurrent transfers to the same tenant. Hold the first
    transaction open, and assert the second blocks on the cursor row until the
    first commits (use two pool connections), so no reader can ever observe
    N+1 without N.
  - feed acknowledgment: rows persist until acknowledged, then are deleted with
    an audit; `acknowledged_seq > last_issued_seq` is a conflict; a regressed
    request returns the stored cursor
  - holdings check: held, transferred, released; a foreign DID is rejected
  - professional claim: first claim, reverify bumps the revision, transfer
    writes a supersession addressed to the right tenant, the same-tenant DID
    appears only for the same tenant
  - conditional release: current revision clears the holder, stale revision is
    a no-op, a reclaim after release gets a higher revision
  - the feed is caller-scoped
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
- `professionalemail` service and workers:
  - a late claim result below `superseded_revision` changes nothing and is
    audited as outdated
  - a supersession applied to an unverified row fences a later claim result
  - watermark regression triggers the sweep
  - the sweep supersedes drifted rows and skips rows with a live op
- `backend/internal/db` integration: each new statement's audit row and
  rollback, in the style of `org_integration_test.go`.

### 4.2 Playwright API (`playwright/api/`)

Use `lib/hub-api.ts`, Mailpit helpers, and `lib/admin-db.ts`
(`sqlScalarForTenant`, `globalSQLScalar`, `auditEventJSONForTenant`). Use
unique addresses per test and clean up fully, including global claim rows. Add
a helper that deletes claims for a DID.

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

Extend `hub-profile-professional-email.spec.ts`:

- Cross-tenant transfer: sgp A verifies W; usa1 B verifies W and gets `204`.
  Poll until A's list shows `superseded_at` (CI sync timer 2s). A reverifies,
  then B is superseded.
- Same-tenant transfer is immediate, with no polling.
- Delete releases: the global claim row's holder becomes NULL after the worker
  runs.
- ind1 verify returns `202`.

Also:

- Audit rollback: extend the failure-injection helper (generalize
  `installOrgAuditInsertFailure` from `lib/orgs-api.ts` to Hub audit actions)
  so a failing audit insert rolls back each new write.
- Contract coverage: every new response status is exercised, or listed with a
  reason where the CI stack cannot produce it (e.g. the digest key mismatch).

### 4.3 Playwright UI (`playwright/ui/`)

- Signup completion homed elsewhere: shows the message and the region link.
- Email change pending state: use ind1, or make the operation resolve.
- Professional email moved state and reverify.

## 5. Documentation updates

- `agent-guides/hub-signup.md` (GU-SIG-007)
- `agent-guides/federation.md`:
  - what the directory stores for Hub users: digests only, with the key
    location and namespaces
  - the email-change claim workflow
  - the professional-email transfer and the supersession pull feed
    (GU-PEM-008)
- `agent-guides/hub-profile.md`, `docs/hub-profile.md` (GU-PEM-007)
- `agent-guides/glossary.md`: add *Account email*, *Identity digest*,
  *Superseded professional email*
- `deploy/README.md`: the shared identity digest key and the coordinator key id
- `docs/todo.md`: the out-of-scope items from §1

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
5. Professional email claims, supersession feed worker, contracts, hub-ui,
   tests.
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
- Never allocate feed sequences from an identity or sequence (GU-GDB-003), and
  never prune feed rows by age (GU-DIR-009).
- Never read pending email-change data from the challenge row; it cascades
  with its session (GU-ECH-002a).
- Every email-change state transition is conditional on the expected state
  (GU-ECH-003). An unconditional update reintroduces the apply/cancel race.
- A professional-email claim result is applied only if its revision exceeds
  both `claim_revision` and `superseded_revision` (GU-PEM-003).
- An errored resolve at request time must not block signup or code delivery;
  the completion and confirm steps are the fail-closed points.
- Professional-email "verified" readers must all switch to the
  superseded-aware predicate (GU-PEM-001), or a transferred address keeps
  showing as verified.
- CI `ind1` has no coordinator path. Never create ind1 fixtures that need a
  claim.

## 9. Implementation ledger

- [x] GU-KEY-001..005
- [x] GU-GDB-001..004 (incl. 002a). Deviation: global_outbox_events is
      deliberately not written for these tables; see §10.
- [x] GU-DIR-001..011
- [x] GU-SIG-001..007
- [x] GU-ECH-001..004, 002a, 006 (schema, queries, `emailchange` service,
      worker, handlers, contracts). [ ] GU-ECH-005 (replay-typed-result
      responses done; not yet re-verified against a live Postgres
      integration test), [ ] GU-ECH-007 (hub-ui polling not started).
- [ ] GU-PEM-001..009
- [x] GU-CFG-001, partially: `reconcileHubEmailChangeTimer` (the
      email-change worker's timer) is added to config end to end; the
      professional-email timer is still M5 work. GU-CFG-002 (the
      identitydigest.Key wiring into hub-api and workers via the
      AccountEmailDigester interface, not the concrete type) is done, now
      also for `emailchange`.
- [x] Tests §4.1 for GU-DIR-001..011 (globaldirectory, handler, directoryclient
      layers) and for GU-SIG-001..007 (signupcompletion service: email
      conflict → failed + replay, handle conflict still rotates). §4.1's
      emailchange/professionalemail service tests belong to M4/M5.
- [ ] Tests §4.2, §4.3
- [x] Documentation §5, partially: agent-guides/hub-signup.md (GU-SIG-007) and
      docs/todo.md are updated. agent-guides/federation.md, hub-profile.md,
      docs/hub-profile.md, and glossary.md are still M4/M5/M6 work.
- [ ] `make test` green

## 10. Progress log

**Current milestone:** M4 (account email change durable operation) in
progress. Schema, queries, the `emailchange` service and worker, the
handlers, and the TypeSpec contracts are done and build/vet/unit-test clean.
Remaining for M4: the `emailchange` package's own state-machine tests
against a live Postgres (including the concurrent-`Advance` race test
GU-ECH-003 calls for), the hub-ui polling flow (GU-ECH-007), and updating
`agent-guides/hub-profile.md`/`docs/hub-profile.md`/`glossary.md`. See
"What M4 actually implemented so far" and "Exact next step" below.

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
  `auditPayload any` fields. Every new Hub-email command sets
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

**Exact next step:** Finish M4. In order:

1. Write `backend/internal/hub/emailchange/service_test.go` (or a new
   `_integration_test.go`, matching the existing convention of using
   `TENANT_DATABASE_URL` against a live Postgres for anything that touches
   real SQL) covering `Start`/`Advance` with a `fakeDirectory` test double
   (mirroring `signupcompletion/service_test.go`'s pattern): the happy path
   to `succeeded`, `address_unavailable` at reserve time, `address_unavailable`
   at local apply time (the unique-violation safety net), reservation-expired
   at reserve time and via local `not_after` expiry, and the idempotent
   replay of an already-accepted change. Then the concurrent-`Advance` race
   GU-ECH-003 calls for: two goroutines calling `Advance` on the same
   `reserved` change at once, using the conditional
   `UPDATE ... WHERE state = 'reserved'` in `ApplyHubAccountEmailChange`;
   assert only one applies (same technique as the M2 concurrent-transfer
   test — two real overlapping transactions/connections, not mocked).
2. hub-ui: extend the account security email card for the `202`/poll/replay
   flow (GU-ECH-007) — poll `/api/hub/operations/status`, then replay
   confirm with the same idempotency key; "Applying your new email…" while
   pending; i18n in all locales. Reuse whatever helper the alias editor uses
   client-side, if one exists (check `hub-ui/src/pages` and `portal-ui` for
   an existing alias-change polling helper before writing a new one).
3. Update `agent-guides/hub-profile.md` (or wherever email-change is
   documented today) and `docs/todo.md` if any M4-specific follow-up is
   discovered; `docs/hub-profile.md`/`glossary.md` updates can wait for M6's
   documentation pass unless M4 introduces a new term.
4. Commit M4 with a §9/§10 update, then start M5 (professional email
   claims) per plan §3.6, applying the same `AccountEmailDigester`-local-
   interface pattern for `professionalemail` and the same
   `ResolveFederationOperation`-reuse pattern for terminal transitions.

**Known failing tests / open issues:** none in what exists so far — every
targeted `go test` passes, including `internal/architecture` (confirms
`identitydigest` still does not leak into `global-coordinator`/`mesh-api`
via `emailchange`). Not yet done for M4: the `emailchange`
integration/concurrency tests and the hub-ui polling flow (items 1-2 above)
— `make test` will not be meaningful until at least those land, since
Playwright would otherwise exercise a confirm-email-change flow the backend
can now answer with `202` in ways the current UI doesn't handle. `make test`
(the full gate, including the CI docker stack and Playwright) has not been
run; far too much of the plan remains unimplemented for it to be meaningful
yet, and it is a long-running command better run once near the end
of M6. Open gap carried from M2: no `backend/handlers/mesh/directory_test.go`
exists (pre-existing condition, not introduced by this plan) — see the M2
summary below.

**Deviations from the plan (M4, in addition to the M1/M2/M3 ones below):**

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
  (e.g. "usa1") as the "region", not a localized country name. GU-SIG-006
  asks the **hub-ui completion page** to get a friendly region name "the same
  way as the Org signup region step (`Intl.DisplayNames`)" — but that
  technique needs a country code, and neither `HubAccountHomedElsewhereDetails`
  (only `tenant_id` and `hub_url`) nor the backend email path has one without
  fetching the full, paginated region catalog (`hubAPI.listSignupRegions`,
  up to 1000 regions) just to resolve one tenant id. The **hub-ui page**
  implementation (this M3 work) also uses the raw tenant id for the same
  reason, deferring a friendlier display name as a follow-up rather than
  adding a catalog fetch to a page that otherwise doesn't need one. Backend
  Go has no country-name-localization utility at all today (grepped); adding
  one was judged out of scope for this plan.
- No dedicated `backend/handlers/mesh/directory_test.go` was added for the
  eight new mesh relay routes. This mirrors the pre-existing state (the mesh
  directory relay has never had its own handler-level test file for any
  operation, not just the new ones), so it is not a regression, but it does
  mean the new mesh routes are currently verified only by `go build`/`go vet`
  (interface satisfaction) and will be verified behaviorally by the M6
  Playwright API suite, which exercises the mesh relay for real against the
  CI stack. If a resumed session has spare time before M6, adding that test
  file (mirroring `backend/handlers/directory/directory_test.go`'s
  `fakeService` pattern, but for `mesh.Directory`) would close this gap
  earlier.
- Global `global_outbox_events` rows are skipped for every new table in this
  plan (account email claims/reservations, professional email claims). See
  the "next step" note above for the full reasoning. This does not weaken
  any tested behavior today, since nothing consumes that table yet
  (verified by grep), but a future federation change that adds an outbox
  dispatcher must account for this gap for Hub email claims specifically.
- The reaper's `email_claim_released` marker (GU-DIR-010) is added to the
  existing structured *log* line in `backend/cmd/global-coordinator/main.go`,
  not a new `global_audit_events` row, because the reaper currently writes
  no audit event at all (confirmed by reading `service.go` and
  `main.go` in full) and adding one would require deciding how a
  system/job actor is represented in `global_audit_events.actor_tenant_id`,
  which has a `CHECK` requiring the tenant-id pattern — there is no
  precedent in the repo for a non-tenant actor there. That is a real gap
  (database.md technically requires an audit event for any mutation) but is
  pre-existing and broader than this plan; introducing a "system tenant"
  convention unilaterally here felt like the wrong place to make that call.
  Flagged for a follow-up design decision, not fixed.
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
