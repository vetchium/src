# Hub Profile

Applies to Hub profile fields, profile views and editors, professional-email
evidence, profile addresses, and aliases.

Picture storage and signed media are in
[`object-storage.md`](object-storage.md); plan gating and downgrade cleanup in
[`hub-subscriptions.md`](hub-subscriptions.md); the global directory, alias
claim saga, mesh trust, and durable commands in
[`federation.md`](federation.md); handle format in
[`hub-signup.md`](hub-signup.md).

## Ownership and privacy

- The home tenant is authoritative for the profile and every profile write.
- **PROF-GEN-002** Only an authenticated Hub user may view a profile; anonymous
  viewing is not supported.
- **PROF-GEN-003** A Hub user edits only their own profile. A remotely owned
  profile is read-only.
- Audit every committed profile write in the same local transaction as the
  change.
- A profile view holds only display name, permanent handle, active alias,
  resident country, picture, biography, websites, work experience,
  certifications, language abilities, and educational qualifications.
- **PROF-GEN-006** A profile view never exposes the account email,
  professional-email addresses or evidence, the Hub user DID, job preferences,
  subscription details, or security details.
- The owner's profile editor holds only the view fields. Private account data
  (sign-in email, language and job-search preferences, professional-email
  evidence) belongs on settings pages.
- Render user-supplied text as plain text, never as HTML or markup. Treat
  professional claims as unverified unless a contract gives Vetchium a
  verification role.
- Trim surrounding whitespace unless a field says otherwise; keep internal
  whitespace and line breaks.
- Count character limits in Unicode code points and enforce them in the
  authoritative API.
- **PROF-GEN-010** Hard-delete live professional-email, website, work,
  certification, language, and education records when the owner deletes them.
  The audit record keeps only a minimal non-sensitive summary.
- Display name: non-empty, at most 200 code points after trimming.
- Biography: plain text, at most 2,000 code points, open to every Hub user. A
  value empty after normalization removes it.
- Vetchium may remove claims or domains it finds unlawful, abusive, misleading,
  unsafe, or otherwise problematic, as the Hub terms disclose.

## Addresses and aliases

- Every Hub user has a globally unique, permanent generated handle, never
  released or reassigned, including after a downgrade.
- **PROF-ADR-002** The canonical profile URL is
  `https://vetchium.com/u/<handle>`. It identifies the profile but neither
  bypasses authentication nor discloses profile data.
- The profile QR code holds the canonical handle URL directly: no tracking
  redirect, never an alias. Canonical links and durable references use the
  handle; alias resolution is a convenience.
- A user on `hub-silver-tier` or higher may hold one globally unique alias,
  shared as `https://vetchium.com/u/<alias>`. Every alias set request, release
  included, requires Silver.
- An alias has 3–30 lowercase ASCII characters, starts with a letter, and holds
  letters, digits, and single hyphens, with no trailing or adjacent hyphen.
  Reject handle-shaped values and the reserved names `api`, `admin`, `auth`,
  `help`, `jobs`, `login`, `logout`, `media`, `org`, `privacy`, `settings`,
  `signup`, `support`, `terms`, `u` (`directory.IsHubAlias`).
- A user-initiated claim, change, or release is allowed once per rolling seven
  days. The cooldown, a pending change, or re-setting the current alias returns
  `hub-profile-conflict`.
- Release an alias immediately when changed, deleted, or lost by downgrade: no
  quarantine or redirect, and another user may claim it next.

## Professional domains

- Employer and institution domains use one contract,
  `common.ProfessionalDomain` in Go and TypeScript: trim, lowercase ASCII, drop
  one trailing dot.
- A normalized domain has 3–253 ASCII characters and at least two labels; each
  label has 1–63 letters, digits, or hyphens and does not start or end with a
  hyphen. Reject empty labels, wildcards, email addresses, URLs, ports, IP
  addresses, single-label names, and raw Unicode (require Punycode).
- Store only the normalized domain, never an Org foreign key. Future Org display
  metadata does not change ownership.
- Show a domain as plain text and never as proof of the organization's
  identity. Never load a favicon or other image for it, and never proxy,
  download, cache, inspect, or persist one server-side — hub-ui's CSP `img-src`
  allows only `'self'`, `data:`, and tenant media origins.

## Professional-email evidence

- The owner adds, verifies, reverifies, and deletes professional addresses on a
  private settings page (`WorkEmailsPage`), never the profile page.
- **PROF-WEM-002** At most one address per normalized domain and ten addresses
  per user.
- **PROF-WEM-003** Send a professional address only a verification code the
  user explicitly requested for it. One action may add the address and request
  the code only when labeled as doing both ("Add and send code"); never infer a
  request from navigation, page load, an unrelated action, or an unverified row.
- Verification proves control of the complete address with a six-digit numeric
  code. It never claims an employment relationship, title, or period.
- A code expires after ten minutes and is invalidated by use, by a newer code
  for the address, or after five wrong attempts.
- **PROF-WEM-006** Per address, allow one code request per 60 seconds and five
  per rolling hour; refuse others with `rate-limit-exceeded`.
- The first success sets `first_verified_at` and `last_verified_at`; later
  successes update only `last_verified_at`.
- Never call evidence valid, invalid, active, expired, or revoked because time
  passed. Gaps between verifications are allowed.
- One year after `last_verified_at`, the owner UI says the user may reverify.
  The reminder is UI-only: never email the account or professional address.
- Only the owner sees addresses, pending state, and management details. Other
  Hub users never see an address, its domain, or its evidence.
- Future authorized Org features (candidate search by employers and agencies)
  may show each verified normalized domain with the month and year of its first
  and last verification, never exact instants or local parts. The settings page
  tells the owner so. Such an Org view needs its own authorization, privacy, and
  contract design first.
