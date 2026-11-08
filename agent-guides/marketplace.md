# Marketplace

Applies to Capabilities, Listings, engagements between Orgs, assigning
providers to Openings and stages, provider access and work, Job owners,
agency conversations, Contacts, and notes, the agency profile view, sourcing
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
| Contact, notes, conversation, messages, suggestions, chat requests, request blocks, agency-side unread state | agency's | agency users locally; the Hub user's commands | Hub user: the agency pointer, without notes or request notes |
| Job owner | agency's | agency users locally | nothing; the owner filter names Jobs, never users (MKT-OWN-004) |
| Agency pointer, Hub-side unread state, "Agencies may send me chat requests", the Hub user's daily request count | Hub user's home | the agency's outbox; the Hub user locally | agency: the requests-off state on each Contact; the conversation window each conversation carries |
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
  (Hub user, agency Org DID), named in Hub APIs and URLs by the agency's
  primary domain, holding the agency Org DID and, while a conversation or a chat
  request exists, the agency's recorded display name and primary domain,
  last activity, Hub-side unread count, the read-only reason if any, the
  instants until which each side may write (MKT-REQ-004), the pending or
  last answered chat request (request number, direction, state, consumer domain, opening
  number, sent at, decline scope, blocked until), and the Opening
  suggestions (consumer domain, opening number, sent at). It never holds
  message, note, or request-note text. The agency's outbox creates, updates,
  and deletes it; the new-message, new-request, and request-accepted events
  also trigger the notification email (MKT-CNV-008). A pointer with neither
  a conversation nor a request exists only so the requests setting and
  deletion notices reach the agency (MKT-DAT-006, MKT-DAT-012); no Hub API,
  page, or email reveals it (MKT-CON-006).
- **MKT-DAT-004** An agency chat request: the agency's tenant resolves the
  handle or alias through the directory and reads, from the Hub user's tenant
  with a deadline, that the account exists and its requests setting
  (`org-hub-user-not-found`, `org-agency-requests-off`,
  `org-tenant-unavailable`), and confirms the Opening (MKT-DAT-007). It then,
  under the agency's Org lock, checks the daily caps (MKT-REQ-006, and
  MKT-CON-005 when no Contact exists) and the refusals of MKT-REQ-003, and
  creates the Contact if none exists and the request in one transaction,
  whose outbox creates or updates the pointer.
- **MKT-DAT-005** The Hub user's reply, message deletion, chat request,
  accept, and decline are durable commands from the Hub user's tenant to the agency's
  tenant, `202` `PendingOperation` when uncertain (HP-GEN-009). Each carries
  the Hub tenant's current conversation window (MKT-REQ-004). The Hub
  conversation list comes from the pointers that have a conversation or a
  request; opening a conversation reads its messages and any pending
  request's note live from the agency's tenant with a deadline
  (`hub-org-unavailable`). Marking read writes only the pointer.
- **MKT-DAT-006** The Hub user's tenant owns "Agencies may send me chat
  requests". A change sends the new state through its outbox to the agency
  tenant of every pointer, which stores it on the Contact and refuses agency
  requests by it (MKT-REQ-008). Creating a pointer while the setting is off
  sends the off state at once, closing the race with the read in MKT-DAT-004.
- **MKT-DAT-014** A Hub chat request: the Hub user's tenant counts the day's
  requests (MKT-REQ-006), reads the Opening with its assigned agencies from
  the consumer's tenant with a deadline (`hub-org-unavailable`), refuses an
  Opening that is not `published` or an agency not among them
  (`hub-agency-not-assigned`), and sends the request command. The Hub
  tenant's read is the attestation; the agency's tenant checks only that it
  has an active `sourcing` engagement with that consumer and the refusals of
  MKT-REQ-003, then creates the Contact if none exists (not counted by
  MKT-CON-005) and the request.
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

## Job owners

A Job is an Opening assigned to an agency's active `sourcing` engagement, as
the agency sees it.

- **MKT-OWN-001** A Job has at most one owner: the agency user who looks after
  it, kept in the agency's tenant (`org_job_owners`). No client, Hub, or mesh
  response carries it. The agency's Jobs list and Job detail show it with its
  `owner_version` (0 before the first owner).
