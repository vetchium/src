# Hub User Profile Requirements

Status: Accepted for implementation

Last updated: 2026-09-17

## 1. Purpose

This document defines the product requirements for Hub user profiles. It is
the source specification for later API, database, federation, and user
interface designs; it deliberately does not prescribe endpoint or table names.

Vetchium is a professional network centred on colleague relationships, work
history, job discovery, referrals, applications, interviews, and hiring. The
profile must support those activities. Lifestyle and creator-focused social
features are outside this scope unless they directly support professional
identity.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in
this document are to be interpreted as described by BCP 14 when, and only when,
they appear in bold.

## 2. Ownership, access, and privacy

- **PROF-GEN-001:** A Hub user's home tenant **MUST** remain authoritative for
  the user's profile and all profile writes.
- **PROF-GEN-002:** Only an authenticated Hub user **MUST** be allowed to view a
  profile. Anonymous profile viewing is not supported in this version.
- **PROF-GEN-003:** A Hub user **MUST** be able to modify only their own
  profile. A remotely owned profile **MUST** be read-only.
- **PROF-GEN-004:** Every committed profile write **MUST** create an audit event
  in the same local database transaction as the change.
- **PROF-GEN-005:** An authenticated Hub profile view **MUST** contain only the
  user's display name, permanent handle, active alias if any, resident country,
  profile picture if any, biography, websites, work experience,
  certifications, language abilities, and educational qualifications.
- **PROF-GEN-006:** A profile view **MUST NOT** expose an account email, a work
  email address or verification evidence, a Hub user DID, job preferences,
  subscription details, or security details.
- **PROF-GEN-007:** User-supplied text **MUST** be rendered as plain text and
  **MUST NOT** be interpreted as HTML or executable markup.
- **PROF-GEN-008:** Unless a field states otherwise, surrounding whitespace
  **MUST** be trimmed while meaningful internal whitespace and line breaks are
  preserved.
- **PROF-GEN-009:** Character limits **MUST** count Unicode code points, not
  encoded bytes, and **MUST** be enforced by the authoritative API.
- **PROF-GEN-010:** Live work-email, website, work-experience, certification,
  language-ability, and education records **MUST** be hard-deleted when the
  owner deletes them. Audit records **MAY** retain only a minimal,
  non-sensitive summary required for accountability.
- **PROF-GEN-011:** Display names **MUST** use the existing account rules: a
  non-empty value of no more than 200 Unicode code points after trimming.

## 3. Stable profile addressing and paid aliases

- **PROF-ADR-001:** Every Hub user **MUST** have a globally unique, permanent
  generated handle. A generated handle **MUST NOT** be released or reassigned,
  including after a plan downgrade.
- **PROF-ADR-002:** The canonical public profile URL **MUST** be
  `https://vetchium.com/u/<handle>`. It identifies the profile but **MUST NOT**
  bypass authentication or disclose profile data by itself.
- **PROF-ADR-003:** A profile QR code **MUST** contain the canonical handle URL,
  without an intermediate tracking URL. It **MUST NOT** use an alias.
- **PROF-ADR-004:** A user whose effective plan is `hub-silver-tier` or higher
  **MAY** claim one globally unique alias and share
  `https://vetchium.com/u/<alias>` as an alternate profile URL.
- **PROF-ADR-005:** An alias **MUST** contain 3 through 30 lowercase ASCII
  characters, start with a letter, and contain only letters, digits, and single
  hyphens. It **MUST NOT** end with a hyphen or contain adjacent hyphens.
- **PROF-ADR-006:** Handle-shaped values and reserved route names **MUST NOT**
  be accepted as aliases. The initial reserved list **MUST** include `api`,
  `admin`, `auth`, `help`, `jobs`, `login`, `logout`, `media`, `org`, `privacy`,
  `settings`, `signup`, `support`, `terms`, and `u`.
