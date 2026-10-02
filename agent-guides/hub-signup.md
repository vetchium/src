# Hub Signup and Locality

Applies to Hub signup, signup-region selection, account email uniqueness and
changes, and profile locality. Compose with [`federation.md`](federation.md),
which owns the directory commands, digest key, and claim protocol.

## Signup ownership

- A visitor chooses resident country, language, and an eligible region before
  entering personal data. A recommendation never forces placement.
- Send email, display name, and every later signup request only to the chosen
  region; it issues and redeems the verification link, which names it with
  `region=`.
- The destination tenant owns admission. Its signup-enabled setting and active,
  admin-managed email-domain allowlist are authoritative. Check the allowlist
  in SQL at both initiation and completion, and recheck region eligibility at
  completion. Approval in another tenant never counts, and there is no
  any-domain bypass.
- A completion that spent a signup token owns the request until it completes,
  fails, or is abandoned; each of those deactivates the request. A new request
  for the same address gets the same `202`, is audited `hub.signup.rejected`
  `{reason: signup_completion_in_progress}`, sends no mail, and never replaces
  it — that would strand the reservation and local user.
- No user row exists unless its completion reaches `local_created`.
- A policy refusal creates no Hub user. A replay of a completed idempotent
  request keeps its original result rather than applying current policy.

## Global account email at signup

- The account email is globally unique through the account-email digest claim
  ([`federation.md`](federation.md)).
- **GU-SIG-001** Compute the digest in Go and store it on the completion at
  prepare time and on `hub_users.email_digest` (unique). A failed completion
  records `failure_reason` (`expired` or `email_registered_elsewhere`) and, for
  the latter, the `conflicting_home_tenant_id` when known.
- The request-time answer is the same `202` whether the address is free,
  registered here, or registered at another tenant, so it never tests
  registration anywhere. Only mailbox-proven flows (the emailed notice, the
  completion) may reveal the home region. There is no unauthenticated
  homed-elsewhere answer at login — it would be an account-enumeration oracle.
- **GU-SIG-002** Resolve the digest (`resolve-hub-account-email`) before the
  idempotent transaction opens. When it names another tenant in the region
  catalog, create no signup request; in the same statement queue a
  `signup-registered-elsewhere` email and audit `hub.signup.rejected`
  `{reason: email_registered_elsewhere, home_tenant_id, resident_country}`.
  Not found, this tenant, an unknown tenant, or an error take the normal path —
  completion fails closed anyway.
- **GU-SIG-003** The `signup-registered-elsewhere` email names the home region
  by tenant id and links to sign-in there. It never carries a signup link.
- **GU-SIG-004** The completion sends the stored digest and `digest_key_id`
  with `reserve-hub-principal`. Check `directory-email-claim-conflict` before
  the handle-conflict branch and never rotate the handle for it — that loops
  through rotation and then `202` forever. On that conflict, resolve the home
  tenant (null on error) and, in one statement, fail the completion,
  deactivate the request, and audit `hub.signup.rejected`. A replay of a failed
  completion returns the error its `failure_reason` recorded.
- **GU-SIG-005** `completeSignup` answers that conflict with `409`
  `hub-account-homed-elsewhere` carrying `tenant_id` and `hosting_country`.
  When the home tenant is unknown or missing from the catalog, return the
  invalid-signup-token problem instead. The portal names the region in the
  viewer's language from `hosting_country` and offers sign-in there.

## Identity and profile locality

- A Hub user's DID is an immutable, location-neutral UUIDv7: private, never
  reused, surviving a tenant move. It never leaves the backend and private
  mesh: no portal response, stored browser session, or UI shows it. Browser
  APIs identify a Hub user by handle; the backend maps handle to DID.
- Handles are public, permanent, and globally unique: an eight-character
  prefix, a hyphen, and an 11-character random Crockford-base32 suffix that
  reveals neither the DID nor creation time. The prefix is the first eight
  ASCII letters and digits of the display name, skipping other characters and
  padded with random digits; a name with no ASCII letter or digit uses `user`
  plus random digits. Do not transliterate. The global directory decides
  uniqueness; a collision retries with a fresh suffix without consuming the
  signup request.
- Signup uses the reservation/finalization flow in `federation.md`; directory
  unavailability fails closed.
- The permanent handle URL is `https://vetchium.com/u/<handle>`. A paid alias
  is an alternate address and never replaces the canonical handle or QR
  payload.
- Initialize preferred job countries from residence. Later residence changes do
  not change job preferences, home tenant, or identity. Empty means no country
  filter.

## Account email changes

- Changing the sign-in address is a credential change. Request a code for the
  new address only from a recently authenticated session, and accept it only
  from that same session.
- The email-domain allowlist gates signup only; an email change never consults
  it.
- **GU-ECH-001** Resolve the new address's digest globally before the
  idempotent transaction. An address registered at any tenant, including this
  one, gets the same challenge response but no code. A resolve error still
  sends the code — confirm fails closed. While the user has a live change,
  return `409` `hub-email-change-in-progress` and neither issue nor supersede a
  challenge.
