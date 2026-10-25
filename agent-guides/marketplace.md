# Marketplace

Applies to Capabilities, Listings, engagements between Orgs, assigning
providers to Openings and stages, provider access and work, agency
conversations, Contacts, and notes, the agency profile view, sourcing
attribution, the Orgs and Hub marketplace pages, and activity statements.
Compose with [`hiring-pipeline.md`](hiring-pipeline.md),
[`openings.md`](openings.md), [`hub-profile.md`](hub-profile.md),
[`federation.md`](federation.md), and
[`org-subscriptions.md`](org-subscriptions.md).

## Scope

- **MKT-GEN-001** Vetchium is a directory and a shared workflow. Contracts,
  prices, invoices, payments, and taxes between Orgs stay outside it. Never
  store or compute a fee, amount, rate, invoice number, invoice or payment
  status, or either party's acknowledgement of a billable fact. The Org terms
  disclose this.
- **MKT-GEN-002** Vetchium verifies nothing about a provider beyond domain
  ownership ([`orgs.md`](orgs.md)), and shows no ratings, reviews, or
  performance statistics.
- **MKT-GEN-003** The marketplace is global: any active Org may engage a
  provider in any tenant.
- **MKT-GEN-004** An engagement and all work under it are authoritative in the
  consumer's home tenant, beside the hiring data it touches. The provider's
  tenant keeps only a non-authoritative projection of its engagements (client
  domain and display name, Capability, state, timestamps), fed by the
  consumer's outbox. Provider pages that list Openings or work (Jobs, Work
  queue) read live from each client tenant in parallel with one deadline,
  naming any tenant that did not answer; no other tenant copies an Opening
  (OPN-GEN-001) or applicant data.
- **MKT-GEN-005** A provider user acts through their home orgs-api, which sends
  durable commands or deadline-bounded reads to the consumer's tenant over
  the mesh
  ([`federation.md`](federation.md)). Uncertain writes are `202` with an
  Orgs `PendingOperation` and `/api/orgs/operations/status`, the Hub shape
  reused. Commands carry the provider Org DID and the acting user's display
  name for display; the authority's audit records both. An Org user has no
  display name of their own, so the email address stands in for it, as it does
  everywhere the Orgs portal names a user.
- **MKT-GEN-006** Every write takes an `Idempotency-Key`, carries the
  aggregate's `version`, and writes audit in the same transaction.

## Data placement

| Data | Authoritative tenant | Written by | Others hold |
| --- | --- | --- | --- |
| Listing | provider's | provider users, locally | nothing; search reads live |
| Engagement, references, assignments, routes | consumer's | consumer users locally; provider actions as commands | provider: engagement projection (MKT-GEN-004) |
| Application credit | consumer's | the apply command from the Hub user's tenant | nothing; the agency reads live |
| Provider work: interviews, feedback, results, consent | consumer's | provider users' commands; the Hub user's commands for responses and consent | nothing |
| Billable facts | consumer's | the transaction that records the fact | nothing; statements read live |
| Contact, notes, conversation, messages, suggestions, agency-side unread state | agency's | agency users locally; the Hub user's commands | Hub user: the agency pointer, without notes |
| Agency pointer, Hub-side unread state, "Agencies may message me" | Hub user's home | the agency's outbox; the Hub user locally | agency: the messages-off state on each Contact |
| Operation and idempotency ledgers | the initiating tenant | the initiating tenant | nothing |

- **MKT-DAT-001** The initiating tenant authorizes its own user (session,
  Org permission such as `org:fulfil_engagements`, active Org) before
  sending a command, and audits the initiation. The authority authorizes
  what it owns (engagement state, assignment, route, application state,
  conversation state) and audits the effect. Neither check replaces the
  other.
- **MKT-DAT-002** Proposing an engagement first reads the Listing state and
  the provider's `allows_listings` from the provider's tenant, bounded by a
  deadline (`org-tenant-unavailable`). The provider's tenant re-checks both
  before sending its accept.
- **MKT-DAT-003** The Hub user's tenant keeps one agency pointer per
  Contact, holding the agency Org DID and, while a conversation exists, the
  agency's recorded display name and primary domain, last activity, Hub-side
  unread count, the read-only reason if any, and the Opening suggestions
  (consumer domain, opening number, sent at). It never holds message or note
  text. The agency's outbox creates, updates, and deletes it; the new-message
  event also triggers the notification email (MKT-CNV-008). A pointer
  without a conversation exists only so the messages setting and deletion
  notices reach the agency (MKT-DAT-006, MKT-DAT-012); no Hub API, page, or
  email reveals it (MKT-CON-006).
