# Hiring pipeline

Applies to applicants, applications, pipeline templates, an Opening's
pipeline, candidacies, interviews, assessment and background-check results,
offers, joining and separation, the Orgs Candidacies pages, and the Hub
Applications pages. Compose with [`openings.md`](openings.md),
[`federation.md`](federation.md), and [`authorization.md`](authorization.md).
Work performed by another Org is in [`marketplace.md`](marketplace.md).

## Ownership and identity

- **HP-GEN-001** Applicants, applications, candidacies, stage results,
  interviews, and offers belong to the Opening's Org and are authoritative in
  the Org's home tenant ([`federation.md`](federation.md) Authority).
- **HP-GEN-002** An applicant is one row per (Org, person) in the Org's tenant
  with an internal id, a `kind`, and a nullable `hub_user_did`. The only kind is
  `hub_user`, and a CHECK requires its DID. Every other hiring row references
  the applicant id, never the DID, so a later applicant without a Hub account
  needs a new kind, not a new structure. Unique on (Org, `hub_user_did`).
- **HP-GEN-003** Identify an application on the wire by (Org domain, opening
  number, application number). The number is allocated per Opening from a
  counter on the Opening row, never reused. Internal ids and DIDs never leave
  the backend.
- **HP-GEN-004** The Hub user's home tenant keeps a non-authoritative
  projection per application, fed by the Org tenant's outbox: Org domain and
  display name, opening number and title, application number, Hub status
  (HP-HUB-001), pending action kinds, and timestamps. It holds no stage name,
  feedback, or Org user data.
- **HP-GEN-005** There is no contact channel outside Vetchium. No Org ever
  receives the account email or any contact detail; every interaction happens
  on the Orgs Candidacies pages, the Hub Applications pages, and agency
  conversations ([`marketplace.md`](marketplace.md) MKT-CNV).
- **HP-GEN-006** The Hub user's home tenant sends their notification emails,
  triggered by projection events. An email names the Org and Opening title and
  links to the application; it never carries interview, offer, or result
  content.
- **HP-GEN-007** Every write appends a candidacy history entry and an audit
  event in the same transaction, carries the application's `version`
  (`org-application-version-conflict`), and takes an `Idempotency-Key`.
  History and audit hold numbers, actions, states, and dates, never notes,
  feedback, or snapshot text.
- **HP-GEN-008** Every rule lives in the API, never only in a portal
  (OPN-GEN-005).
- **HP-GEN-009** Every Hub user action on an application (apply, withdraw,
  interview response, consent, offer response) is a durable command from
  the Hub user's home tenant to the Org's tenant, as HP-APP-001. The Hub
  tenant writes only its operation ledger and, from the Org tenant's outbox,
  the projection.

## Applying

- **HP-APP-001** A Hub user applies to a `published` Opening. The Hub user's
  hub-api sends a durable command to the Org's tenant
  ([`federation.md`](federation.md)); an uncertain outcome is `202` with
  `PendingOperation`. A local Org takes the same command path in process.
- **HP-APP-002** An application holds an immutable snapshot of the Hub
  profile view fields at apply time, excluding the picture, and an optional
  cover note of at most 5,000 code points. Professional-email evidence never
  enters it. Résumé files are in `docs/todo.md`.
- **HP-APP-003** One application per (Opening, applicant) ever, withdrawn ones
  included: `hub-application-exists`. A non-`published` Opening is
  `hub-opening-not-accepting`.
- **HP-APP-004** Vetchium does not enforce `remote_eligibility` or experience
  against the applicant; the Org sees the snapshot's resident country.
- **HP-APP-005** Pausing, closing, or expiring an Opening stops new
  applications only; existing ones continue so the Org can finish hiring.
  Closing offers to mark every non-terminal application `not_progressing` in
  bulk.
- **HP-APP-006** Org suspension stops new applications; Hub users still see
  their applications' last status.
- **HP-APP-007** Only the Hub user applies, always for themselves. The apply
  page's "Referred by" choice is theirs alone
  ([`marketplace.md`](marketplace.md) MKT-SRC-002).

## States

Application states:

| From | Action | By | To |
| --- | --- | --- | --- |
| (none) | apply | applicant | `submitted` |
| `submitted` | shortlist to a stage | Org | `in_pipeline` |
| `in_pipeline` | move to a later stage, skipping any between | Org | `in_pipeline` |
| `in_pipeline` | extend offer | Org | `offered` |
| `offered` | withdraw offer | Org | `in_pipeline` |
| `offered` | accept | applicant | `offer_accepted` |
| `offered` | decline, or deadline passes | applicant, system | `offer_declined` |
| `offer_accepted` | record joined on | Org | `joined` |
| `offer_accepted` | record did not join | Org | `did_not_join` |
| `submitted`, `in_pipeline`, `offered`, `offer_accepted` | not progressing | Org | `not_progressing` |
| `submitted`, `in_pipeline`, `offered`, `offer_accepted` | withdraw | applicant | `withdrawn` |