- **GU-ECH-002a** Keep an accepted change in `hub_account_email_changes`, never
  in the challenge row, which cascades away with its session. Logout, session
  revocation, password reset, and new challenges never affect a live change.
  One live change per user (`hub_account_email_changes_one_live`).
- **GU-ECH-002** A correct code, in one statement, consumes the challenge,
  creates the `federation_operations` row (`kind = 'hub-account-email-change'`,
  payload holding only the operation id) and the change row with stable
  reserve, finalize, and abandon command ids and `not_after` = acceptance + 24
  hours, and audits `hub.email-change.accepted`. A violation of the one-live
  index returns `hub-email-change-in-progress`.
- A wrong code records the attempt and audits
  `hub.email-change.verification-failed` but creates no operation, so its
  idempotency key binds nothing: a later confirm under any key is a fresh
  attempt. Only an accepted change replays by idempotency key.
- **GU-ECH-003** Every local transition is one statement conditioned on the
  expected state; zero rows means another driver won, so re-read and continue.
  The inline handler and the worker may drive the same change; directory calls
  are idempotent by their stable command ids.

| From | Event | To |
| --- | --- | --- |
| `accepted` | reserve succeeded | `reserved` |
| `accepted` | `directory-email-claim-conflict` | `failed` (`address_unavailable`), nothing to abandon |
| `accepted` | `reservation-expired`, `reservation-cancelled`, or local `now() >= not_after` | `cancelling` (`reservation_expired`) |
| `reserved` | local apply committed | `applied` |
| `reserved` | local unique violation at apply | `cancelling` (`address_unavailable`) |
| `applied` | finalize succeeded | `succeeded` |
| `cancelling` | abandon acknowledged | `failed` |

- `applied` never moves to `cancelling`, and `cancelling` is never applied.
- **GU-ECH-004** After accepting, the handler drives the change inline; the
  reconciliation worker (`workers.reconcileHubEmailChangeTimer`) drives the
  same `emailchange.Service.Advance`, selecting due changes by the operation's
  `next_attempt_at`. The apply statement, guarded by `state = 'reserved'`,
  updates `hub_users.email_address` and `email_digest`, revokes every other
  session except the confirming one (all of them if it is gone), deactivates
  login challenges and password reset links, queues the `email-changed` notice
  to the old address, and audits `hub.email.changed`. A terminal transition
  resolves the operation in the same transaction; failure audits
  `hub.email-change.rejected` `{reason}`.
- **GU-ECH-005** `confirmEmailChange` returns `204` on success,
  `hub-email-address-unavailable` (409) for `address_unavailable`,
  `hub-email-change-unavailable` (503, request a new code) for
  `reservation_expired`, and `202` `PendingOperation` otherwise. A replay with
  the same key returns the resolved typed result.
- **GU-ECH-006** Every live change reaches `succeeded` or `failed`. Only
  `accepted` has a deadline; `reserved` and `applied` only move forward. A
  directory refusal with no transition (a finalize state conflict, a key
  mismatch) keeps retrying and logs at error level without addresses or
  digests.
- **GU-ECH-007** On `202`, hub-ui polls `/api/hub/operations/status`, then
  replays confirm with the same key and body. Keep the accepted change in
  session storage apart from the challenge so a reload or code expiry never
  loses the replay; forget it only on `204` or a problem other than a lapsed
  session or server fault.
- Audit that the address changed, never the addresses, digests, or codes.

## Region selection

The Hub portal is one global site, so the visitor picks the region in the
browser before entering anything personal; see `ui.md` for the mechanism.

- Eligible regions come from the portal's compiled-in region table, kept equal
  to each environment's `signup-regions.json` by a repository test. There is no
  discovery API; the browser never asks any region which regions exist.
- Eligible means `signupEnabled` and an empty or matching `allowedCountries`.
  The country's recommendation preselects a region and never forces placement.
- The table and catalog are deployment configuration, not live policy. A stale
  portal may offer a region that then refuses signup; destination admission
  stays authoritative and rechecks the catalog and its own setting.
- `allowedCountries: []` means every country. Reject unknown tenant ids at
  admission, and keep tenant ids open strings, not a four-tenant enum.
- Wrong-region sign-in fails exactly like a wrong password. The chosen region
  never consults another region or the coordinator to redirect a Hub login.

## Federation and migration

Federated routing and migration use `federation.md`. In addition:

- Follow edges belong to the follower; mutual connections need a deterministic
  owner. Applications, interviews, and offers stay with the hiring Org.
- A destination rechecks its active email-domain allowlist and must offer the
  user's plan before handover. Resolve destination email collisions
  explicitly; equal emails never merge accounts. Preserve the DID and permanent
  handle.
- Derive expansion reports from aggregate tenant counts by residence and
  activity; never centralize individual business data for reporting.

Migration billing choices and other deliberately unresolved work belong in
[`../docs/todo.md`](../docs/todo.md), not inferred implementation policy.