- **MKT-DAT-004** Starting a conversation: the agency's tenant resolves the
  handle or alias through the directory and reads, from the Hub user's tenant
  with a deadline, that the account exists and its messages setting
  (`org-hub-user-not-found`, `org-agency-messages-off`,
  `org-tenant-unavailable`). It then checks the daily caps (MKT-CNV-003, and
  MKT-CON-005 when no Contact exists) under the agency's Org lock and creates
  the Contact if none exists, the conversation, and the first message in one
  transaction, whose outbox creates or updates the pointer.
- **MKT-DAT-005** The Hub user's reply and delete are durable commands from
  the Hub user's tenant to the agency's tenant, `202` `PendingOperation` when
  uncertain (HP-GEN-009). The Hub conversation list comes from the pointers
  that have a conversation; opening a conversation reads its messages live
  from the agency's tenant with a deadline (`hub-org-unavailable`). Marking
  read writes only the pointer.
- **MKT-DAT-006** The Hub user's tenant owns "Agencies may message me". A
  change sends the new state through its outbox to the agency tenant of
  every pointer, which stores it on the Contact and refuses agency
  messages by it (MKT-CNV-006). Creating a pointer while the setting is off
  sends the off state at once, closing the race with the read in MKT-DAT-004.
- **MKT-DAT-007** Opening suggestion: the agency's tenant confirms the
  assignment and the `published` state with the consumer's tenant, then
  stores the message. It stores only the consumer domain and opening number;
  the Hub portal reads the Opening live (OPN-GEN-001).
- **MKT-DAT-008** The Hub user's tenant attests the route `suggested` from the
  suggestions on its pointers: it sends it only when the chosen agency
  suggested that Opening to the applicant. The consumer's tenant checks only
  eligibility (MKT-SRC-003).
