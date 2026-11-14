# Openings

Applies to creating, approving, changing, and displaying Openings in the Orgs
portal, and to displaying and searching Openings in the Hub portal. Compose with
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
| `questions` | optional, 0–10 application questions ([`hiring-pipeline.md`](hiring-pipeline.md) HP-QST) |
| `tags` | optional, 0–5 unique Opening tag OIDs (OPN-TAG), in the Org's chosen order |

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

## Tags

An Opening tag is a seeded catalog entry (an OID, [`glossary.md`](glossary.md))
an Org attaches to an Opening, such as `golang` or
`artificial-intelligence`.

- **OPN-TAG-001** The catalog is `vetchium.opening_tags` (`tag_oid`,
  `display_name`, `deprecated`) and `vetchium.opening_tag_names` (`tag_oid`,
  `language`, `display_name`), seeded in `db/migrations/00001_init.sql`, so
  every tenant holds the same rows. `vetchium_app` may only `SELECT` them.
  Add a tag by editing that seed. Never delete or rename an OID; retire a tag
  with `deprecated = true`.
- **OPN-TAG-002** A tag OID matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is 2–64
  characters. `display_name` is the English default name, 1–100 code points
  after trimming. A localized name is keyed by a base language subtag from the
  language catalog, never `en`, with the same length rule.
- **OPN-TAG-003** Seed a localized name only where it is the term job boards
  in that language use; programming-language tags carry none. The catalog
  holds at most 500 tags.
- **OPN-TAG-004** A portal shows a tag in its UI language: the localized name
  for the base language of the portal locale, else `display_name`. An OID the
  portal's catalog does not hold shows as the OID. Never use the Opening's
  `language` to pick the name.
- **OPN-TAG-005** `portal-ui` holds an optional monochrome icon per OID: path
  data from Simple Icons (CC0 1.0), with the release recorded beside the data,
  for each programming-language tag Simple Icons carries. Every other tag
  shows Ant Design `TagOutlined`. Icons are `aria-hidden`; the name is the
  accessible text.
- **OPN-TAG-006** `list-opening-tags` returns the whole catalog, deprecated
  tags included, ordered by OID: `tag_oid`, `display_name`,
  `localized_names` (language to name, `{}` when none), and `deprecated`. It
  has no pagination because of the 500-tag cap. orgs-api serves it to any
  authenticated user of an active Org, without a permission; hub-api to any
  authenticated Hub user. Portals read it once per session.
- **OPN-TAG-007** Tags are Opening content: create, save-working-copy,
  duplicate, and approval copy them like every other field, so changing the
  tags of a published Opening is a `revise`. They never count toward
  completeness (OPN-CNT-002). An empty list is stored as `NULL`, and responses
  omit `tags` when there are none.
- **OPN-TAG-008** Contract validation refuses a malformed OID, more than five,
  or a repeat, with `validation-failed` naming `content.tags` or
  `content.tags.<index>`. The write statement refuses an OID missing from the
  catalog with `org-opening-tag-unknown`, listing each unknown OID once, and
  writes nothing. A deprecated tag is accepted; pickers do not offer it unless
  the Opening already has it.
- **OPN-TAG-009** Store tags in `org_opening_contents.tag_oids text[]`,
  checked for count, nulls, repeats, and format. A trigger refuses an element
  missing from `vetchium.opening_tags`, because a foreign key cannot cover an
  array element.
- **OPN-TAG-010** AI drafting (OPN-GEN-006) returns no tags; applying a draft
  keeps the tags already in the editor.
- **OPN-TAG-011** `list-openings`, `list-org-openings`, and `list-jobs` take an
  optional `tag_oid` and list only Openings whose content (the slot each list
  already reads) holds it. A well-formed OID missing from the catalog matches
  nothing and is not an error.
- **OPN-TAG-012** The mesh carries tag OIDs only. Hub and Orgs portals
  resolve names and icons from their own catalog read.

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
  decide), hiring manager, recruiter, employing country, work arrangement,
  employment type, and tag; case-insensitive title substring search (at least two
  characters); keyset pagination (at most 100); newest-updated first; and a
  summary count per state.
