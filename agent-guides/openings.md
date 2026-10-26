# Openings

Applies to creating, approving, changing, and displaying Openings in the Orgs
portal, and to displaying an Org's Openings in the Hub portal. Compose with
[`orgs.md`](orgs.md), [`authorization.md`](authorization.md),
[`org-subscriptions.md`](org-subscriptions.md) (plan quota), and
[`federation.md`](federation.md) (cross-tenant Hub reads). Applications and
pipelines are in [`hiring-pipeline.md`](hiring-pipeline.md); providers in
[`marketplace.md`](marketplace.md).

## Ownership and identity

- **OPN-GEN-001** An Opening belongs to one Org and is authoritative in the
  Org's home tenant. It never enters the global directory, and no other tenant
  keeps a copy or projection of it.
- **OPN-GEN-002** Identify an Opening on the wire and in URLs by (Org domain,
  opening number). The number is a positive integer allocated per Org from a
  counter on the Org row, under the Org lock, when the Opening is created.
  Never reuse a number, including after a draft is discarded. The internal row
  id never leaves the backend.
- **OPN-GEN-003** Every Opening route, reads included, requires an active Org
  (`RequireActiveOrg`, as [`orgs.md`](orgs.md) requires of every route it does
  not list) and an authenticated Org user. Password, TOTP, and Google sign-in sessions are
  authorized identically; no Opening action requires step-up.
- **OPN-GEN-004** Every committed write appends an Opening history entry and an
  audit event in the same transaction. Neither stores description, notes, or
  salary text; they hold the opening number, action, request kind, outcome, and
  version.
- **OPN-GEN-005** Every API rule applies to every caller. Validation,
  completeness, permissions, and the approval flow live in orgs-api, never only
  in orgs-ui, so a later MCP or AI-drafting client goes through the same
  operations.
- **OPN-GEN-006** AI drafting (`draft-opening-with-ai`, [`ai.md`](ai.md))
  returns `OpeningContent` and saves nothing; the editor fills its form and the
  user saves through create or save-working-copy.

## Content

`OpeningContent` is the one shape that create, update, revise, duplicate, and
display share. A future generator or importer produces this shape; add no
source-specific fields to it.

| Field | Rule |
| --- | --- |
| `title` | 1–200 code points after trimming |
| `description` | Markdown subset (below), 1–20,000 code points |
| `language` | tag from the language catalog (`typespec/common/language_catalog.json`); a new Opening starts with the Org's default language |
| `employing_country` | `CountryCode` (ISO 3166-1 alpha-2) of the employing entity; a new Opening starts with the Org's country unless the caller's remote country list excludes it |
| `work_arrangement` | `on_site`, `hybrid`, `remote` |
| `location_details` | optional plain text, at most 2,000 code points: cities, offices, travel, time zones |
| `remote_eligibility` | required for `remote`, absent otherwise: where a candidate may live, either `worldwide` or `countries` with a list of unique `CountryCode`s that includes the employing country |
| `employment_type` | `full_time`, `part_time`, `contract`, `internship` |
| `positions` | 1–10 |
| `experience_years` | optional `min` and `max`, each 0–50, `min ≤ max` |
| `minimum_education` | optional `secondary`, `bachelor`, `master`, `doctorate` |
| `salary` | optional `currency` (active ISO 4217), whole-unit `min` and `max` (0 ≤ min ≤ max, 1 ≤ max ≤ 10^12), `period` (`hour`, `day`, `month`, `year`) |

- **OPN-CNT-001** Declare each vocabulary in TypeSpec as an extensible value on
  responses ([`typespec.md`](typespec.md)) so a portal older than its API shows
  an unknown value instead of failing.
- **OPN-CNT-002** A working copy may be incomplete: save any subset of fields,
  each valid on its own. Completeness (every non-optional field and the hiring
  manager and recruiter) is checked when a publish or revise request is made
  and again when it is approved. A refusal is `org-opening-incomplete`, listing
  every missing or invalid field at once.
- **OPN-CNT-003** Store the description as its Markdown source. Render it in
  one `portal-ui` component used by both orgs-ui and hub-ui: paragraphs, line
  breaks, headings, bold, italics, ordered and unordered lists, and links. Show
  raw HTML, images, and every other construct as literal text. Render a link
  only when its target passes the website URL validator (absolute HTTPS,
  [`hub-profile.md`](hub-profile.md) PROF-WEB-002), with
  `rel="noopener noreferrer nofollow ugc"`; otherwise show its text.