- Complete addresses and codes never enter mesh payloads, audit-event bodies, or
  logs.
- **PROF-WEM-013** List verified addresses by descending `last_verified_at`,
  then pending ones by descending creation, with a stable id as the final
  tie-breaker.

## Work experience

- Require employer domain, job title (1–200 code points), and start month.
  Optional: end month, location (≤200), description (≤2,000). There is no
  employment type.
- **PROF-EXP-004** Months are `YYYY-MM` from 1900-01 through the current UTC
  month; the end month does not precede the start. No end month means current.
- Keep overlapping periods and repeated employers as separate entries.
- At most 50 entries.
- **PROF-EXP-007** Show current entries first, then descending start month, with
  a stable id as the final tie-breaker.

## Education

- Require institution domain and degree (1–200 code points, free text, not a
  closed vocabulary). Optional: title (≤200), supporting text (≤249).
- **PROF-EDU-004** Start and end months are independently optional, each from
  1900-01 through the current UTC month; when both exist, the end does not
  precede the start.
- **PROF-EDU-005** At most 30 entries. Show start-only entries by descending
  start, then entries with both months by descending start, then end-only by
  descending end, then undated; a stable id breaks ties in every group.

## Certifications

- Require a title (1–200 code points) and credential URL.
- **PROF-CER-003** The URL is absolute HTTPS, at most 2,048 ASCII characters,
  with a host and no credentials, user information, or fragment.
- **PROF-CER-004** At most 50 entries, newest-created first, with a stable id as
  the final tie-breaker.
- Render the link as external, never implying Vetchium verified it.

## Language abilities

- Speaking, reading, and writing are independent lists the owner adds to and
  deletes from.
- **PROF-LAN-003** Accept only tags in
  `typespec/hub/profile/language_catalog.json`: canonical language-only BCP 47
  tags for living spoken and sign languages, generated by
  `typespec/scripts/generate-language-catalog.mjs` from pinned ISO 639-3 and
  CLDR. No script or region variants, historical, constructed, private-use, or
  combined tags, or programming languages. Never accept a tag for matching the
  two- or three-letter shape.
- **PROF-LAN-004** Reject a deprecated tag that has a preferred replacement. The
  catalog is independent of the portal's UI locales.
- **PROF-LAN-005** A language may appear in several abilities but once per
  ability; at most 25 per ability.
- **PROF-LAN-006** Selectors are searchable. Display sorted by localized CLDR
  name, using CLDR locale fallback when untranslated; users set no order.

## Websites

- **PROF-WEB-001** Websites (code host, social or professional network, personal
  site) are public profile fields the owner adds, updates, and deletes.
- **PROF-WEB-002** A website is one absolute HTTPS URL of at most 2,048 ASCII
  characters. Its host is a lowercase name of at least two labels under the
  domain label rules, with an optional port. Reject an IPv4 host, credentials,
  user information, and fragments. Require a Punycode host and percent-encoded
  non-ASCII path or query.
- **PROF-WEB-003** Normalize before validating: trim, lowercase scheme and host,
  and drop one trailing path slash when there is no query. Store only the
  normalized URL. Go, TypeScript, and the `hub_websites_url_check` constraint
  implement the same check; change them together.
- **PROF-WEB-004** At most 10 websites and no duplicate normalized URL, both
  enforced under concurrency. A violating save returns `hub-profile-conflict`
  and changes nothing.
- **PROF-WEB-005** Show oldest-created first, with a stable id as the final
  tie-breaker; users set no order.
- **PROF-WEB-006** A client may derive a presentation kind from the host alone:
  `github.com`, `gitlab.com`, `linkedin.com`, `x.com`, and `twitter.com`, with
  or without `www.`, get an icon and name; any other host is a generic website
  shown by host name. Never store, send, or trust the kind, or imply the user
  owns the linked profile.
- **PROF-WEB-007** Link only a value passing the shared validator — a peer
  tenant's payload is not a trusted `href` — with `rel="noopener noreferrer"`.
  Use local icons; never load an image from the linked host or fetch, proxy,
  cache, or inspect it server-side. The owner editor says Vetchium does not
  verify links.
- **PROF-WEB-008** The profile view shows websites in the header card under the
  biography. The owner editor groups introduction, websites, location, and
  profile address before the history sections.

## Federated reads and commands

- Resolve a handle or alias locally, then through the global directory, and
  read a remote profile from its home tenant over the mesh
  ([`federation.md`](federation.md#reads-and-privacy)). Never keep a shadow
  profile.
- **PROF-FED-006** Bound every mesh read by a deadline. A transport failure
  returns `hub-profile-unavailable`; never fall back to a local write, a local
  read, or an unauthenticated response, and never forward another upstream
  problem to the browser.
- **PROF-FED-007** The federated payload is `PublicProfile`, the view fields
  only. Professional-email data and object-store credentials never cross the
  mesh; a picture crosses as a tenant-signed URL.
- The global `/u/<slug>` resolver picks the tenant and authentication flow and
  never serves profile data.
- **PROF-XTN-002** Global claims and cross-tenant profile mutations use the
  durable command protocol in
  [`federation.md`](federation.md#durable-cross-tenant-commands): record the
  operation and idempotency key before the remote call; the receiver commits
  mutation, audit, result, and outbox together and deduplicates. Never use a
  cross-database two-phase commit.

## Fixtures

- Profile fixtures under `dev/hub-seed-profiles/` never point at a real person's
  account or credential. Website and credential URLs use a reserved
  `example.com` or `example.dev` host, such as
  `https://github.example.com/priya-ramachandran-example` — dev-seed output and
  logs would expose them.
