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
  -- claim by polling rows addressed to it. Pruned after 30 days.
  CREATE TABLE vetchium.hub_professional_email_supersessions (
      supersession_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email_digest bytea NOT NULL CHECK (octet_length(email_digest) = 32),
      previous_hub_user_did uuid NOT NULL,
      previous_home_tenant_id text NOT NULL
          CHECK (previous_home_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
      superseded_by_revision bigint NOT NULL CHECK (superseded_by_revision > 0),
      created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX hub_professional_email_supersessions_tenant
      ON vetchium.hub_professional_email_supersessions
         (previous_home_tenant_id, supersession_seq);
  ```

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
  - Request `{command_id, hub_user_did, new_email_digest, digest_key_id}`.
  - Inserts a `pending_change` claim.
  - If the user already has a `pending_change` claim for a different digest,
    delete it first. The tenant allows only one in-flight change per user, so
    an existing one is abandoned.
  - The digest held by anyone, including this user's own current claim,
    returns `directory-email-claim-conflict`. The tenant pre-checks
    "unchanged address" locally.
  - Audit `global_directory.hub_account_email_change_reserved`.
- **GU-DIR-005 `finalize-hub-account-email-change`:**
  - Request `{command_id, hub_user_did, new_email_digest}`.
  - Deletes the user's `active` claim and promotes the `pending_change` claim
    for `new_email_digest` to `active`.
  - If that digest is already this user's `active` claim, answer success without
    a change (`changed: false`).
  - If the claim is missing or belongs to someone else, return
    `DirectoryStateConflictError`.
  - Audit `global_directory.hub_account_email_changed`.
- **GU-DIR-006 `abandon-hub-account-email-change`:**
  - Request `{command_id, hub_user_did, new_email_digest}`.
  - Deletes that user's `pending_change` claim for the digest.
  - It is a no-op success if the claim is absent.
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
- **GU-DIR-009 `list-hub-professional-email-supersessions`** (read,
  caller-scoped):
  - Request `{after_seq, limit ≤ 500}`.
  - Returns rows where `previous_home_tenant_id = caller` and
    `supersession_seq > after_seq`, ordered by sequence, as
    `{supersession_seq, hub_user_did, email_digest, superseded_by_revision}`.
- **GU-DIR-010 Reaper and prune:**
  - Extend the existing reservation reaper (`ReapExpiredHubPrincipalReservations`
    or its equivalent in `backend/internal/globaldb/queries`). Reaping a
    provisioning principal cascades its claim. Add `email_claim_released: true`
    to that audit payload.
  - Add `PruneHubProfessionalEmailSupersessions` (older than 30 days) with a
    summary global audit event, run by the coordinator's existing periodic loop
    (find where the reaper is scheduled).
  - `pending_change` claims are **not** reaped by time. The home tenant's
    durable operation always ends in finalize or abandon (GU-ECH-006).
    Reaping could release an address that a local account already switched to.

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
- **GU-ECH-002 Confirm:** `ConfirmEmailChange` runs the new
  `VerifyHubEmailChangeChallenge` in place of `ConfirmHubEmailChange`. In one
  statement it:
  - checks the code with today's attempt counting and committed failure on a
    wrong code
  - marks the challenge `verified_at` (new column; the challenge must no longer
    expire once verified)
  - creates a `federation_operations` row with `kind = 'hub-account-email-change'`,
    `target_authority = 'global-directory'`, aggregate = the user DID, and
    payload
    `emailchange.Payload{HubUserDID, ChallengeID, NewEmailDigest, OldEmailDigest}`.
    It carries digests only; the new address stays in the challenge row.
  - audits `hub.email-change.verified`
- **GU-ECH-003:** Add a partial unique index so a user has at most one pending
  email-change operation:
  `ON federation_operations (aggregate_id) WHERE kind = 'hub-account-email-change' AND state = 'pending'`.
  A second confirm while one is pending gets a new problem,
  `hub-email-change-in-progress` (409).
- **GU-ECH-004 Drive:** after committing GU-ECH-002, the handler drives the
  operation inline through `emailchange.Service.Advance`, bounded by a few
  seconds. The worker runs the same `Advance`. Steps:
  1. `reserve-hub-account-email-change`.
     - Conflict: in one statement, resolve the op as failed with stored
       response `409 EmailAddressUnavailableError`, consume the challenge, and
       audit `hub.email-change.rejected` `{reason: 'address_unavailable'}`.
       Stop.
  2. Local apply with the new `ApplyHubEmailChange`. This is today's
     `ConfirmHubEmailChange` effects, minus the code check, in one statement:
     - update `email_address` and `email_digest`
     - consume the challenge
     - revoke the user's sessions other than the confirming one
     - deactivate login challenges and reset tokens
     - queue the `email-changed` notice to the old address
     - audit `hub.email.changed`

     Whether the local change has happened is derived from
     `hub_users.email_digest = NewEmailDigest`, so no extra step column is
     needed. A local unique violation on `hub_users_email_address_key` or
     `email_digest` (unexpected once globally claimed) runs abandon and then
     fails the op with the 409.
  3. `finalize-hub-account-email-change`, then resolve the op as succeeded
     (`204`).
- **GU-ECH-005 Responses:** `confirmEmailChange` adds `202`
  `Vetchium.Hub.Operations.PendingOperation` and the in-progress 409 to its
  contract. It keeps `204`, the code-rejected problem, and
  `EmailAddressUnavailable`. It returns:
  - `204` if `Advance` finished in time
  - the stored 409 on a conflict
  - `202` otherwise

  A replay with the same idempotency key returns the resolved typed result, as
  alias change does.
- **GU-ECH-006 Deadline:**
  - If step 1 has not definitely succeeded before `expires_at` (24 h), the
    worker sends abandon until it is acknowledged, then fails the op with a
    stored `503`-class problem and audits `hub.email-change.abandoned`.
  - After step 2 has happened locally, never abandon. Finalize is retried until
    it succeeds, and a `DirectoryStateConflict` at finalize is logged at error
    level (without addresses) for operator attention.
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
    - `claim_revision bigint NULL`
    - `superseded_at timestamptz NULL`
  - `CHECK (superseded_at IS NULL OR first_verified_at IS NOT NULL)`.
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
     - If the row still exists and belongs to the user:
       - set `first_verified_at = COALESCE(first_verified_at, now())`,
         `last_verified_at = now()`, `claim_revision = response revision`,
         `superseded_at = NULL`
       - if `superseded_same_tenant_hub_user_did` is present, supersede that
         user's row with the same digest where
         `claim_revision < response revision`, and audit
         `hub.profile.professional-email-superseded` (actor `system`) for it
       - audit the existing `hub.profile.professional-email-verified`
       - resolve the op as succeeded (`204`)
     - If the row was deleted meanwhile, resolve the op as succeeded and
       enqueue a release op (GU-PEM-005) in the same statement.

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
  - call GU-DIR-009
  - for each row, run `SupersedeHubProfessionalEmail` in one statement:
    - set `superseded_at = now()` where did and digest match and
      `claim_revision < superseded_by_revision`
    - audit `hub.profile.professional-email-superseded` (actor `system`,
      source `workers`) only when a row changed
    - advance the watermark to that row's sequence
  - The directory being unreachable is a logged, retried no-op.
- **GU-PEM-007:** Add `docs/hub-profile.md` requirements, continuing the
  PROF-WEM numbering:
  - a verified address is held by at most one Hub user globally
  - newest proof wins
  - superseded evidence is not verified anywhere
  - the owner is shown the moved state without learning the new holder
  - staleness is bounded by the sync interval

  Mirror them in `agent-guides/hub-profile.md`.
- **GU-PEM-008 (design note, record in `federation.md`):** Supersession uses a
  caller-scoped pull feed on the coordinator, not tenant-to-tenant push. No
  tenant outbox dispatcher exists (`federation_outbox` has queries but no
  delivery worker), and the pull path reuses the existing tenant → mesh-api →
  coordinator channel. The feed carries a monotonic sequence and per-row
  revision, so replays and reordering are harmless.

### 3.7 Configuration

- **GU-CFG-001:** New `appconfig.Workers` timers:
  - `CompleteHubEmailChangesTimer`
  - `CompleteHubProfessionalEmailClaimsTimer`
  - `SyncHubProfessionalEmailSupersessionsTimer`

  Set them in `config/*.json`, `config/ci/*.json` (CI: 2s, like the Org
  timers), and `deploy/*/config.json` (1m, 1m, 5m). Validate them in
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
    pending replaced, finalize without pending
  - professional claim: first claim, reverify bumps the revision, transfer
    writes a supersession addressed to the right tenant, the same-tenant DID
    appears only for the same tenant
  - conditional release: current revision clears the holder, stale revision is
    a no-op, a reclaim after release gets a higher revision
  - the feed is caller-scoped
  - prune
  - digest key mismatch
  - caller tenant mismatch
- `signupcompletion`: email conflict → failed, registered elsewhere; handle
  conflict still rotates; replay of a failed completion. Use a fake directory.
- `emailchange` and `professionalemail` services and the three workers: state
  machines with a fake directory. Cover the deadline abandon and the
  never-abandon-after-local-apply rule.
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
- A second confirm while one is pending gets the in-progress 409.

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
- `pending_change` claims must never be reaped by time (GU-DIR-010).
- An errored resolve at request time must not block signup or code delivery;
  the completion and confirm steps are the fail-closed points.
- Professional-email "verified" readers must all switch to the
  superseded-aware predicate (GU-PEM-001), or a transferred address keeps
  showing as verified.
- CI `ind1` has no coordinator path. Never create ind1 fixtures that need a
  claim.

## 9. Implementation ledger

- [ ] GU-KEY-001..005
- [ ] GU-GDB-001..004
- [ ] GU-DIR-001..010
- [ ] GU-SIG-001..007
- [ ] GU-ECH-001..007
- [ ] GU-PEM-001..008
- [ ] GU-CFG-001..002
- [ ] Tests §4.1, §4.2, §4.3
- [ ] Documentation §5
- [ ] `make test` green