- **OPN-CNT-004** Render `location_details` and every other text field as plain
  text.
- **OPN-CNT-005** Vetchium does not verify Opening content. It may remove an
  Opening it finds unlawful, discriminatory, misleading, or abusive, as the Org
  terms disclose (moderation is in `docs/todo.md`).

## Hiring team and internal fields

- **OPN-TEAM-001** An Opening names a hiring manager and a recruiter (both
  required to publish, and they may be the same user) and 0–20 hiring team
  members, each an active user of the same Org, identified by email address
  within the Org. An unknown, disabled, or other-Org address is refused with
  `org-opening-hiring-team-invalid`.
- **OPN-TEAM-002** Internal notes are optional plain text of at most 2,000 code
  points.
- **OPN-TEAM-003** Users with `org:manage_openings` edit the hiring team and
  internal notes directly, without approval, in `draft`, `published`, or
  `paused` state. These fields never reach the Hub, so approval guards only
  what candidates see.
- **OPN-TEAM-004** Disabling a user leaves the Openings that name them
  unchanged. The Orgs portal flags a disabled hiring manager or recruiter, and
  approving a publish or revise request refuses with
  `org-opening-hiring-team-invalid` until a manager replaces them.

## Permissions

| Permission | Allows |
| --- | --- |
| `org:view_openings` | list and read every Opening of the Org, drafts included |
| `org:manage_openings` | create, edit working copies, duplicate, discard drafts, edit the hiring team and notes, make and withdraw requests |
| `org:approve_openings` | approve or reject requests; the approver's own requests apply at once |

- **OPN-AUTH-001** Add the three to the Org catalog. Store implications one hop
  each: `org:manage_openings` and `org:approve_openings` imply
  `org:view_openings`; `org:superadmin` implies all three. Update the catalog
  list in `orgs.md`.
- **OPN-AUTH-002** A user named on an Opening's hiring team who lacks
  `org:view_openings` may read only the Openings that name them, and may act on
  none of them.
- **OPN-AUTH-003** Every other Org user sees no Opening. Answer an Opening that
  the caller may not read with `org-opening-not-found`, not a permission
  problem, so a number reveals nothing.
- **OPN-AUTH-004** Delegation: an `org:manage_users` holder may grant or revoke
  `org:view_openings` and `org:manage_openings`. Only a superadmin grants or
  revokes `org:approve_openings`, because it is the control on what the Org
  publishes (`org-superadmin-required`).
- **OPN-AUTH-005** Add presets Recruiter (`org:manage_openings`) and Hiring
  approver (`org:approve_openings`) to the preset list in
  [`authorization.md`](authorization.md).
- **OPN-AUTH-006** Check permissions when each request is made and again when
  it is decided. A revoked grant stops a pending decision; the request stays
  pending for another approver.

## Lifecycle

States are `draft`, `discarded`, `published`, `paused`, `closed`, and
`expired`. Only `published` is visible to Hub users and, later, accepts
applications. Creating an Opening takes its quota slot (OPN-QTA-001); no
transition takes or returns one.

| From | Action | To |
| --- | --- | --- |
| (none) | create or duplicate | `draft` |
| `draft` | discard (no request) | `discarded` |
| `draft` | `publish` request | `published` |
| `published`, `paused` | `revise` request | same state, new live content |
| `published` | `pause` request | `paused` |
| `paused` | `reopen` request | `published` |
| `published`, `paused` | `close` request | `closed` |
| `published`, `paused` | expiry (system) | `expired` |

- **OPN-LIFE-001** Every user-initiated state or live-content change goes
  through a request. A `org:manage_openings` holder makes the request, and an
  `org:approve_openings` holder approves or rejects it.
- **OPN-LIFE-002** A request made by a user who holds `org:approve_openings`
  applies at once; the history records it as self-approved. An approver may
  also approve a pending request they made before receiving the permission.
  Test this shortcut beside the normal approval path for every request kind.
- **OPN-LIFE-003** An Opening has at most one pending request (enforce it with
  a partial unique index). A new request while one is pending is refused with
  `org-opening-request-pending`. The one exception is an approver's `close`:
  it cancels the pending request (recorded as superseded) and closes the
  Opening at once.