- **HP-STA-001** `joined`, `did_not_join`, `offer_declined`, `not_progressing`,
  and `withdrawn` are terminal. Shortlisting creates the candidacy: the
  applicant becomes a candidate. A candidacy is an application in
  `in_pipeline`, `offered`, or `offer_accepted`.
- **HP-STA-002** Leaving the pipeline cancels its upcoming interviews and
  ends every provider's access ([`marketplace.md`](marketplace.md) MKT-ACC).
- **HP-STA-003** Moving forward records each passed-over stage as `skipped`.
  Moving back and per-candidacy extra stages are in `docs/todo.md`.
- **HP-STA-004** An offer may be extended from any stage; unfinished stages
  stay as they are.
- **HP-STA-005** Joining and separation dates are facts the Org records:
  `joined_on` at most today and not before the offer was extended;
  `separated_on` optional, after `joined_on` and within 365 days of it. The Org
  may correct either within 90 days of first recording; history keeps every
  value.
- **HP-STA-006** Hiring more applicants than `positions` is allowed; the
  portal warns.

## Pipelines

Stage kinds: `review`, `assessment`, `interview`, `background_check`. Declare
the vocabulary as extensible on responses (OPN-CNT-001).

- **HP-PIP-001** A stage has a name (1–100 code points), a kind, and a stable
  id. A pipeline has 1–15 stages in order.
- **HP-PIP-002** An Org has 0–50 pipeline templates, each with a name of
  1–100 code points (unique per Org, case-insensitive) and a stage list.
- **HP-PIP-003** An Opening owns its pipeline. Creating an Opening copies a
  chosen template or starts with one `review` stage; duplicating copies the
  source Opening's pipeline. Editing a template never changes an Opening.
- **HP-PIP-004** The pipeline is internal and is edited directly, without an
  Opening request (OPN-TEAM-003), in every non-terminal Opening state.
  Renaming or reordering is always allowed. Removing a stage that holds a
  candidacy is `org-pipeline-stage-in-use`.
- **HP-PIP-005** Offer, joining, and separation are not stages; they follow
  the pipeline (States).

## Stage work

A candidacy is at one stage at a time. Each stage records `pending`,
`completed`, or `skipped` per candidacy. Work is in-house or routed to a
provider ([`marketplace.md`](marketplace.md) MKT-ASG); both use the shapes
below.

- **HP-WRK-001** `review`: a completed mark only; in-house only.
- **HP-WRK-002** Interviews: 0–10 per candidacy at an `interview` stage. Each
  has a start time (UTC), a duration of 15–480 minutes, a mode (`video` with an
  HTTPS URL passing the website URL validator, or `in_person` with a location
  of at most 500 code points), and 1–10 interviewers, each an active user of
  the performing Org.
- **HP-WRK-003** The applicant accepts an interview or requests a reschedule
  with a note of at most 500 code points. Changing the time or mode resets the
  response. The Org may cancel an interview.
- **HP-WRK-004** After the start time, an interviewer or the Opening's
  recruiter records `completed` or `no_show`. Each interviewer submits
  feedback once: a recommendation (`strong_yes`, `yes`, `no`, `strong_no`) and
  notes of at most 10,000 code points. An interviewer sees other feedback on
  that interview only after submitting their own.
- **HP-WRK-005** `assessment`: an outcome (`pass`, `fail`, `inconclusive`),
  an optional score of 0–100, notes of at most 2,000 code points, and an
  optional HTTPS report link.
- **HP-WRK-006** `background_check`: the Org selects check types (`identity`,
  `education`, `employment`, `criminal`, `address`, `credit`, `drug`;
  extensible). Nothing is recorded until the applicant consents in the Hub
  (HP-HUB-003). Each check records an outcome (`clear`, `discrepancy`,
  `unable_to_verify`), a note of at most 2,000 code points, and an optional
  HTTPS link to the performer's report. Vetchium stores no report files.
- **HP-WRK-007** Vetchium records results and never decides adverse action;
  that is the Org's responsibility.
- **HP-WRK-008** Offer: an offer letter (PDF, at most 5 MiB, the
  object-storage pipeline of [`object-storage.md`](object-storage.md)), an
  optional proposed joining date, and a response deadline of 1–60 days. A
  withdrawn offer keeps its letter in history for the Org only.