- **OPN-ORG-002** Callers covered only by OPN-AUTH-002 see a list limited to
  the Openings that name them.
- **OPN-ORG-003** Opening detail shows live content and state; the working copy
  beside live content (a switch between them naming the changed fields) and
  any pending request; the hiring team and notes; the expiry date; the public
  Hub URL `https://vetchium.com/org/<domain>/openings/<number>` while the
  Opening is `published` or `paused`; and the history (who, when, request
  kind, outcome, notes).
- **OPN-ORG-004** Offer a preview that renders content with the Hub's
  `OpeningView` and the Hub page layout around it (Org header, Apply panel),
  and the application form with the Hub's `QuestionFields`
  (`@vetchium/portal-ui/openings`), so a user without a Hub account sees
  exactly what candidates will see.
- **OPN-ORG-008** The editor's Tags field is a searchable multi-select of at
  most five, matching the default name, the name in the portal language, and
  the OID (OPN-TAG-004, OPN-TAG-008). Opening detail, the preview, and Job
  detail show tags through `OpeningView` as an icon and name, after the
  facts; the working-copy switch names `tags` when they differ from live
  content, order included.
- **OPN-ORG-005** Show actions only when the caller's effective permissions and
  the Opening's state allow them; the API still decides. Label an action by its
  effect: "Submit for approval" without `org:approve_openings`, "Publish" with
  it. Disable publish and revise while `publicationGaps` names a field, listing
  the fields above the action. The editor offers "Save and publish" (or
  submit) once its checklist is complete: a save, then the request.
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
  employing country, work arrangement, employment type, tag, and title search, and
  keyset pagination (at most 50), ordered by first publication, newest first.
  Each Opening card shows its tags (`PublicOpeningSummary.tags`, `[]` when
  none) and its salary when disclosed (`PublicOpeningSummary.salary`, absent
  when none). The tag filter offers every catalog tag that is not deprecated.
  `/org/<domain>/openings/<number>` shows one Opening, tags included.
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

## Hub search

- **OPN-SRCH-001** Any signed-in Hub user, on any plan, may search the
  `published`, unexpired Openings of every Org homed in one region (tenant)
  per request. `search-openings` takes an optional `region` (`TenantID`)
  defaulting to the caller's home tenant. Never fan out to or merge several
  regions.
- **OPN-SRCH-002** hub-api answers its own region from its own database. For
  another region it calls its mesh relay (`/mesh/opening-search/search` with
  `{tenant_id, query}`), and the relay calls that tenant's peer
  (`/api/mesh/opening-search/search` with the query), which answers from its
  own database and never forwards. No viewer identity crosses the mesh
  (OPN-HUB-006); the only viewer data that may is `ideal_job_text`
  (OPN-SRCH-014). A local and a peer search build results with one function in
  `backend/internal/openingsearch`. A transport failure, deadline, unknown
  region, or undeclared peer problem is `hub-region-unavailable`; never return
  a partial or cached answer.
- **OPN-SRCH-003** An Org qualifies only under OPN-HUB-004 (active, holding
  its domain as `verified`, `failing`, or `releasing`). Results name it by
  that domain.
- **OPN-SRCH-004** Filters, each optional, combine with AND:

  | Field | Rule |
  | --- | --- |
  | `keyword` | 2–200 code points; case-insensitive substring of the live title or the Org display name |
  | `org_domain` | one `OrgDomain`; that Org's Openings only |
  | `tag_oids` | 1–5 unique OIDs; the Opening holds at least one; an OID missing from the catalog matches nothing |
  | `work_countries` | 1–10 unique `CountryCode`s where the caller may work: an `on_site` or `hybrid` Opening whose employing country is listed, or a `remote` Opening eligible `worldwide` or listing one of them |
  | `work_arrangements` | 1–3 unique values |
  | `employment_types` | 1–4 unique values |
  | `posted_within_days` | `1`, `7`, or `30`; first published within that many days |
  | `experience_years` | 0–50; the Opening states no range, or `min ≤ N ≤ max` with a missing bound open |
  | `education_level` | the caller's highest level; the Opening states no minimum, or one at or below it (`secondary` < `bachelor` < `master` < `doctorate`) |
  | `salary_disclosed` | `true` limits to Openings with a salary; `false` or absent does not filter |