- **MKT-DAT-009** Routing a candidacy to a `background_check` provider copies
  the Listing's current consent disclosure, read from the provider's tenant,
  onto the consent request in the consumer's tenant. The applicant consents to
  that copy, which stays with the result as evidence. The consumer asks by
  engagement, not by Listing search: an active engagement continues when its
  Listing leaves search (MKT-LST-004), and the provider's tenant answers only a
  caller that homes the consumer Org. Routing stores the copy (and the
  Listing's check types) on the route; the consent request created while that
  route stands takes it from there.
- **MKT-DAT-010** Agency-side unread state is per agency (the shared inbox),
  kept on the conversation in the agency's tenant; marking read writes only
  there.
- **MKT-DAT-011** Migrating a principal ([`federation.md`](federation.md))
  moves what it is authoritative for: a Hub user's pointers and messages
  setting; an Org's engagements, applications, and work as consumer, and its
  Listings, Contacts, and conversations as provider. Not built
  (`docs/todo.md`).
- **MKT-DAT-012** Deleting a Hub account (not built) sends, in its outbox, a
  deletion notice to the agency tenant of every pointer, then deletes the
  pointers. The agency's tenant deletes every note on that Contact at once,
  and the Contact itself unless a conversation remains; a new note on a
  remaining Contact is refused with `org-conversation-party-deleted`.
  Deleting an agency
  Org (not built) deletes its notes at once and sends a notice to the Hub
  user's tenant of every Contact, which marks the pointer read-only and
  deletes a pointer without a conversation. MKT-CNV-011 then applies.
- **MKT-DAT-013** Writing the first note on a person: the agency's tenant
  resolves the handle or alias and reads that the account exists as the
  profile view does (MKT-PRF-002), checks the Contact cap (MKT-CON-005) under
  the agency's Org lock, and creates the Contact and the note in one
  transaction, whose outbox creates the pointer. When the Hub user's tenant
  finds no such account on creating the pointer, it answers with the
  deletion notice of MKT-DAT-012, closing the race with account deletion.

## Capabilities

Seeded Capability OIDs, identical in every tenant:

| Capability | Level | Performs |
| --- | --- | --- |
| `sourcing` | Opening | credited applications to assigned Openings (MKT-SRC) |
| `interviewing` | stage | `interview` stages |
| `assessment` | stage | `assessment` stages |
| `background_check` | stage | `background_check` stages |

- **MKT-CAP-001** Declare the Capability vocabulary as extensible on
  responses. `review` stages are in-house only.

## Listings

- **MKT-LST-001** A Listing is one per (provider Org, Capability), identified
  on the wire by (provider domain, Capability). Fields: headline (1–200 code
  points), description (Markdown subset of OPN-CNT-003, at most 10,000 code
  points), service countries (`worldwide` or 1–250 unique `CountryCode`s),
  optional languages (language catalog, at most 20), and optional indicative
  price as plain text of at most 500 code points.
- **MKT-LST-002** A `background_check` Listing also declares the check types
  it performs (HP-WRK-006) and a consent disclosure of 1–5,000 code points of
  plain text, shown to applicants before they consent.
- **MKT-LST-003** States: `draft`, `listed`, `unlisted`. Only `listed`
  appears in search. Listing needs the plan entitlement `allows_listings`
  (Silver and Gold), else `org-listing-plan-required`.
- **MKT-LST-004** A plan change to one without `allows_listings` sets every
  `listed` Listing to `unlisted` in the plan-change transaction. Active
  engagements continue; new proposals to the provider are refused.
- **MKT-LST-005** A suspended Org's Listings leave search; its engagements
  stay but its users cannot act (they can only restore the domain).
- **MKT-LST-006** Service countries and languages are declarations. Vetchium
  never refuses an engagement or routing because of them.

## Discovery

- **MKT-DIR-001** Search requires a Capability and accepts a service country,
  a language, check types, and a provider name or headline substring (at
  least two characters).
- **MKT-DIR-002** The caller's orgs-api fans out the search to every tenant's
  mesh peer in parallel with one deadline and merges results ordered by
  case-folded provider display name, then domain, with a composite keyset
  cursor (at most 50). A tenant that does not answer is omitted and the
  response names it as unavailable, so the portal can say results are
  incomplete. Never cache another tenant's Listings. Every tenant on the
  mesh is a tenant in the region catalog (`signupRegionsFile`) that each
  tenant program already loads, whether or not it accepts signups.
- **MKT-DIR-003** Listing detail shows the provider's display name, domain,
  logo (when its plan allows one), country, and the Listing fields.

## Engagements

An engagement links a consumer Org to a provider's Listing.

| From | Action | By | To |
| --- | --- | --- | --- |
| (none) | propose | consumer | `proposed` |
| `proposed` | accept | provider | `active` |
| `proposed` | decline | provider | `declined` |
| `proposed` | withdraw | consumer | `withdrawn` |
| `proposed` | 30 days pass | system | `expired` |
| `active` | end | either | `ended` |

- **MKT-ENG-001** At most one non-terminal engagement per (consumer,
  provider, Capability), enforced by a partial unique index
  (`org-engagement-exists`). An Org never engages itself
  (`org-engagement-self`).
- **MKT-ENG-002** Proposing needs a `listed` Listing and an active provider
  Org on a plan with `allows_listings` (`org-listing-not-available`).
- **MKT-ENG-003** A proposal carries an optional message of at most 2,000
  code points. Each side may set its own agreement reference (plain text, at
  most 200 code points, such as an MSA or PO number) at any time. Both sides
  see both references; Vetchium never interprets them.
- **MKT-ENG-004** Ending takes an optional note of at most 2,000 code points.
  It removes every assignment and route of the engagement in the same
  transaction and ends provider access at once (MKT-ACC-004). Credits,
  results, and billable facts stay.
- **MKT-ENG-005** A terminal engagement stays readable to both sides. A new
  proposal creates a new engagement.

## Assignment and routing

- **MKT-ASG-001** The consumer assigns active `sourcing` engagements to a
  non-terminal Opening; at most 20 per Opening. Unassigning stops new
  credits for that agency; existing credits stay.
- **MKT-ASG-002** The consumer assigns active engagements of the matching
  Capability to an Opening stage (`org-engagement-capability-mismatch`); at
  most 10 per stage.
- **MKT-ASG-003** When a candidacy is at a stage, the consumer routes it
  in-house or to one engagement assigned to that stage. Rerouting ends the
  previous provider's access to that candidacy; recorded work stays.
- **MKT-ASG-004** Assignment and routing are internal, edited directly
  without an Opening request, and need the permissions in MKT-AUTH.

## Provider access

- **MKT-ACC-001** A provider user with `org:fulfil_engagements` reads, for each
  active engagement, the live content of assigned Openings and nothing else
  of the consumer except:
  - `sourcing`: the applications credited to it, each with its route and Hub
    status only (MKT-SRC-006).
  - stage Capabilities: for each candidacy routed to it, the application
    snapshot and cover note, the stage name, and its own work on that
    candidacy.
- **MKT-ACC-002** A provider never sees another agency's credited
  applications, direct applications, which agency (if any) is
  credited on a candidacy routed to it, counts or statistics of an Opening's
  applications, internal notes, the hiring team, other stages' results or
  feedback, other providers' work, or offers.
- **MKT-ACC-003** Every provider read and command re-checks, at the
  consumer's tenant, the engagement state, assignment, route, and the
  application's state.
- **MKT-ACC-004** Access to a candidacy ends at once when it is rerouted,
  leaves the stage, leaves the pipeline, or the engagement ends. Answer any
  inaccessible item with `org-engagement-work-not-found`. The same
  transaction cancels the previous provider's scheduled interviews and ends
  its requested consents, with history and the Hub projection.

- **MKT-ACC-005** A provider names work by its engagement and a work id,
  `org_application_routes.route_id`, new at every routing, so a rerouted
  candidacy never answers to an old id and no application number reaches the
  provider. The consumer's tenant answers four mesh reads (work queue, work
  item, jobs, job) only to a caller that homes the provider Org the request
  names, and executes the `work-*` commands as the consumer Org's authority
  with the provider Org as initiator. The provider's orgs-api merges the lists
  from every catalog tenant under one deadline and names the tenants that did
  not answer (`unavailable_tenants`); a get or write goes to the tenant that
  homes the client Org.