- **PROF-ADR-007:** An entitled user **MAY** change or delete their alias, but
  **MUST NOT** change it more than once in a rolling seven-day period.
- **PROF-ADR-008:** An alias **MUST** be released immediately when changed,
  deleted, or lost through an effective downgrade. There is no quarantine or
  redirect period, and a later owner may receive the old alias.
- **PROF-ADR-009:** Alias resolution **MUST** be treated as a convenience.
  Canonical links, QR codes, and durable references **MUST** use the permanent
  handle.

## 4. Shared domain-name contract

- **PROF-DOM-001:** Employer and educational-institution domains **MUST** use a
  single shared contract across portals and services.
- **PROF-DOM-002:** A domain **MUST** be normalized by trimming whitespace,
  converting ASCII letters to lowercase, and removing one trailing dot.
- **PROF-DOM-003:** A normalized domain **MUST** contain 3 through 253 ASCII
  characters and at least two labels. Each label **MUST** contain 1 through 63
  letters, digits, or hyphens and **MUST NOT** start or end with a hyphen.
- **PROF-DOM-004:** Empty labels, wildcards, email addresses, URLs, ports, IP
  addresses, single-label names, and raw Unicode names **MUST** be rejected.
  Internationalized domains **MUST** be supplied in ASCII Punycode form.
- **PROF-DOM-005:** Employer and institution records **MUST** store only the
  normalized domain in this version. They **MUST NOT** reference an Org record.
- **PROF-DOM-006:** Profile claims, including employer and institution domains,
  are user-supplied unless an interface explicitly says otherwise. Vetchium
  **MAY** remove claims or domains it finds unlawful, abusive, misleading,
  unsafe, or otherwise problematic, as disclosed in the user terms.

## 5. Professional-email evidence

- **PROF-WEM-001:** An owner **MUST** be able to add, verify, reverify, and
  delete professional email addresses from a private management screen.
- **PROF-WEM-002:** A user **MUST NOT** have more than one professional email
  for the same normalized domain or more than ten professional-email domains.
- **PROF-WEM-003:** Vetchium **MUST NOT** automatically send a message to a
  professional address. It **MUST** send a verification code only after the
  user explicitly requests one for that address. That request **MAY** be
  combined with adding the address in a single user action, provided the
  action the user takes is unambiguously labeled as also sending a code
  (for example, a button reading "Add and send code"). The request **MUST
  NOT** be inferred from navigation, page load, an unrelated action, or the
  mere presence of an unverified address.
- **PROF-WEM-004:** Verification **MUST** prove control of the complete address
  with a six-digit numeric one-time code sent to that address. It **MUST NOT**
  claim an employment relationship, job title, or employment period.
- **PROF-WEM-005:** A code **MUST** expire after ten minutes, be invalidated by
  successful use or issuance of a newer code for that address, and be
  invalidated after five incorrect attempts.
- **PROF-WEM-006:** A user **MUST** wait at least 60 seconds before requesting
  another code and **MUST NOT** request more than five codes in a rolling hour.
- **PROF-WEM-007:** The first successful verification **MUST** set exact
  `first_verified_at` and `last_verified_at` instants. A later successful
  verification **MUST** update `last_verified_at` and, if the row was
  superseded, clear that state: a fresh proof of control always retakes the
  address (see PROF-WEM-014).
- **PROF-WEM-008:** Verification evidence **MUST NOT** be described as valid,
  invalid, active, expired, or revoked merely because time has passed. Gaps
  between verifications are allowed.
- **PROF-WEM-009:** After one year since the last verification, the private
  owner UI **SHOULD** remind the user that they may verify the address again.
  This reminder **MUST NOT** send an account email or a professional-address
  email.
- **PROF-WEM-010:** The private owner view **MAY** show the complete address,
  pending state, and exact management details. Other Hub users **MUST NOT** see
  an address, its domain, or its verification evidence.