- **OPN-LIFE-004** Every write carries the Opening's `version` as the caller
  last read it. A mismatch is `org-opening-version-conflict`, so an approver
  always decides on exactly the content they reviewed. Every write also takes
  an `Idempotency-Key`; a replay returns the stored result.
- **OPN-LIFE-005** Rejection requires a note of 1–2,000 code points. Every
  request accepts an optional note of the same length. Both show in the
  Opening's history.
- **OPN-LIFE-006** The requester, or any `org:manage_openings` holder, may
  withdraw a pending request.
- **OPN-LIFE-007** Rejecting or withdrawing a `publish` or `revise` request
  returns its content to the editable working copy. Rejecting `pause`,
  `reopen`, or `close` leaves the state unchanged.
- **OPN-LIFE-008** `discarded`, `closed`, and `expired` are terminal. To hire
  again, duplicate the Opening into a new draft, which takes a new quota
  slot.
- **OPN-LIFE-009** An Opening expires 180 days after its first publication,
  whatever its later pauses or revisions. A `workers` job moves it in one
  state-guarded statement that cancels any pending request and writes history
  and audit. The Orgs portal shows the expiry date.
- **OPN-LIFE-010** Org suspension changes no Opening state. Hub reads hide every
  Opening of a suspended Org (OPN-HUB-004); expiry keeps running.

## Working copy and revisions

- **OPN-WC-001** Before first publication, the working copy is the draft
  itself. After it, live content is what Hub users see, and managers edit a
  separate working copy that starts from the live content. At most one working
  copy exists per Opening.
- **OPN-WC-002** A pending `publish` or `revise` request freezes the working
  copy. Withdraw the request to edit again.
- **OPN-WC-003** Approving `revise` replaces the live content atomically,
  increments the Opening's `revision`, sets `last_revised_at`, and removes the
  working copy. Hub users never see an unapproved working copy.
- **OPN-WC-004** A manager may discard a revision working copy; the live content
  stays.
- **OPN-WC-005** A manager may discard a draft never published. Discarding
  deletes its content, working copy, hiring team, and notes, and keeps a
  tombstone with the number, creation time, and history, so the number is
  never reused and the slot stays counted. The Orgs portal lists discarded
  Openings only under an explicit state filter.
- **OPN-WC-006** A manager duplicating any Opening of the Org other than a
  discarded one creates a new draft with a new number, copying content,
  internal notes, and the hiring-team members who are still active. Create and
  duplicate require an `Idempotency-Key`; a replay takes no second slot.

## Quota

- **OPN-QTA-001** Apply the counting rule in `internal/orgs/entitlements`
  (`OpeningQuota`, `WindowStart`, `CanCreate`): count the Org's Openings
  created inside the last 365 days, drafts and discarded ones included,
  whatever their state now. Check it under the Org lock in the statement that
  creates or duplicates. The quota also bounds how many drafts an Org holds.
- **OPN-QTA-002** A refusal is `org-openings-quota-exceeded`, carrying the
  quota and the count, and creates nothing.
- **OPN-QTA-003** Publishing, reopening, and revising never check or take a
  slot, so a draft created within the quota can always be published. A plan
  downgrade never unpublishes, discards, or recounts an Opening.
- **OPN-QTA-004** The Openings page shows usage (`count / quota` in the window)
  to every user who may see Openings.

## Orgs portal

- **OPN-ORG-001** The Openings list is server-side: filters for state, pending
  request kind, "awaiting my approval" (pending requests the caller may
  decide), hiring manager, recruiter, employing country, work arrangement, and
  employment type; case-insensitive title substring search (at least two
  characters); keyset pagination (at most 100); newest-updated first; and a
  summary count per state.
- **OPN-ORG-002** Callers covered only by OPN-AUTH-002 see a list limited to
  the Openings that name them.
- **OPN-ORG-003** Opening detail shows live content and state; the working copy
  and any pending request side by side with live content; the hiring team and
  notes; the expiry date; the public Hub URL
  `https://vetchium.com/org/<domain>/openings/<number>`; and the history (who,
  when, request kind, outcome, notes).
- **OPN-ORG-004** Offer a preview that renders content with the Hub
  presentation component, so a user without a Hub account sees what candidates
  will see.
- **OPN-ORG-005** Show actions only when the caller's effective permissions and
  the Opening's state allow them; the API still decides. Label an action by its
  effect: "Submit for approval" without `org:approve_openings`, "Publish" with
  it.