- **MKT-ACC-006** Provider work is stored beside the Org's own: interviews with
  `performer_engagement_id`, their interviewers and feedback by email address
  in `org_provider_interview_*`, results with `performer_engagement_id` and
  `recorded_by_email`, consent requests with `performer_engagement_id` and the
  disclosure copied at routing. History names the actor `provider`. All of it
  is applicant content for retention. While a candidacy is routed the Org's
  own interview, assessment, and result writes are refused with
  `org-application-state-conflict`. A consent request on a routed stage takes
  its performer and disclosure from the route and its check types from the
  Listing's. The provider's tenant checks that interviewers are its own active
  users holding `org:fulfil_engagements` before it sends.

## Agency conversations

An agency is an active Org whose `sourcing` Listing is `listed`.

- **MKT-CNV-001** A conversation joins one agency and one Hub user. Its
  messages are authoritative in the agency's home tenant beside the Contact;
  the Hub user's tenant holds only a pointer (MKT-DAT-003). No other Org,
  client Orgs included, sees a conversation. It records the Hub user's
  display name and the agency's display name and primary domain, refreshed
  on each message, so a deleted party still has a name (MKT-CNV-011).
- **MKT-CNV-002** Only an agency starts a conversation: an agency user with
  `org:fulfil_engagements` enters the person's handle or alias and a first
  message; there is no acceptance step. One conversation per (agency, Hub
  user); starting again opens it. The Hub user replies or deletes.
- **MKT-CNV-003** At most 50 new conversations per agency per UTC day
  (`org-conversation-limit-reached`). An agency that loses its listed
  `sourcing` Listing starts none; existing conversations continue.
- **MKT-CNV-004** Shared inbox: every agency user with
  `org:fulfil_engagements` reads and answers every conversation of the
  agency. Each message shows the sending agency user's display name.
- **MKT-CNV-005** A message is plain text of 1–5,000 code points or an
  Opening suggestion (MKT-SRC-004). No attachments, edits, or read receipts;
  each side keeps its own unread state.
- **MKT-CNV-006** A Hub setting "Agencies may message me", on by default.
  Off makes every agency conversation read-only for both sides and refuses
  agency messages and new conversations with `org-agency-messages-off`; on
  restores them.
- **MKT-CNV-007** The Hub user may delete a conversation; its messages and
  suggestions are deleted for both sides. The agency's Contact and notes stay
  (MKT-CON-004).
- **MKT-CNV-008** The account email and professional addresses never reach
  the agency. The Hub user's home tenant sends notification emails that name
  the agency and never carry message content (HP-GEN-006). Agency users see
  unread counts in the Orgs portal only.
- **MKT-CNV-009** Messages are deleted 365 days after a conversation's last
  message.