- **MKT-OWN-002** Any user with `org:fulfil_engagements` sets or clears the
  owner of a Job of the agency's active `sourcing` engagement
  (`set-job-owner`; any other engagement is `org-engagement-work-not-found`).
  The owner is an active agency user holding `org:fulfil_engagements`
  (`org-job-owner-invalid`). The write carries the version read
  (`org-job-owner-version-conflict`); clearing keeps the row with no owner so
  the version keeps rising. It checks only the agency's engagement
  projection: a row whose Opening the client unassigned stays and returns if
  the Opening is assigned again. Audit `org.job.owner_set` or
  `org.job.owner_cleared` with both owners' user ids.
- **MKT-OWN-003** One user owns at most 200 Jobs of active engagements
  (`org-job-owner-limit-reached`), counted under a lock on that user's row.
- **MKT-OWN-004** The Jobs list's owner filter resolves, in the agency's
  tenant, to the Jobs that user owns, sent to every client tenant as
  (engagement, Opening number) pairs; a tenant matches only engagements it
  homes. An address that owns none lists nothing. Title search (substring, or
  the exact Opening number) and employing country filter at the client
  tenant.
- **MKT-OWN-005** `suggest-job-owners` and `suggest-clients` answer
  autocompletes: at most 20 matches, no further pages, typing narrows.
  Clients come from the agency's projections of its active engagements, so
  any number of clients needs no cross-tenant read.

## Agency conversations

An agency is an active Org whose `sourcing` Listing is `listed`.

- **MKT-CNV-001** A conversation joins one agency and one Hub user. Its
  messages are authoritative in the agency's home tenant beside the Contact;
  the Hub user's tenant holds only a pointer (MKT-DAT-003). No other Org,
  client Orgs included, sees a conversation. It records the Hub user's
  display name and the agency's display name and primary domain, refreshed
  on each message, so a deleted party still has a name (MKT-CNV-011).
- **MKT-CNV-002** A conversation starts only from an accepted chat request
  (MKT-REQ). One conversation per (agency, Hub user); a later accepted
  request reopens it with its history. Each side writes while the
  conversation window lets it (MKT-REQ-004). No one deletes a conversation;
  each side deletes only its own messages (MKT-CNV-007).
- **MKT-CNV-003** The daily limits are on chat requests (MKT-REQ-006). An
  agency that loses its listed `sourcing` Listing sends no requests;
  existing conversations continue and it still answers requests.
- **MKT-CNV-004** Shared inbox: every agency user with
  `org:fulfil_engagements` reads and answers every conversation of the
  agency. Each message shows the sending agency user's display name.
- **MKT-CNV-005** A message is plain text of 1–5,000 code points, an
  Opening suggestion (MKT-SRC-004), or an accepted chat request
  (MKT-REQ-005). No attachments, edits, or read receipts; each side keeps its
  own unread state.
- **MKT-CNV-006** The Hub user's requests setting (MKT-REQ-008) never makes
  a conversation read-only; only the window (MKT-REQ-004) and a deleted
  party (MKT-CNV-011) stop a side writing.
- **MKT-CNV-007** Each side deletes only its own `text` messages: the Hub
  user theirs, any agency user with `org:fulfil_engagements` the agency's
  (MKT-CNV-004). Another side's message, a `request`, or an Opening
  suggestion is refused like an unknown one
  (`org-conversation-message-not-found`,
  `hub-conversation-message-not-found`). The message stays in place for both
  sides as a stub (`deleted: true`, no text) shown as "Message deleted", and
  a repeat finds nothing to delete. Only the deleter's tenant keeps the text,
  in its audit event: the agency's tenant audits
  `org.conversation.message_deleted` and its outbox sends an event the Hub
  user's tenant audits as `hub.agency-conversation.message-deleted` without
  the text; for the Hub user's deletion, the Hub user's tenant reads the
  message live, sends the command (MKT-DAT-005), and audits with the text,
  and the agency's tenant audits without it.
- **MKT-CNV-008** The account email and professional addresses never reach
  the agency. The Hub user's home tenant sends notification emails that name
  the agency and never carry message content (HP-GEN-006). Agency users see
  unread counts in the Orgs portal only.