- **PROF-WEM-011:** Future authorized Org features, including candidate search
  by employer Orgs and recruitment agencies, **MAY** show each unique
  normalized domain and the month and year of its first and last successful
  verification. Exact instants and local parts **MUST NOT** be exposed there.
  The private management screen **MUST** tell the owner that these domains can
  be shown that way and that the addresses never are.
- **PROF-WEM-012:** Complete professional addresses and verification codes
  **MUST NOT** enter profile mesh payloads, audit-event bodies, or application
  logs.
- **PROF-WEM-013:** The private owner list **MUST** show successfully verified
  addresses in descending `last_verified_at` order. Pending addresses **MUST**
  follow them in descending creation order, with a stable identifier as the
  final deterministic tie-breaker.
- **PROF-WEM-014:** A verified professional email address **MUST** be held by
  at most one Hub user globally, across every tenant. Between two proofs of
  control of the same address, the newer proof **MUST** always win, whether
  the previous holder was in this tenant or another one, and regardless of
  which tenant the newer proof was submitted to.
- **PROF-WEM-015:** When a proof elsewhere takes an address this tenant's user
  had verified, that user's row **MUST** stop counting as verified evidence
  everywhere it is read (PROF-WEM-011's domain display included), without a
  message being sent and without revealing who holds the address now. The
  owner's private view **MUST** show that verification moved to another
  account, using PROF-WEM-008's non-judgmental wording, with an action to
  verify the address again if it is still theirs.
- **PROF-WEM-016:** This global reconciliation **MAY** lag briefly behind a
  transfer that happened at another tenant; the private view need not update
  faster than the sync interval `agent-guides/hub-profile.md` documents.
  During a global-directory outage, an affected tenant's data **MUST NOT** be
  lost: the transfer applies once connectivity returns, and a periodic
  reconciliation independently repairs any row that a lost update would
  otherwise leave stale.

## 6. Work experience

- **PROF-EXP-001:** An owner **MUST** be able to add, update, and delete work
  experience entries.
- **PROF-EXP-002:** Each entry **MUST** contain a normalized employer domain, a
  non-empty job title of at most 200 Unicode code points, and a start month.
- **PROF-EXP-003:** An entry **MAY** contain an end month, location of at most
  200 Unicode code points, and plain-text description of at most 2,000 Unicode
  code points. Employment type is not part of this version.
- **PROF-EXP-004:** Months **MUST** be between January 1900 and the current UTC
  month. When present, the end month **MUST NOT** precede the start month. An
  absent end month means the experience is current.
- **PROF-EXP-005:** Periods **MAY** overlap and **MUST NOT** be merged merely
  because they overlap or share an employer domain.
- **PROF-EXP-006:** A user **MUST NOT** have more than 50 work-experience
  entries.
- **PROF-EXP-007:** Entries **MUST** be shown with current experiences first,
  then by descending start month, with a stable identifier as the final
  deterministic tie-breaker.

## 7. Domain display

- **PROF-ICO-001:** An employer or institution domain **MUST** be shown as
  plain text. Clients **MUST NOT** load a favicon or any other image from that
  domain, and Vetchium services **MUST NOT** proxy, download, cache, inspect,
  or persist one.
- **PROF-ICO-002:** The displayed domain is user-entered and **MUST NOT** be
  used as proof of the named organization's identity.

## 8. Certifications

- **PROF-CER-001:** An owner **MUST** be able to add, update, and delete
  certification entries.
- **PROF-CER-002:** Each certification **MUST** contain a non-empty title of at
  most 200 Unicode code points and an absolute HTTPS URL of at most 2,048 ASCII
  characters.
- **PROF-CER-003:** A certification URL **MUST** have a host and **MUST NOT**
  contain credentials, user information, or a fragment.
- **PROF-CER-004:** A user **MUST NOT** have more than 50 certifications. They
  **MUST** be displayed newest-created first, with a stable identifier as the
  final deterministic tie-breaker.
- **PROF-CER-005:** A certification link **MUST** be rendered as an external
  link and **MUST NOT** imply that Vetchium verified its authenticity.

## 9. Profile picture

- **PROF-PIC-001:** A user whose effective plan is `hub-silver-tier` or higher
  **MUST** be able to add, replace, and remove a profile picture. A user below
  that tier **MUST NOT** upload or replace one.
- **PROF-PIC-002:** On effective downgrade below Silver, the profile picture
  reference **MUST** be removed and the stored object **MUST** be deleted. A
  later upgrade requires a new upload.
- **PROF-PIC-003:** An upload request body larger than 8 MiB (8,388,608 bytes)
  **MUST** be rejected before image decoding. Only decoded JPEG and
  non-animated PNG images **MUST** be accepted.
- **PROF-PIC-004:** Both dimensions **MUST** be at least 400 pixels. The longest
  dimension **MUST NOT** exceed 7,680 pixels, the shortest **MUST NOT** exceed
  4,320 pixels, and the decoded image **MUST NOT** exceed 33,177,600 pixels.
- **PROF-PIC-005:** The service **MUST** decode and re-encode the image in the
  same format to strip metadata. The sanitized result **MUST NOT** exceed 8 MiB.
  The source upload **MUST** be discarded; this version stores one rendition
  and performs no crop or resize.
- **PROF-PIC-006:** Each tenant **MUST** store its pictures in its own private
  S3-compatible SeaweedFS deployment. The database **MUST** store metadata and
  a random immutable object identifier, not the image bytes.
- **PROF-PIC-007:** A browser **MUST** obtain a short-lived, tenant-signed read
  URL rather than credentials. The initial URL lifetime **MUST** be ten minutes
  and limited to reading the selected object. Possession of an object identifier
  alone **MUST NOT** grant access.
- **PROF-PIC-008:** A profile picture **MAY** be rendered directly from the
  tenant media origin. The design **SHOULD** permit a CDN to be introduced
  later without changing profile identity or object ownership.

## 10. Biography

- **PROF-BIO-001:** Every Hub user **MUST** be able to add, replace, and remove
  a plain-text biography of at most 2,000 Unicode code points.
- **PROF-BIO-002:** A biography that is empty after normalization **MUST** be
  treated as removal.

## 11. Human-language abilities

- **PROF-LAN-001:** An owner **MUST** be able to add and delete languages from
  three independent abilities: speaking, reading, and writing.
- **PROF-LAN-002:** The selectable catalog **MUST** contain canonical,
  language-only BCP 47 tags for living spoken and sign languages, with localized
  display names derived from Unicode CLDR.
- **PROF-LAN-003:** Script and region variants, historical languages,
  constructed languages, private-use tags, arbitrary tag combinations, and
  programming languages **MUST NOT** be included in this version.
- **PROF-LAN-004:** Deprecated tags **MUST NOT** be accepted when a preferred
  replacement exists. The catalog is independent of the portal's supported UI
  locales.
- **PROF-LAN-005:** The same language **MAY** appear in multiple abilities but
  **MUST NOT** appear more than once in one ability. Each ability **MUST NOT**
  contain more than 25 languages.
- **PROF-LAN-006:** Selectors **MUST** be searchable and filterable. Displayed
  values **MUST** be sorted alphabetically by their localized CLDR name; users
  do not define an order.

## 12. Educational qualifications

- **PROF-EDU-001:** An owner **MUST** be able to add, update, and delete
  educational qualifications.
- **PROF-EDU-002:** Each entry **MUST** contain a normalized institution domain
  and a non-empty, user-supplied degree value of at most 200 Unicode code
  points. The degree is free text, not a closed vocabulary.
- **PROF-EDU-003:** An entry **MAY** contain a title of at most 200 Unicode code
  points and supporting text of at most 249 Unicode code points.
- **PROF-EDU-004:** Start and end months are independently optional. A supplied
  month **MUST** be between January 1900 and the current UTC month; if both are
  present, the end month **MUST NOT** precede the start month.
- **PROF-EDU-005:** A user **MUST NOT** have more than 30 qualifications.
  Entries with a start but no end month **MUST** be shown first in descending
  start-month order, followed by entries with a start month in descending
  start-month order, entries with only an end month in descending end-month
  order, and fully undated entries. A stable identifier **MUST** be the final
  deterministic tie-breaker in every group.

## 13. Websites

- **PROF-WEB-001:** An owner **MUST** be able to add, update, and delete
  website links, such as a code-hosting profile, a social or professional
  network profile, or a personal site. Websites are public profile fields.
- **PROF-WEB-002:** Each website **MUST** be a single absolute HTTPS URL of at
  most 2,048 ASCII characters. Its host **MUST** be a lowercase name of at
  least two labels that follow the label rules of PROF-DOM-003, with an
  optional port. An IPv4 address is not a name and **MUST** be rejected. It **MUST NOT** contain credentials, user information, or a
  fragment. A non-ASCII host **MUST** be supplied in Punycode and non-ASCII
  path or query text in percent-encoded form.
- **PROF-WEB-003:** Before validation and storage, the URL **MUST** be trimmed,
  its scheme and host converted to lowercase, and one trailing slash removed
  from the path when the URL has no query. The stored value is the normalized
  value.
- **PROF-WEB-004:** A user **MUST NOT** have more than 10 websites or two
  websites with the same normalized URL. Both limits **MUST** hold under
  concurrent requests. A save that would break either **MUST** be rejected as a
  profile conflict without changing any state.
- **PROF-WEB-005:** Websites **MUST** be shown oldest-created first, with a
  stable identifier as the final deterministic tie-breaker. Users do not define
  an order.
- **PROF-WEB-006:** Clients **MAY** derive a presentation kind from the host
  alone. A host equal to `github.com`, `gitlab.com`, `linkedin.com`, `x.com`,
  or `twitter.com`, with or without a leading `www.`, has a known kind that
  selects its icon and display name; any other host is a generic website shown
  by its host name. The kind is not stored or sent, is not verified, and
  **MUST NOT** imply that the user owns the linked profile.
- **PROF-WEB-007:** A website **MUST** be rendered as an external link that
  sends no referrer and grants the destination no reference to the opening
  page. Clients **MUST NOT** load a favicon or any other image from the linked
  host, and Vetchium services **MUST NOT** fetch, proxy, cache, or inspect it.
  The owner editor **MUST** tell the owner that Vetchium does not verify these
  links.
- **PROF-WEB-008:** The profile view **MUST** show websites in the header card
  directly under the biography, so contact points sit with the person's
  identity. The owner editor **MUST** group the fields that make up that
  header (introduction, websites, location, and profile address) before the
  history sections.

## 14. Global directory and federated reads

- **PROF-FED-001:** The platform **MUST** operate a durable global identity
  directory containing the Hub user DID, permanent handle, optional alias, and
  authoritative tenant identifier. Handles and active aliases **MUST** be
  globally unique.
- **PROF-FED-002:** The global directory service **MUST** be reachable only by
  tenant services over the private mesh and **MUST NOT** be exposed directly to
  browsers or the public internet.
- **PROF-FED-003:** A tenant **MUST** resolve an incoming handle or alias through
  its local Hub API and mesh API, use the global directory to locate the home
  tenant when needed, and request the permitted profile representation from
  that tenant over authenticated mesh HTTPS.
- **PROF-FED-004:** The home tenant **MUST** remain authoritative. A requesting
  tenant **MUST NOT** create a shadow profile. It **MAY** cache directory routes
  for a bounded period, but cached routes **MUST** be invalidatable for future
  tenant migration.
- **PROF-FED-005:** Mesh requests **MUST** use WireGuard for private network
  reachability and mutual TLS with a distinct private-CA client certificate for
  each tenant mesh API. The receiver **MUST** derive caller identity from the
  authenticated certificate, not a caller-supplied header.
- **PROF-FED-006:** Browser APIs **MUST NOT** receive mesh credentials. Mesh
  calls **MUST** be bounded by deadlines and **MUST NOT** fall back to a local
  write or an unauthenticated response.
- **PROF-FED-007:** The federated profile payload **MUST** contain only the
  fields permitted in Section 2. Professional-email data and profile-picture
  object-store credentials **MUST NOT** cross the mesh.
- **PROF-FED-008:** The global URL resolver **MUST** select the correct tenant
  and authentication flow but **MUST NOT** itself serve private profile data.

## 15. Durable cross-tenant operations

- **PROF-XTN-001:** Global claims and future cross-tenant mutations **MUST** use
  the durable command protocol in `agent-guides/federation.md`; they **MUST NOT**
  use a cross-database two-phase commit.
- **PROF-XTN-002:** A caller **MUST** durably record an operation and stable
  idempotency key before attempting a remote command. An authoritative receiver
  **MUST** commit the business mutation, audit event, command result, and outbox
  event in one local transaction and deduplicate repeated commands.
- **PROF-XTN-003:** If a command may have reached its owner but the response is
  unknown, the caller **MUST** expose a pending operation and retry the identical
  command through recovery. A connection failure known to precede transmission
  **MAY** fail synchronously.
- **PROF-XTN-004:** Outbox and inbox processing **MUST** be used for durable
  projections and notifications; an emitted event **MUST NOT** be treated as
  proof that an authoritative remote command succeeded.
- **PROF-XTN-005:** Hub signup **MUST** reserve the DID, permanent handle, and
  home tenant atomically in the global directory, create a non-loginable local
  provisioning account, conditionally activate the global claim, and only then
  activate the local account and issue a session. Retries and reconciliation
  **MUST** safely converge incomplete attempts.
- **PROF-XTN-006:** A global identity or alias mutation **MUST** fail closed
  while the global directory is unavailable. Existing local profiles and
  bounded cached routes **MAY** remain readable.

## 16. Subscription notifications

- **PROF-SUB-001:** When a paid entitlement is scheduled to end or cannot
  renew, the system **SHOULD** notify the user in the Hub UI and at their account
  email seven days and one day before the effective end, when those lead times
  remain available.
- **PROF-SUB-002:** These subscription notifications are distinct from
  professional-email verification. They **MUST NOT** be sent to a professional
  address unless it is independently the user's account email.

## 17. Explicitly deferred work

The following are not part of this implementation:

- anonymous profile views;
- Org access to professional-email domain evidence;
- Org-owned domain verification, names, logos, and other Org metadata;
- linking profile employer or institution records to Org records;
- domain blocklists and retroactive filtering or removal automation;
- image crops, resizing, responsive variants, and CDN deployment; and
- constructed, historical, script-specific, or region-specific language
  choices.

Deferred domain moderation is recorded in `docs/todo.md`. Any future Org view
of professional-email evidence requires its own authorization, privacy, and
contract design before implementation.

## 18. Implementation ledger

This checklist is the branch-local resume point for `codex/hub-profile`.
Update it only in the same commit that completes and verifies the corresponding
phase. Keep commits small enough that a future session can safely continue from
the first unchecked item after inspecting `git status` and recent commits.

- [x] Resolve product decisions and record the normative specification.
- [x] Record federation, object-storage, subscription, and profile guidance.
- [x] Add the professional-claims disclosure to the Hub terms.
- [x] Add the global directory database, schema, configuration, and local/CI/
  production orchestration.
- [x] Run the global migration and coordinator startup smoke test; migration
  version 1, the expected tables, and coordinator health were verified.
- [x] Implement and verify the generated global-directory data-access layer.
- [x] Define and verify the global-directory resolve and claim contracts.
- [x] Implement the internal global-directory resolve and claim command
  endpoints.
- [x] Integrate global handle claims with signup provisioning and
  reconciliation.
- [x] Add WireGuard-routed mutual TLS identity and authenticated global/tenant
  mesh contracts.
- [x] Add the tenant profile schema, constraints, generated query foundation,
  operation ledgers, outbox/inbox records, and lifecycle state; verify a fresh
  migration and the core profile lifecycle against PostgreSQL.
- [x] Complete profile audit snapshots, explicit query projections, negative
  constraint tests, and federation/picture recovery-path database tests.
- [x] Add SeaweedFS to every development, CI, and production tenant
  orchestration path with private authenticated S3 access and persistent data.
- [x] Give development and CI's isolated Compose networks distinct,
  configurable private subnets. Docker's default address pools could not start
  the complete four-tenant stack after the media networks were added; all
  networks were created and service health checks passed with the fixed map.
- [x] Define and generate the TypeSpec contracts and matching Go/TypeScript
  types for profile management, reads, media, and operations.
  - [x] Shared professional-domain validation and public profile read/edit
    contracts, including bounded response models and field validation.
  - [x] Owner-private professional-email list, add, explicit code-request
    (combinable with add in a single labeled action), verify, and delete
    contracts.
  - [x] Paid alias, picture-upload/remove, and shared durable-operation status
    contracts.
  - [x] Pin and verify the living-language catalog in Go and TypeScript.
  - [x] Complete the federated-read contracts and whole-contract review.
- [x] Implement Hub API profile management, remote reads, picture sanitation,
  signed media URLs, and bounded validation.
  - [x] Wire owner-only public fields, work, education, certification, and
    language writes through strict validation, idempotency, and audited SQL.
  - [x] Add private email, alias, pictures, and signed media URLs.
  - [x] Add authenticated local/peer profile reads with directory homing checks;
    pictures now receive tenant-signed media URLs.
  - [x] Add owner-private professional-email list, add, and delete APIs with
    bounded signed pagination and tenant-local storage.
  - [x] Add explicit professional-email code request, delivery, and verification.
  - [x] Add the bounded JPEG/static-PNG sanitizer and metadata-stripping tests;
    wire it to upload and object storage in the picture API milestone.
  - [x] Add the tenant S3 client and browser-origin ten-minute GET signer;
    wire its configuration and restricted media proxy in the picture API milestone.
  - [x] Declare and validate isolated S3 and media origins and secret paths
    for every development, CI, and production tenant.
  - [x] Return tenant-signed picture URLs from local and remote profile reads;
    upload lifecycle remains to be wired.
  - [x] Add restricted per-tenant media proxies and GET/HEAD-only routes to
    development, CI, Tilt, and production orchestration; validate topology,
    proxy syntax, unsigned-read denial, and bucket-list/mutation denial.
  - [x] Add idempotent owner picture removal and retryable worker deletion of
    retired and expired objects.
  - [x] Add bounded staged picture upload and atomic replacement with durable
    idempotency, expiry cleanup, and safe downgrade handling; verify the SQL
    lifecycle against the disposable tenant database.
  - [x] Expose authenticated owner-only alias state and the seven-day cooldown;
    alias mutation and global claim recovery remain to be wired.
  - [x] Make downgrade alias release conditional, cooldown-neutral, and safe
    against stale commands; reject stale directory aliases when reading the
    effective profile. Verified against the global-directory database.
  - [x] Recover queued downgrade alias releases through the global directory,
    retry unknown/transient outcomes with the original command ID, and expose
    deterministic failures in the durable operation state.
  - [x] Accept paid alias changes as idempotent, owner-bound pending operations;
    durably mark dispatch before the global call, apply successful claims only
    against the accepted local state, and atomically queue conditional release
    when a downgrade or competing profile version prevents local completion.
    Tenant SQL and completion/compensation were verified against PostgreSQL.
- [x] Bind generic federation operations to an initiating principal, expose
  authenticated owner-only Hub operation status, and verify the ownership
  predicate against a fresh migrated tenant database.
- [x] Implement workers for recovery, delivery, picture deletion, alias
  release, verification reminders, and subscription-expiry warnings.
  Downgrade alias-release and user-initiated alias-change recovery are wired.
  PROF-WEM-009's reverification reminder is deliberately owner-UI only: the
  requirement forbids sending an account or professional-address email for it,
  so it is computed from `last_verified_at` in the private list rather than by
  a worker. The subscription-expiry warning worker emits one seven-day and one
  one-day notice per period end to the account email, skips a paid-to-paid
  renewal, and collapses a short-notice cancellation to the one-day warning.
- [x] Implement the Hub profile view, editor, private professional-email
  management, alias management, QR code, and localized validation/error states.
  - [x] Add authenticated tenant-local `/u/<address>` view for local and remote
    profiles, public-field rendering, plain-text domains, localized not-found
    and outage handling, and a canonical handle-only QR code. Five browser
    cases pass.
  - [x] Add the owner public-introduction editor for display name and
    biography, with Unicode-aware validation, discard, localized loading and
    failure states, and idempotent saves. Three focused browser cases and the
    public-field API transition/validation/replay case pass.
  - [x] Add the private professional-email card: adding an address sends its
    explicit code request in the same labeled action, a six-digit
    verification step that survives a reload, an explicit request action for
    reverifying an existing address, the one-year reverification reminder,
    and confirmed deletion.
  - [x] Add the work-experience, education, certification, and language
    editors with the specification's display orders, entry caps, a shared
    bounded month selector.
  - [x] Add the paid-alias card driven by durable operation status with the
    seven-day cooldown, the plan-gated picture upload and removal, and the
    in-portal warning for an entitlement ending within seven days.
- [x] Add unit, database, API, federation-failure, deployment, and Playwright
  coverage required by the applicable guides.
  Authenticated local/remote profile read, privacy, input/auth failures,
  paid-alias claim, cooldown, global collision, owner-only operation status,
  and free-tier rejection now have focused API coverage; both new API cases
  and Playwright type checking passed.
  A full browser/API run reached 189 passes and one new profile-view 404
  assertion failure; that assertion exposed missing localized problem mapping,
  which was added and all five targeted profile-view cases then passed.
  Authoritative API coverage now also spans the professional-email lifecycle
  and privacy, the work, certification, education, and language writes with
  their ordering and boundary rejections, and the picture lifecycle from
  free-tier rejection to a tenant-signed read URL. Browser coverage spans the
  professional-email, detail-editor, alias, picture, and ending-plan flows,
  and the profile read handler's federation-failure paths are covered in Go.
  A full browser and API run is green at 221 passes with no contract
  mismatches. The report still lists missing response variants for the
  profile write endpoints, mostly malformed-JSON and idempotency-conflict
  replays that no case exercises yet.
- [x] Run the complete required verification. `make test-go`,
  `make test-go-static`, `make test-go-lint`, `make sql-check`,
  `make typespec-check`, `make repository-json-check`, the three portal
  checks, and `make playwright-test` all pass.
- [x] Add owner-managed websites (PROF-WEB-001 to PROF-WEB-008): the
  `hub_websites` table with its URL check, unique index, ten-entry trigger, and
  audited create, update, and delete; the public-profile and mesh payloads; the
  save and delete APIs; the header links in the profile view; and the
  regrouped owner editor. Database tests cover the audit events, atomic
  rollback, constraints, and racing writes; Go, TypeScript, API, and browser
  tests cover the rest. `make test` passes with 339 Playwright cases.
- [ ] Perform a final whole-diff review against this specification.