- **MKT-CNV-010** Tell the agency why it cannot write: the conversation and
  the new-message form show "This person does not accept messages from
  agencies" before the agency types. The setting never hides the profile
  view (MKT-PRF).
- **MKT-CNV-011** Deleting a Hub account or an agency Org (neither is built;
  `docs/todo.md`) never deletes its conversations. Each becomes read-only,
  and the remaining party sees the recorded name of the other with "This
  conversation cannot continue: this person's account no longer exists" or
  "...: this agency no longer exists on Vetchium". Messages to it are
  refused with `org-conversation-party-deleted` or
  `hub-conversation-party-deleted`. A `workers` job in the agency's tenant
  deletes it, with the Contact (whose notes MKT-DAT-012 already deleted),
  once the tenant config `marketplace.deletedPartyConversationRetention`
  (a positive Go duration; `"8760h"` in every checked-in config, deploy
  included; startup refuses a missing or non-positive value) has passed
  since the deletion, or earlier by MKT-CNV-009.
- **MKT-CNV-012** Conversation rows have no cascading reference to the Org
  and hold the Hub user by DID only, so deleting either party leaves them in
  place; the agency's tenant keeps serving a deleted agency's conversations to
  the Hub user. Never link a deleted agency's recorded domain to `/org/<domain>`,
  which may now belong to another Org.

## Agency contacts

- **MKT-CON-001** A Contact is the agency's own record of one Hub user, one
  per (agency, Hub user DID), authoritative in the agency's home tenant. The
  agency's first note (MKT-NOTE) or first message (MKT-CNV-002) creates it,
  whichever comes first. It holds the DID, the Hub user's display name and
  handle as last read (refreshed on each profile view, note, and message, so
  lists need no cross-tenant read), who created it and when, its notes, and
  its conversation if any. Pages read the rest of the profile live
  (MKT-PRF).
- **MKT-CON-002** A Contact is not an applicant or a candidate. Nothing an
  agency does creates an application; only the Hub user applies (HP-APP).
- **MKT-CON-003** While the Hub user has turned agency messages off, the
  Contact shows that reason (MKT-CNV-010) beside the name
  and profile.
- **MKT-CON-004** A Contact outlives its conversation: deleting the
  conversation, by the Hub user (MKT-CNV-007) or by retention (MKT-CNV-009),
  keeps the Contact and its notes. A Contact with neither notes nor a
  conversation is deleted in the transaction that removes the last of them.
  A `workers` job deletes a Contact with its notes 730 days after its last
  note write or message. When the Hub account is deleted, its notes go at
  once (MKT-DAT-012); a Contact with a conversation stays with the recorded
  name, shows "Account deleted", and offers no profile view or notes until
  MKT-CNV-011 deletes it.
- **MKT-CON-005** At most 200 new Contacts per agency per UTC day, counting
  those a conversation creates (`org-contact-limit-reached`). An agency
  without a listed `sourcing` Listing creates none; its existing Contacts,
  notes, and conversations continue.
- **MKT-CON-006** Never tell the Hub user which agencies hold a Contact or
  notes about them: no Hub page, API, or email reveals a Contact without a
  conversation. The Hub terms disclose that agencies may keep private notes
  about Hub users, deleted with the account.

## Agency notes

- **MKT-NOTE-001** A note is plain text of 1–5,000 code points on a Contact,
  with its author (an agency user) and created and edited times. At most 200
  notes per Contact (`org-contact-note-limit-reached`).
- **MKT-NOTE-002** Every agency user with `org:fulfil_engagements` reads
  every note of the agency and adds notes. The author edits their own notes
  (`org-contact-note-not-author`); any of them deletes any note, for a
  correction or the person's request. A disabled user's notes stay under
  their display name.
- **MKT-NOTE-003** Notes are private to the agency: no Hub, consumer, or
  other-agency response, mesh payload to another tenant, statement, export,
  or email carries them, and the Hub user cannot see or delete them.
- **MKT-NOTE-004** Write a note from the profile view (MKT-PRF-005) or
  Contact detail. The first note on a person creates the Contact
  (MKT-DAT-013).
- **MKT-NOTE-005** Vetchium never copies application, provider-work,
  feedback, result, or offer data into a note, and offers no action that
  does. The Org terms make the agency responsible for its notes' content,
  including client data its contracts restrict.
- **MKT-NOTE-006** Each note write appends an audit event with the Contact,
  the note, and the action, never the text. An edit overwrites the text.

## Agency profile view