- **MKT-CNV-009** Messages are deleted 365 days after a conversation's last
  message.
- **MKT-CNV-010** Tell each side why it cannot write before it types: in
  place of the composer, a closed conversation says it reopens when the
  other side writes or a new chat request is accepted, with "Send chat
  request" (MKT-UI-008, MKT-HUB-001). A Hub user's request goes only from an
  Opening page, so the Hub notice links the Openings the agency suggested.
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

## Chat requests

- **MKT-REQ-001** A chat request asks the other side to open the
  conversation about one Opening: the consumer domain and opening number,
  and an optional note of 1–1,000 code points (trimmed). It is
  authoritative in the agency's tenant beside the Contact. Its states:
  `pending`, `accepted`, `declined`, `expired`; no withdrawal.
- **MKT-REQ-002** An agency user with `org:fulfil_engagements` sends one to
  a person by handle, alias, or Contact, with a `published` Opening the
  agency is assigned to (MKT-DAT-004, MKT-DAT-007). A Hub user sends one only
  from a `published` Opening's page, to an agency with an active `sourcing`
  engagement assigned to it (MKT-DAT-014, MKT-HUB-005). The Hub user answers
  requests to them; any agency user with `org:fulfil_engagements` answers
  the agency's (MKT-CNV-004).
- **MKT-REQ-003** A new request is refused, in this order, when the other
  party is deleted (`org-conversation-party-deleted`,
  `hub-conversation-party-deleted`), when a request between the pair is
  `pending` in either direction (`org-chat-request-exists`,
  `hub-chat-request-exists`), when the sender may still write in the
  conversation (`org-conversation-open`, `hub-conversation-open`), or when
  the recipient's decline blocks it (MKT-REQ-007; `org-chat-request-blocked`,
  `hub-chat-request-blocked`). Where the recipient has a request pending to
  the sender, portals offer Accept in place of Request.
- **MKT-REQ-004** The conversation window is the Hub user's home tenant
  config `marketplace.conversationWindow`: a positive Go duration, `"2160h"`
  in every checked-in config, deploy included; startup refuses a missing or
  non-positive value; portals show it in whole days. A side's activity is
  its latest message, accepting a request, or sending a request that was
  accepted (at its sent time). The agency may write while the Hub user's
  activity plus the window is after now; the Hub user while the agency's is.
  The agency's tenant decides by its clock and stores the window from the
  latest Hub command on the conversation (MKT-DAT-005), so a config change
  applies from the Hub tenant's next command. Writing outside it is refused
  with `org-conversation-closed` or `hub-conversation-closed`.
- **MKT-REQ-005** Accepting creates the conversation if none exists and
  appends the request as a `request` message (sender, Opening, note) at its
  sent time; an agency request's Opening becomes an Opening suggestion
  (MKT-SRC-004, MKT-DAT-008) only then. A message from the recipient of a
  pending request accepts it first.
- **MKT-REQ-006** At most 50 requests per agency per UTC day, counted in
  the agency's tenant (`org-chat-request-limit-reached`), and 10 per Hub
  user per UTC day, counted in the Hub user's tenant before the command is
  sent (`hub-chat-request-limit-reached`). Both count sends, never live
  rows, so a refused or expired request still counts. A Hub send counts
  once per idempotency key, so a retried send never counts twice.
- **MKT-REQ-007** Declining takes a scope: `opening` ("Not this Opening")
  stops the sender requesting with that Opening for as long as the Contact
  exists; `sender` ("Not for <N> days", N the window in days) stops every
  request from the sender for one window from the decline. Blocks bind only
  the sender's direction: the decliner may still send its own request. The
  sender sees which scope and, for `sender`, the date it lifts.
- **MKT-REQ-008** The Hub setting "Agencies may send me chat requests", on
  by default (MKT-DAT-006). Off refuses agency requests with
  `org-agency-requests-off`; the agency sees "This person does not accept
  chat requests from agencies" before it types, beside the Contact
  (MKT-CON-003), never in the profile view (MKT-PRF). Accepted
  conversations continue, and the Hub user may still send requests.