- **OPN-ORG-006** Ship every string in every `orgs-ui` locale.
- **OPN-ORG-007** Openings pages omit the Org name and logo from the shell
  banner; every Opening shown is the signed-in Org's own.

## Hub display

- **OPN-HUB-001** Only an authenticated Hub user may view Openings. An anonymous
  visitor to `/org/<domain>` or `/org/<domain>/openings/<number>` signs in and
  returns there. Anonymous viewing and search indexing are in `docs/todo.md`.
  Keep `NoIndex` on these routes.
- **OPN-HUB-002** `/org/<domain>` shows the Org's display name, logo (when its
  plan allows one), domain, country, and its `published` Openings, with filters for
  employing country, work arrangement, employment type, and title search, and
  keyset pagination (at most 50), ordered by first publication, newest first.
  `/org/<domain>/openings/<number>` shows one Opening.
- **OPN-HUB-003** The Hub representation is `PublicOpening`: live content,
  number, state, first publication time, `last_revised_at`, and the Org's
  domain, display name, country, and signed logo URL. Hiring team, internal notes,
  history, working copies, pending requests, version, and Org user addresses
  never reach the Hub API or cross the mesh.
- **OPN-HUB-004** Serve an Org's Openings only while the Org is active and holds
  the domain (`verified`, `failing`, or `releasing`). A suspended Org, a
  released domain, or an unknown domain is `hub-org-not-found`. A domain now
  owned by another Org shows that Org.
- **OPN-HUB-005** Detail of a `paused`, `closed`, or `expired` Opening returns
  only the title, number, and a not-accepting state, so shared links still
  explain themselves. A draft, discarded, or unknown number is
  `hub-opening-not-found`.
- **OPN-HUB-006** Never record which Hub user viewed an Org or Opening, and
  never send the viewer's identity to the Org's tenant. Every signed-in Hub
  user sees the same representation, whatever their plan or tenant.
- **OPN-HUB-007** The hub-api of the viewer's home tenant resolves the domain:
  locally first, then `resolve-org-domain` through the local mesh relay. It
  reads a remote Org from its home tenant's mesh peer endpoint, bounded by a
  deadline. A local and a remote read produce `PublicOpening` with one
  function. A transport or directory failure is `hub-org-unavailable`; never
  fall back to a cached or partial answer, and never forward an upstream
  problem.
- **OPN-HUB-008** Ship every string in every `hub-ui` locale.

## Problem types

| Type | Status | Meaning |
| --- | --- | --- |
| `org-opening-not-found` | 404 | unknown number, or not readable by the caller |
| `org-opening-version-conflict` | 409 | the Opening changed since the caller read it |
| `org-opening-request-pending` | 409 | another request is pending |
| `org-opening-state-conflict` | 409 | the action is not allowed in the current state |
| `org-opening-incomplete` | 422 | publish or revise content is incomplete; lists fields |
| `org-opening-hiring-team-invalid` | 422 | a named user is unknown, disabled, or in another Org |
| `org-openings-quota-exceeded` | 409 | quota reached; carries quota and count |
| `hub-org-not-found` | 404 | no active Org holds the domain |
| `hub-opening-not-found` | 404 | no published or formerly published Opening has the number |
| `hub-org-unavailable` | 503 | the Org's home tenant or the directory did not answer |

## Tests and fixtures

- **OPN-TST-001** Cover in `playwright/api/`: every permission (including the
  hiring-team-only reader and the user with no access), every request kind
  through approval, rejection, withdrawal, and the self-approved path, close
  superseding a pending request, version conflicts, idempotent replays, the
  quota at its edge under concurrent creations (discarded drafts still
  counting, idempotent replays taking no slot), remote eligibility,
  disabled-user and revoked-permission cases, expiry, and a suspended Org.
- **OPN-TST-002** Cover Hub reads for an Org in the viewer's tenant and in
  another tenant, a suspended Org, a released domain, and `ind1` failing closed
  with `hub-org-unavailable`. Assert that no internal field appears in any Hub
  or mesh response.
- **OPN-TST-003** `make dev-seed` gives each seeded Org Openings in every state
  except `expired` (only time reaches it, and fixtures go through the portal
  APIs), a pending request of each kind, and Recruiter and Hiring approver
  users.