- **MKT-PRF-001** An agency user with `org:fulfil_engagements` may view a Hub
  user's profile by handle or alias: the `PublicProfile` other Hub users see,
  plus each verified professional-email domain with the month and year of its
  first and last verification ([`hub-profile.md`](hub-profile.md)
  Professional-email evidence). Never an address, local part, exact instant,
  or unverified address.
- **MKT-PRF-002** An unknown handle or alias is `org-hub-user-not-found`.
  The messages setting never changes the profile view. A remote
  profile is resolved
  through the directory and read over the mesh with a deadline
  (`org-tenant-unavailable`).
- **MKT-PRF-003** Never record which agency viewed a profile. Only a note or
  a message creates a Contact.
- **MKT-PRF-004** The professional-email settings page tells the owner that
  agencies see each verified domain with those months.
- **MKT-PRF-005** The profile view shows the agency's notes on the person
  when a Contact exists, with "Add note".

## Sourcing attribution

- **MKT-SRC-001** An application may credit one `sourcing` engagement. The
  credit is set only when the application is created, by either route below,
  and never changes. Portals identify an agency by its primary domain and
  display name; store the engagement, never the domain.
- **MKT-SRC-002** The applicant alone chooses the credit. The apply page's
  "Referred by" choice offers: no agency (the default), each agency that
  suggested this Opening to the applicant in a conversation (route
  `suggested`), or another agency by its primary domain (route `declared`).
  Arriving from a suggestion preselects that agency; the applicant may change
  it or choose no agency. Applying directly from the Opening page is always
  allowed and gives the same choice.
- **MKT-SRC-003** The consumer's tenant accepts the chosen agency only when
  its primary domain (resolved through the directory for a remote agency)
  belongs to an Org with an active `sourcing` engagement assigned to the
  Opening. Every other case (unknown domain, non-primary domain, unassigned
  or ended engagement) is one `hub-referral-agency-not-eligible`, creates
  nothing, and the applicant may choose again. The answer tells the
  applicant whether that agency works on the Opening; accepted, because they
  already know the agency.
- **MKT-SRC-004** Opening suggestion: in a conversation, an agency user posts
  an Opening it is assigned to that is `published`. It is a link to the
  Opening's apply page; the agency never applies for the person. Several
  agencies may suggest the same Opening to the same person.
- **MKT-SRC-005** One application per (Opening, applicant)
  (`hub-application-exists`). An agency gets no signal about an application
  not credited to it.
- **MKT-SRC-006** The agency sees the applications credited to it, each with
  its route and Hub status (HP-HUB-001), and the Openings it suggested to
  each Contact.
- **MKT-SRC-007** The consumer sees the credited agency and the route on the
  application, and may filter by both.
- **MKT-SRC-008** Keep the credit and the declared domain check independent
  of Hub sign-in, so a later applicant without a Hub account can be credited.

## Stage work

- **MKT-WRK-001** A provider performs a routed stage with the shapes of
  HP-WRK and the same validation.
- **MKT-WRK-002** `interviewing`: the provider schedules interviews with
  interviewers who are its own active users holding `org:fulfil_engagements`,
  records outcomes, and submits feedback. The consumer sees all of it.
- **MKT-WRK-003** `background_check`: the consumer selects check types from
  the provider's Listing. The applicant's consent request shows the
  provider's consent disclosure as copied at routing (MKT-DAT-009); the
  provider records nothing until consent is given.
- **MKT-WRK-004** `assessment`: the provider records the result.
- **MKT-WRK-005** The Hub application names the provider for an interview,
  assessment, or background check it performs, as notice.
- **MKT-WRK-006** Provider work happens in the Orgs portal only. Keep every
  operation a command an API credential could later call.

## Orgs portal

Navigation groups, each shown only when it applies (the API still decides):

| Group | Shown when | Pages |
| --- | --- | --- |
| Hiring | always | Openings (detail tabs: Applicants, Candidates, Pipeline, Providers), Pipeline templates, Find providers |
| Provider | the Org has a Listing or a provider engagement | Listings, Clients, Work queue |
| Agency | the Org has a `sourcing` Listing or engagement | Jobs, Contacts, Credited applications |

Listings shows to every `org:manage_listings` holder even before the Org is a
provider, so it can create its first Listing. `my-info` `marketplace` carries
whether the Org is a provider and an agency; each page still needs its
permission.