- **MKT-REQ-009** A `workers` job in the agency's tenant expires a
  `pending` request 14 days after it was sent, with no block, and updates
  the pointer.
- **MKT-REQ-010** The Hub user's tenant emails the Hub user for a new agency
  request and for an agency accepting their request (MKT-CNV-008). Agency
  users are told in the Orgs portal only (MKT-UI-011); no email.
- **MKT-REQ-011** Each send, accept, decline, and expiry appends an audit
  event in the agency's tenant with the Contact, the request, the action, and
  the scope, never the note; the Hub user's tenant audits its user's sends
  and answers.
- **MKT-REQ-012** A declined or expired request's note is deleted with the
  answer; an accepted one's moves into the `request` message. A `sender`
  block is deleted once it lifts; an `opening` block lives with the Contact.
  A Contact with a `pending` request or a block is not deleted for lacking
  notes and a conversation (MKT-CON-004), and its 730-day retention counts
  from its latest request too.

## Agency contacts

- **MKT-CON-001** A Contact is the agency's own record of one Hub user, one
  per (agency, Hub user DID), authoritative in the agency's home tenant. The
  agency's first note (MKT-NOTE) or the first chat request between the two
  (MKT-REQ-002), from either side, creates it. It has no id of its own: the
  agency's tenant keys it by (agency Org DID, Hub user DID), and APIs, URLs
  (`/sourcing/contacts/<handle>`), and audit events name it by the Hub
  user's handle, which never changes. Its notes, chat requests, and messages
  are numbered from 1 per Contact (`note_number`, `request_number`,
  `message_number`). It holds the DID, the Hub user's display name and
  handle as last read (refreshed on each profile view, note, request, and message, so
  lists need no cross-tenant read), who created it and when, its notes, and
  its conversation if any. Pages read the rest of the profile live
  (MKT-PRF).
- **MKT-CON-002** A Contact is not an applicant or a candidate. Nothing an
  agency does creates an application; only the Hub user applies (HP-APP).
- **MKT-CON-003** While the Hub user has turned agency requests off, the
  Contact shows that reason (MKT-REQ-008) beside the name.
- **MKT-CON-004** A Contact outlives its conversation: retention
  (MKT-CNV-009) deleting the conversation keeps the Contact and its notes. A Contact with neither notes nor a
  conversation is deleted in the transaction that removes the last of them.
  A `workers` job deletes a Contact with its notes 730 days after its last
  note write or message. When the Hub account is deleted, its notes go at
  once (MKT-DAT-012); a Contact with a conversation stays with the recorded
  name, shows "Account deleted", and offers no profile view or notes until
  MKT-CNV-011 deletes it.
- **MKT-CON-005** At most 200 new Contacts per agency per UTC day, counting
  those an agency request creates but not those a Hub request creates
  (`org-contact-limit-reached`). An agency
  without a listed `sourcing` Listing creates none; its existing Contacts,
  notes, and conversations continue.
- **MKT-CON-006** Never tell the Hub user which agencies hold a Contact or
  notes about them: no Hub page, API, or email reveals a Contact without a
  conversation or a chat request. The Hub terms disclose that agencies may keep private notes
  about Hub users, deleted with the account.

## Agency notes

- **MKT-NOTE-001** A note is plain text of 1–5,000 code points on a Contact,
  with its author (an agency user) and created and edited times. At most 200
  notes per Contact (`org-contact-note-limit-reached`).
- **MKT-NOTE-002** Every agency user with `org:fulfil_engagements` reads
  every note of the agency and adds notes. The author edits their own notes
  (`org-contact-note-not-author`). No one deletes a note: notes are kept for
  the agency's later search and matching; only retention (MKT-CON-004) and
  account deletion (MKT-DAT-012) remove them. A disabled user's notes stay
  under their display name.
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
  The requests setting never changes the profile view. A remote
  profile is resolved
  through the directory and read over the mesh with a deadline
  (`org-tenant-unavailable`).
- **MKT-PRF-003** Never record which agency viewed a profile. Only a note or
  a chat request creates a Contact.
- **MKT-PRF-004** The professional-email settings page tells the owner that
  agencies see each verified domain with those months.