- **OPN-SRCH-005** Order results by first publication, newest first, then Org
  domain ascending, then opening number descending. With `tag_oids`, order
  first by how many requested tags the Opening holds, descending. With `sort`
  `ideal_job_match`, order first by match rank (OPN-SRCH-015). Keyset
  pagination, `limit` 1–50, default 20. The key is opaque and binds every
  filter, the `sort`, a SHA-256 digest of `ideal_job_text` when present, and
  the answering tenant; a mismatch is `invalid-pagination-key`. Index the
  order without tags.
- **OPN-SRCH-006** A result is `{org: PublicOrg, opening:
  PublicOpeningSummary}` and nothing else (OPN-HUB-003). Sign each Org's logo
  once per page.
- **OPN-SRCH-007** `suggest-opening-orgs` takes an optional `region` and a
  `query` of 2–100 code points, and returns at most 10 `PublicOrg`s: Orgs
  that qualify (OPN-SRCH-003) and hold an Opening search could return, whose
  display name contains the query case-insensitively or whose domain starts
  with it, ordered by lower-cased display name, then domain. Region routing
  and failures follow OPN-SRCH-002, through `/mesh/opening-search/suggest-orgs`
  and `/api/mesh/opening-search/suggest-orgs`.
- **OPN-SRCH-008** Neither operation stores, logs, or audits the query, the
  ideal-job text, or the viewer, at hub-api, the relay, or the peer.
- **OPN-SRCH-009** hub-ui `/openings`, with a navigation entry "Openings"
  after Home, offers every OPN-SRCH-004 filter: a keyword box; a region picker
  over every compiled region, starting at the session's region; a one-Org
  typeahead from `suggest-opening-orgs` (at least two characters, debounced),
  cleared when the region changes; a tag multi-select of catalog tags not
  deprecated (at most five); a country multi-select (at most ten, starting
  empty); arrangement and employment-type multi-selects; date posted;
  experience years; education; and a salary-disclosed switch. Keep every filter
  in the URL (`q`, `region`, `org`, repeated `tag`, `country`, `arrangement`,
  `employment`, then `posted`, `experience`, `education`, `salary`,
  `sort`), drop a hand-edited value the API would refuse instead of sending
  it, and restart paging on any change. Keep `NoIndex`.
- **OPN-SRCH-010** A result card shows the Org logo and display name (linking
  `/org/<domain>`), the title (linking `/org/<domain>/openings/<number>`),
  employing country, work arrangement, employment type, salary when disclosed,
  tags, and first publication date. The page shows loading, no results, and
  region-unavailable states, and every other failure through `APIErrorAlert`.
- **OPN-SRCH-011** The Hub Home page shows a keyword box that opens
  `/openings?q=<keyword>`, or `/openings` when empty.
- **OPN-SRCH-012** Ship every string in every `hub-ui` locale.
- **OPN-SRCH-013** `search-openings` takes `sort?`: `newest` (default,
  OPN-SRCH-005) or `ideal_job_match`. For `ideal_job_match`, hub-api reads the
  caller's saved `ideal_job` (PROF-JOB-001) from its own database; the browser
  never sends the text. With none saved the answer is `hub-ideal-job-missing`,
  for every region. Every OPN-SRCH-004 filter still applies.
- **OPN-SRCH-014** For another region, hub-api sends the text as the query's
  `ideal_job_text`, and only when the user chose `ideal_job_match` for that
  search; never with a viewer identity. The peer uses it only to match and
  rank, and never logs, stores, or audits it. Any other Hub-user attribute
  sent with a search needs its own privacy review first: combined non-PII
  fields can re-identify a person.