- **MKT-UI-001** Find providers: Listing search (MKT-DIR) with Capability
  tabs, country and language filters, and an incomplete-results notice; a
  Listing opens its detail with "Propose engagement". Engagements as consumer
  are a tab here.
- **MKT-UI-002** Opening Providers tab: assigned sourcing agencies, and per
  stage its assigned engagements, with add and remove.
- **MKT-UI-003** Listings: one card per Capability with state, the plan
  notice when `allows_listings` is missing (ux.md), and the editor.
- **MKT-UI-004** Clients: proposals awaiting a decision first, then active
  and ended engagements; detail holds both references and the activity
  statements.
- **MKT-UI-005** Work queue: candidacies routed to the Org across clients,
  with client, Capability, Opening, stage, and status filters; upcoming
  interviews first.
- **MKT-UI-006** Jobs: Openings assigned to the agency across clients, with
  client, title, employing country, state (default `published`), assigned
  date, and the agency's own credited count. Job detail shows the Opening as
  Hub users see it, its credited applications, the Contacts it was suggested
  to, and "Suggest to a contact". Suggesting to a Contact without a
  conversation starts one (MKT-CNV-002, MKT-CNV-003).
- **MKT-UI-007** Contacts, also the shared inbox: every Contact ordered by
  last activity, with name, handle, last activity, unread count, note count,
  and credited count; tabs All, Unread (its count also in the navigation),
  In conversation, and Not contacted; search by name. "New contact" takes a
  handle or alias and opens the profile view to add a note or a first
  message. There is no separate Messages page.
- **MKT-UI-008** Contact detail is the one page per person: Conversation (the
  default tab when one exists), Notes (the default otherwise), Profile
  (MKT-PRF), Suggested Openings, and Credited applications.
- **MKT-UI-009** Credited applications: every credit across clients with
  client, Opening, route, and Hub status filters.
- **MKT-UI-010** Ship every string in every `orgs-ui` locale.

## Hub portal

- **MKT-HUB-001** Messages: agency conversations ordered by last activity,
  each naming the agency by display name and primary domain, with reply
  and delete. An Opening suggestion renders as a card linking
  to the Opening's apply page. When the agency's tenant does not answer, the
  list still shows and the conversation shows a retry notice (MKT-DAT-005).
- **MKT-HUB-002** Settings hold "Agencies may message me" (MKT-CNV-006).
- **MKT-HUB-003** The apply page's "Referred by" choice (MKT-SRC-002)
  explains in one sentence that the chosen agency is credited with the
  application, and that choosing none is fine.
- **MKT-HUB-004** Ship every string in every `hub-ui` locale.

## Activity statements

Billable facts, each recorded by the party that owns it:

| Capability | Fact | Recorded by |
| --- | --- | --- |
| `sourcing` | credited application `joined` (date); `separated_on` (date) | consumer |
| `interviewing` | interview `completed` or `no_show` | provider |
| `assessment` | result recorded | provider |
| `background_check` | each check's outcome recorded | provider |

- **MKT-STM-001** Derive facts from the recording action in the same
  transaction; there is no separate entry, confirmation, or dispute step.
- **MKT-STM-002** A statement lists one engagement's facts for one UTC
  calendar month: date, fact, opening number and title, application number,
  applicant display name, and a corrected marker (HP-STA-005). It shows no
  amount and is titled "Activity statement — not an invoice".
- **MKT-STM-003** Both sides read it, server-side paginated; CSV export is
  built in the browser by paging.
- **MKT-STM-004** Facts outlive applicant retention (HP-RET-001) with numbers
  only, and are deleted three years after the engagement becomes terminal.

## Permissions

| Permission | Allows |
| --- | --- |
| `org:manage_providers` | search Listings; propose, withdraw, and end engagements as consumer; set the consumer reference; assign engagements; read statements |
| `org:manage_listings` | edit Listings; accept, decline, and end engagements as provider; set the provider reference; read statements |
| `org:fulfil_engagements` | read and perform assigned work (MKT-ACC, MKT-SRC, MKT-WRK); Contacts, notes, conversations, and the profile view (MKT-CON, MKT-NOTE, MKT-CNV, MKT-PRF) |

- **MKT-AUTH-001** Add the three to the Org catalog; `org:superadmin` implies
  all three. An `org:manage_users` holder may grant or revoke them.
- **MKT-AUTH-002** Routing a candidacy needs the rights to act on it
  (HP-AUTH-001, HP-AUTH-002).