- **MKT-PRF-005** The profile view shows the agency's notes on the person
  when a Contact exists, with "Add note", and "Send chat request"
  (MKT-UI-012).

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
  allowed and gives the same choice. The apply page offers the choice only
  when `PublicOpening.accepts_agency_referrals` is true, and otherwise sends
  no credit.
- **MKT-SRC-003** The consumer's tenant accepts the chosen agency only when
  its primary domain (resolved through the directory for a remote agency)
  belongs to an Org with an active `sourcing` engagement assigned to the
  Opening. Every other case (unknown domain, non-primary domain, unassigned
  or ended engagement) is one `hub-referral-agency-not-eligible`, creates
  nothing, and the applicant may choose again. The answer tells the
  applicant whether that agency works on the Opening; accepted, because they
  already know the agency.
- **MKT-SRC-004** Opening suggestion: an agency user posts an Opening it is
  assigned to that is `published`, in a conversation the agency may write in
  or as its accepted chat request (MKT-REQ-005). It is a link to the
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

Marketplace pages sit in the workspaces of [`ux.md`](ux.md) (Orgs portal
navigation), each workspace shown only when it applies (the API still
decides):

| Workspace | Shown when | Marketplace pages |
| --- | --- | --- |
| Hiring | always | Openings (detail tab Providers), Find providers |
| Sourcing | the Org has a `sourcing` Listing or engagement | Jobs, Contacts, Credited applications, Clients |
| each stage Capability | the Org has a Listing or engagement of it | Work queue, Clients, both of that Capability only |
| Administration | the user may open one of its pages | Listings |

Listings shows to every `org:manage_listings` holder even before the Org is a
provider, so it can create its first Listing. `my-info` `marketplace.capabilities`
lists the Capabilities the Org has a Listing or provider engagement for; each
page still needs its permission. Every client filter is the client
autocomplete (MKT-OWN-005), never a list built from one page.

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
- **MKT-UI-005** Work queue: candidacies of one stage Capability routed to
  the Org across clients, with client, Opening, stage, and status filters;
  upcoming interviews first.