- **OPN-SRCH-015** `ideal_job_match` lists only Openings whose search document
  shares at least one lexeme with the text, ordered by PostgreSQL `ts_rank`
  descending, then the OPN-SRCH-005 order. Use the language-neutral `simple`
  configuration for both sides. The document weights the live title `A`, the
  tag OIDs with hyphens as spaces `B`, and the description `C`. The query is
  the OR of the text's lexemes, each quoted and escaped. Text with no lexeme
  matches nothing. Keep the document as a stored generated column with a GIN
  index.
- **OPN-SRCH-016** `/openings` offers a sort control, "Newest" or "Best match
  for my ideal job" (URL `sort=match`; absent means newest). Without a saved
  ideal job the match option is disabled with a link to
  `/settings/preferences`, and a `sort=match` URL is dropped. A
  `hub-ideal-job-missing` answer shows that link in an alert.

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
| `org-opening-tag-unknown` | 422 | a tag OID is not in the catalog; carries `tag_oids` |
| `hub-org-not-found` | 404 | no active Org holds the domain |
| `hub-opening-not-found` | 404 | no published or formerly published Opening has the number |
| `hub-org-unavailable` | 503 | the Org's home tenant or the directory did not answer |
| `hub-region-unavailable` | 503 | the searched region did not answer or is unknown |
| `hub-ideal-job-missing` | 422 | `ideal_job_match` sort without a saved ideal job |

## Tests and fixtures

- **OPN-TST-001** Cover in `playwright/api/`: every permission (including the
  hiring-team-only reader and the user with no access), every request kind
  through approval, rejection, withdrawal, and the self-approved path, close
  superseding a pending request, version conflicts, idempotent replays, the
  quota at its edge under concurrent creations (discarded drafts still
  counting, idempotent replays taking no slot), remote eligibility,
  disabled-user and revoked-permission cases, expiry, and a suspended Org.
- **OPN-TST-004** Cover tags in `playwright/api/`: the catalog read from both
  APIs (seeded names, a localized name, a deprecated flag), tags through
  create, save, duplicate, and an approved and a rejected `revise`, each
  validation refusal, `org-opening-tag-unknown` writing nothing, and the
  `tag_oid` filter on all three lists, including a remote-tenant Org for the
  Hub and a remote client for Jobs.
- **OPN-TST-002** Cover Hub reads for an Org in the viewer's tenant and in
  another tenant, a suspended Org, a released domain, and `ind1` failing closed
  with `hub-org-unavailable`. Assert that no internal field appears in any Hub
  or mesh response.
- **OPN-TST-005** Cover search in `playwright/api/`: each filter on both sides
  of its boundary (date posted, experience bounds, education order, remote
  eligibility `worldwide` and `countries`, on-site and hybrid countries), tag
  ranking, ordering, pagination and a key reused under changed filters, a
  remote region (`usa1`) through the mesh, a region no peer answers as
  `hub-region-unavailable` (CI `ind1` lacks only the coordinator, which
  search never calls), exclusion of drafts, paused, closed, and expired
  Openings, suspended Orgs, and released domains, `suggest-opening-orgs`, and
  no internal field in any Hub or mesh response. Cover `ideal_job_match`:
  title, tag, and description matches ranked in that order, no shared word
  excluded, other filters still applied, an apostrophe and a backslash in the
  text, punctuation-only text matching nothing, `hub-ideal-job-missing`, a
  key reused after the ideal job changed, and a `usa1` search through the
  mesh. Other tests publish in the same tenants at once, so assert within
  unique titles or `org_domain`.
- **OPN-TST-003** `make dev-seed` gives each seeded Org Openings in every state
  except `expired` (only time reaches it, and fixtures go through the portal
  APIs), a pending request of each kind, Recruiter and Hiring approver
  users, tags on most published Openings, and published Openings that vary
  salary, remote eligibility, experience, and education so every search
  filter matches some.