- **MKT-AUTH-003** Add presets Vendor manager (`org:manage_providers`) and
  Provider staff (`org:fulfil_engagements`).

## Plans

- **MKT-PLN-001** Add `allows_listings` to the Org plan entitlements: false
  on Free, true on Silver and Gold. Engaging providers is open to every plan.

## Problem types

| Type | Status | Meaning |
| --- | --- | --- |
| `org-listing-plan-required` | 403 | the plan does not allow Listings |
| `org-listing-not-available` | 409 | the Listing is not listed or its provider cannot take engagements |
| `org-listing-not-found` | 404 | unknown (domain, Capability) |
| `org-listing-exists` | 409 | the Org already has a Listing for the Capability |
| `org-listing-version-conflict` | 409 | the Listing changed since it was read |
| `org-listing-state-conflict` | 409 | the Listing's state does not allow the action (publishing a `listed` Listing; unlisting a Listing that is not `listed`; deleting one that is not a `draft`) |
| `org-engagement-exists` | 409 | a non-terminal engagement exists for the pair and Capability |
| `org-engagement-self` | 422 | an Org cannot engage itself |
| `org-engagement-not-found` | 404 | unknown, or not a party to it |
| `org-engagement-state-conflict` | 409 | the action is not allowed in the current state |
| `org-engagement-version-conflict` | 409 | the engagement changed since it was read |
| `org-engagement-capability-mismatch` | 422 | the engagement's Capability does not perform the stage kind |
| `org-assignment-exists` | 409 | the engagement is already assigned to that Opening or stage |
| `org-assignment-not-found` | 404 | the engagement is not assigned there, or not the caller's |
| `org-assignment-limit-reached` | 409 | the Opening has 20 `sourcing` engagements, or the stage 10 |
| `org-engagement-work-not-found` | 404 | the work item is not accessible to the provider |
| `org-conversation-limit-reached` | 429 | daily new-conversation limit reached |
| `org-contact-limit-reached` | 429 | daily new-Contact limit reached |
| `org-contact-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-contact-note-limit-reached` | 409 | the Contact has 200 notes |
| `org-contact-note-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-contact-note-not-author` | 403 | only the author edits a note |
| `org-conversation-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-hub-user-not-found` | 404 | unknown handle or alias |
| `org-agency-messages-off` | 403 | the Hub user does not accept messages from agencies |
| `org-conversation-party-deleted` | 409 | the Hub user's account no longer exists |
| `hub-conversation-party-deleted` | 409 | the agency no longer exists |
| `hub-referral-agency-not-eligible` | 422 | the named domain is not the primary domain of an agency assigned to the Opening |
| `org-tenant-unavailable` | 503 | the counterparty's tenant did not answer |

## Tests and fixtures

- **MKT-TST-001** Cover in `playwright/api/`: engagements across tenants
  through every transition, the plan gate and downgrade, assignment caps,
  routing and rerouting, every access boundary in MKT-ACC (including after
  end and reroute; an agency also engaged for a stage on the same Opening
  sees no credit on routed candidacies), suggested and declared referrals
  racing a direct application and another agency, every
  `hub-referral-agency-not-eligible` case (including a non-primary domain and
  a remote agency), the referral choice (default none, preselected but
  changeable from a suggestion, two agencies suggesting one Opening, applying
  directly), conversations across tenants (limit, shared inbox, the
  messages switch refusing with its reason and leaving the profile view,
  delete keeping the Contact and notes, either party's deletion leaving a
  read-only conversation with the reason), notes (shared reading, author-only
  edits, any user's deletion, both caps, the first note creating a Contact
  whose pointer no Hub response reveals, no note text in any Hub, consumer,
  or mesh response, deleting the last note removing a Contact without a
  conversation, retention, account deletion removing notes at once, and a
  first note racing account deletion), the agency profile view (domains with
  months only, no address in any response or mesh payload), consent gating,
  statement contents, and that no amount or payment field exists in any
  response.
- **MKT-TST-002** Cover a tenant that does not answer during search, during a
  provider command and a Hub reply (`202`, then recovery), and while a Hub
  user opens a conversation. Cover the messages switch reaching existing
  conversations in other tenants, and switching off while a start is in
  flight.
- **MKT-TST-003** `make dev-seed` gives each region a provider Org per
  Capability with a Listing, engagements in each state with consumers in
  other regions, routed work, and agency Contacts with notes and
  conversations, including Contacts with notes only, with Hub users in other
  regions.