- **MKT-UI-006** Jobs: Openings assigned to the agency across clients, server
  paginated, with state tabs (default `published`), whose Jobs (Mine, the
  default; Everyone's; or one colleague by autocomplete), client, title or
  number search, and employing country under "More filters", all kept in the
  URL. Rows show the Opening, client, owner with "Change", assigned date, and
  the applications credited to the agency. Say "credited to your agency",
  never "to you". Job detail shows the owner, the Opening as Hub users see
  it, its credited applications, the Contacts it was suggested to, and
  "Suggest to a contact": a suggestion message where the agency may write,
  otherwise a chat request with this Opening (MKT-UI-012).
- **MKT-UI-007** Contacts, also the shared inbox: every Contact ordered by
  last activity, with name, handle, one status (Request received, Request
  sent, In conversation, Request declined, Request expired, Conversation
  closed, or No conversation, with "Chat requests off" or "Account deleted"
  beside it), last activity, Action ("Answer request" for a request to the
  agency, the unread count), note count, and credited count; the name is bold
  while either waits. Tabs To answer (`requests_received`), Unread, Waiting on
  them (`requests_sent`), Conversations, and All (the default), each with its
  count and kept in `?tab=`; search by name. The navigation shows two badges
  from `count-awaiting-contacts`: requests to answer (solid) and unread
  (outlined), and Contacts opens on To answer, else Unread, while either is
  non-zero. "Find a person" takes a handle or alias and opens the person page
  (MKT-UI-008). Never show "Not contacted" or when the Contact began. There
  is no separate Messages page.
- **MKT-UI-008** The person page, `/sourcing/contacts/<handle>`, is the one
  page per person, Contact or not; an alias in the URL redirects to the
  handle. The header shows the name, handle, status (MKT-UI-007), and
  latest work and country, and "Send chat request" while no request is
  pending and the agency may not write. Tabs, kept in `?tab=`: Conversation
  (the default when a conversation or request exists), Notes (the default
  otherwise; the first note creates the Contact in place), Profile
  (MKT-PRF), and, for a Contact, Suggested Openings and Credited
  applications. Only the latest request shows above the conversation, by
  the Contact's status: a pending one to the agency with its Opening, note,
  Accept, "Not this Opening", and "Not for <N> days"; one the agency sent as
  pending, declined (with scope and lift date), or expired. Each agency
  `text` message offers "Delete message" (MKT-CNV-007). Where the agency
  may not write, the composer gives way to the notice of MKT-CNV-010.
- **MKT-UI-009** Credited applications: every credit across clients with
  client, Opening, route, and Hub status filters.
- **MKT-UI-010** Ship every string in every `orgs-ui` locale.
- **MKT-UI-011** Home shows a "Chat requests" card to `org:fulfil_engagements`
  holders of an agency: the five oldest pending requests to the agency (Hub
  user, Opening, note start, sent at), "See all" to the To answer tab, and the
  count `requests_received` from `count-awaiting-contacts`.
- **MKT-UI-012** "Send chat request" is one dialog: the person (fixed when
  opened from a Contact or profile view; a handle or alias from Job detail),
  the Opening (fixed from Job detail; otherwise the agency's `published`
  Jobs by the Jobs search), and the note with a live code-point count. It
  shows the refusal of MKT-REQ-003 or MKT-REQ-008 that applies before
  sending, and Accept in place of Request where MKT-REQ-003 says so.

## Hub portal

- **MKT-HUB-001** Messages: pending requests to the Hub user first (agency,
  Opening, sent at; the note on opening), then agency conversations and
  sent requests ordered by last activity, each naming the agency by display
  name and primary domain. A request offers Accept, "Not this Opening", and
  "Not for <N> days"; a conversation offers reply, and each of the Hub
  user's `text` messages "Delete message" (MKT-CNV-007). An Opening
  suggestion or request renders as a card linking to the Opening; the apply
  link shows only for an agency's. A sent request shows as pending,
  declined (scope and lift date), or expired. Where the Hub user may not
  write, the composer gives way to the notice of MKT-CNV-010. When the
  agency's tenant does not answer, the list still shows and the
  conversation shows a retry notice (MKT-DAT-005). A conversation's URL is
  `/messages/o/<agency domain>`. The list filters All, To answer
  (`requests_received`), and Unread, with counts, kept in `?filter=` across
  conversations; a request to answer carries a "Request" tag and an unread
  one its count, each with a bold name. With no conversation open, the right
  pane (above the list at phone width, only when non-empty) is "Waiting on
  you": requests to answer, then unread conversations, each opening its
  conversation. The navigation shows two badges from
  `count-awaiting-conversations`, each once per agency: requests to answer
  (solid) and unread (outlined).
- **MKT-HUB-002** Settings hold "Agencies may send me chat requests"
  (MKT-REQ-008), saying that accepted conversations continue when it is off.
- **MKT-HUB-005** The Opening page (`/org/<domain>/openings/<number>`) of a
  `published` Opening lists every agency with an active `sourcing`
  engagement assigned to it, by display name and primary domain, read with
  the Opening (MKT-DAT-014). Each shows the Hub user's state with it: Open
  conversation (link), Request pending, Accept (a request from it is
  pending), Declined (scope and lift date), or "Request chat", which opens a
  dialog with the Opening fixed and the note. The section says these
  agencies recruit for this Opening and that they see the Hub user's name
  and profile once they reply. No agencies hides the section.
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
| `org:fulfil_engagements` | read and perform assigned work (MKT-ACC, MKT-SRC, MKT-WRK); Job owners (MKT-OWN); Contacts, notes, chat requests, conversations, and the profile view (MKT-CON, MKT-NOTE, MKT-REQ, MKT-CNV, MKT-PRF) |

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
| `org-chat-request-limit-reached` | 429 | the agency's daily chat-request limit is reached |
| `hub-chat-request-limit-reached` | 429 | the Hub user's daily chat-request limit is reached |
| `org-chat-request-exists` | 409 | a chat request between the pair is pending |
| `hub-chat-request-exists` | 409 | a chat request between the pair is pending |
| `org-chat-request-blocked` | 403 | the person declined this Opening, or all requests until a date |
| `hub-chat-request-blocked` | 403 | the agency declined this Opening, or all requests until a date |
| `org-chat-request-not-found` | 404 | unknown, not the agency's, or no longer pending |
| `hub-chat-request-not-found` | 404 | unknown, not to the Hub user, or no longer pending |
| `org-conversation-open` | 409 | the agency may still write in the conversation |
| `hub-conversation-open` | 409 | the Hub user may still write in the conversation |
| `org-conversation-closed` | 409 | the window does not let the agency write (MKT-REQ-004) |
| `hub-conversation-closed` | 409 | the window does not let the Hub user write (MKT-REQ-004) |
| `hub-agency-not-assigned` | 422 | the Opening is not `published` or the agency is not assigned to it |
| `org-contact-limit-reached` | 429 | daily new-Contact limit reached |
| `org-job-owner-invalid` | 422 | the owner is not an active agency user holding `org:fulfil_engagements` |
| `org-job-owner-limit-reached` | 409 | the owner already owns 200 Jobs of active engagements |
| `org-job-owner-version-conflict` | 409 | the Job's owner changed since it was read |
| `org-contact-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-contact-note-limit-reached` | 409 | the Contact has 200 notes |
| `org-contact-note-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-contact-note-not-author` | 403 | only the author edits a note |
| `org-conversation-not-found` | 404 | unknown, deleted, or not the agency's |
| `org-conversation-message-not-found` | 404 | unknown, deleted already, or not the agency's own `text` message |
| `hub-conversation-message-not-found` | 404 | unknown, deleted already, or not the Hub user's own `text` message |
| `org-hub-user-not-found` | 404 | unknown handle or alias |
| `org-agency-requests-off` | 403 | the Hub user does not accept chat requests from agencies |
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
  directly), chat requests across tenants in both directions (both daily
  limits, every MKT-REQ-003 refusal in order, accept creating or reopening
  the conversation, a recipient's message accepting, both decline scopes
  binding only the sender's direction and the `sender` block lifting after
  the window, expiry, an agency request's Opening becoming a suggestion only
  on acceptance, a Hub request for an unassigned agency or unpublished
  Opening, a Hub-created Contact not counting toward MKT-CON-005, no note
  text in any pointer, mesh event, or audit), the window (each side closed
  by the other side's silence, an agency unable to keep it open alone, a
  changed `conversationWindow` applying from the next Hub command),
  conversations across tenants (shared inbox, the requests switch refusing
  agency requests with its reason while accepted conversations continue and
  the profile view stays, each side deleting only its own `text` messages
  with a stub left for both and the text kept only in the deleter's audit,
  either
  party's deletion leaving a read-only conversation with the reason), notes (shared reading, author-only
  edits, no deletion, both caps, the first note creating a Contact
  whose pointer no Hub response reveals, no note text in any Hub, consumer,
  or mesh response, retention, account deletion removing notes at once, and a
  first note racing account deletion), Job owners (set, change, clear,
  version conflict, every invalid owner, the cap, the owner filter at the
  client tenant, no owner in any client or mesh response), the agency profile
  view (domains with
  months only, no address in any response or mesh payload), consent gating,
  statement contents, and that no amount or payment field exists in any
  response.
- **MKT-TST-002** Cover a tenant that does not answer during search, during a
  provider command and a Hub reply (`202`, then recovery), and while a Hub
  user opens a conversation or sends, accepts, or declines a chat request.
  Cover the requests switch reaching Contacts in other tenants, and
  switching off while an agency request is in flight.
- **MKT-TST-003** `make dev-seed` gives each region two agencies
  (`age1.<region>.test` working for every hiring company in every region,
  `age2.<region>.test` for its own region's) with agents `agent1@` and up and
  Jobs spread across their owners, one provider per stage Capability
  (`itv1`, `asm1`, `bgv1`) with `staff1@` and `staff2@` and routed work
  (`itv1` with one upcoming interview and one completed with feedback on the
  stage's form),
  engagements in each state, and agency Contacts with notes and
  conversations, including a `suggested` and a `declared` credit and a
  Contact with notes only, with Hub users in other regions; per agency a
  pending request to a Hub user, a pending request from one, a declined
  request of each scope.