## Permissions

| Permission | Allows |
| --- | --- |
| `org:manage_candidacies` | read and act on every Opening's applications |

- **HP-AUTH-001** Add it to the Org catalog; `org:superadmin` implies it. An
  `org:manage_users` holder may grant or revoke it. Add it to the Recruiter
  preset.
- **HP-AUTH-002** An Opening's hiring manager and recruiter read and act on
  its applications without the permission. Its hiring-team members only read
  them.
- **HP-AUTH-003** An interviewer without other access reads only the
  candidacies of their interviews and acts only on their own interview.
- **HP-AUTH-004** `org:view_openings` grants no access to applications.
- **HP-AUTH-005** Pipeline templates and an Opening's pipeline need
  `org:manage_openings`.
- **HP-AUTH-006** Answer an application the caller may not read with
  `org-application-not-found`.

## Hub Applications pages

- **HP-HUB-001** The Hub status is derived, never stored at the authority:
  `applied` (`submitted`), `in_review` (`in_pipeline` not at an interview
  stage), `interviewing` (at an interview stage), `offer` (`offered`,
  `offer_accepted`), `hired` (`joined`), `not_progressing` (`not_progressing`,
  `offer_declined`, `did_not_join`), `withdrawn`. Stage names, routing,
  results, and feedback never reach the Hub.
- **HP-HUB-002** The list reads the projection (HP-GEN-004), keyset paginated
  (at most 50), newest activity first. Detail reads live from the Org's tenant
  over the mesh with a deadline; failure is `hub-org-unavailable`.
- **HP-HUB-003** Detail shows the actions awaiting the applicant: interview
  responses, background-check consent (the check types, the performer, and
  any provider disclosure text), and the offer to accept or decline.
  Declining consent completes nothing; the Org decides what follows.
- **HP-HUB-004** Detail names a provider performing a step for the Org
  ([`marketplace.md`](marketplace.md) MKT-WRK-005).
- **HP-HUB-005** Ship every string in every `hub-ui` locale.

## Orgs Candidacies pages

- **HP-ORG-001** Opening detail has an Applicants tab (`submitted`) and a
  Candidates tab (candidacies by stage, then terminal ones under a state
  filter). Each lists server-side with filters for
  state, stage, routed provider, and pending applicant action; display-name
  substring search (at least two characters); keyset pagination (at most
  100); and a count per stage.
- **HP-ORG-002** Application detail shows the snapshot, cover note, stage
  progress, interviews and feedback (HP-WRK-004), results, offer, dates,
  the credited agency and its route (MKT-SRC-007), and history.
- **HP-ORG-003** Show actions only when permissions and state allow them; the
  API still decides. Ship every string in every `orgs-ui` locale.

## Retention

- **HP-RET-001** 365 days after an application becomes terminal (for
  `joined`, 365 days after `joined_on`, once the separation window closes), a
  `workers` job deletes its snapshot, cover note, interview details,
  feedback, results, notes, links, and offer letter, and through the outbox
  the Hub projection row. It keeps the applicant reference, numbers, states, dates, credit,
  and billable facts; portals show "Removed applicant".
- **HP-RET-002** The deletion is one state-guarded statement per
  application with audit, and enqueues the offer letter's object for deletion.

## Problem types

| Type | Status | Meaning |
| --- | --- | --- |
| `org-application-not-found` | 404 | unknown number, or not readable by the caller |
| `org-application-version-conflict` | 409 | the application changed since the caller read it |
| `org-application-state-conflict` | 409 | the action is not allowed in the current state |
| `org-pipeline-stage-in-use` | 409 | the stage holds a candidacy |
| `org-pipeline-template-name-taken` | 409 | another template has the name |
| `hub-application-exists` | 409 | the applicant already applied to the Opening |
| `hub-opening-not-accepting` | 409 | the Opening is not `published` |
| `hub-application-not-found` | 404 | unknown application, or not the caller's |

## Tests and fixtures

- **HP-TST-001** Cover in `playwright/api/`: every state transition and its
  refusals, applying to a local and a remote Org (including the `202` path),
  duplicate applications under concurrency, each access path in HP-AUTH,
  interview feedback visibility, consent gating, offer expiry, date
  corrections and their window, retention deletion, and that no stage name,
  feedback, or result reaches a Hub or mesh response to the Hub.
- **HP-TST-002** `make dev-seed` gives each seeded Org pipeline templates and
  applications in every non-terminal state from Hub users in more than one
  region.
