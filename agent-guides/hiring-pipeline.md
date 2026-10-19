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
- **HP-APP-008** The command kind is `hub-apply`; `typespec/federation/hiring`
  defines its payload and `201` result, its authority is the Org, and its
  aggregate id is the Opening number as decimal text. The handler is
  `backend/internal/hubapply`: it locks the Opening row first, which
  serializes numbering and `hub-application-exists` per Opening.

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
  An interview is upcoming while it is `scheduled` and its start is ahead;
  one whose start passed stays to be recorded (HP-WRK-004). Every statement
  that ends a candidacy (not progressing, bulk close, applicant withdrawal,
  offer decline or expiry, joined, did not join) calls
  `vetchium.cancel_upcoming_interviews` and `vetchium.end_pending_consents`
  (HP-WRK-012) in the same statement; moving to another stage ends the
  consent requests too.
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
- **HP-STA-007** The applicant withdraws through the `hub-withdraw` command
  (`backend/internal/hubwithdraw`), authority the Org, aggregate id the
  Opening number; it finds only the applicant's own application
  (`hub-application-not-found`) and refuses any other state with
  `hub-application-state-conflict`.
- **HP-STA-008** The Org's writes are `shortlist-application`,
  `move-application-stage`, `complete-application-stage` (a pending `review`
  stage only), `mark-application-not-progressing`, `record-application-joined`,
  `record-application-did-not-join`, `record-application-separated`,
  `correct-application-joined-on`, and `correct-application-separated-on`.
  `backend/handlers/orgs/applications/transitions.go` runs each: it locks the
  application, answers `org-application-not-found` (unreadable),
  `org-permission-required` (a reader who may not act: hiring-team members),
  version conflict, state conflict, then `validation-failed` for a date or
  stage rule, applies one guarded statement, and calls
  `internal/orgs/applicationchanges.Record` for history, audit, and the Hub
  projection event. Responses are `ApplicationDetail`, which carries
  `positions` and `joined_count` for the over-hiring warning (HP-STA-006).
  Acting is `vetchium.org_user_acts_on_applications`.
- **HP-STA-009** Dates are UTC calendar dates; "today" is the UTC date.
  `offer_extended_at` on the application bounds `joined_on`; the offer
  extension must set it.
- **HP-STA-010** Closing an Opening (`request-opening-change` kind `close`)
  takes `mark_applications_not_progressing`, stored on the request and applied
  by `applicationchanges.MarkClosedOpeningNotProgressing` in the transaction
  that closes (self-approved or approved).
- **HP-STA-011** Offers: `extend-application-offer` (`in_pipeline`, any
  stage) claims the caller's uploaded letter (`letter_id`, from
  `upload-offer-letter`), takes an optional `proposed_joining_date` (at least
  today) and `respond_within_days` (1–60), numbers the offer per application
  from 1, and sets `respond_by` and `offer_extended_at`;
  `withdraw-application-offer` returns `offered` to `in_pipeline` at its
  stage. Both run through transitions.go. Offer status: `extended`,
  `accepted`, `declined`, `expired`, `withdrawn`; at most one `extended`.
  Leaving `offered` any other way (not progressing, bulk close, applicant
  withdrawal) withdraws the extended offer in the same statement.
  `ApplicationDetail.offers` lists every offer, newest first, with a signed
  letter link.
- **HP-STA-012** The applicant answers through `hub-accept-offer` and
  `hub-decline-offer` (`backend/internal/huboffer`, payload
  `HubOfferResponsePayload`), authority the Org, aggregate id the Opening
  number, naming the `offer_number` they read. Any state but `offered`, an
  offer that is not the extended one, or a passed `respond_by` is
  `hub-application-state-conflict`.
- **HP-STA-013** The workers' `expire-application-offers` job locks a batch of
  `offered` applications whose extended offer's `respond_by` passed, then
  moves them to `offer_declined` (offer `expired`) in one state-guarded
  statement with history (actor `system`) and audit, and enqueues their
  projection events in the same transaction.

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
- **HP-WRK-012** In-house results run through `transition`
  (`backend/handlers/orgs/applications/results.go`, who acts on the Opening's
  applications): `record-assessment-result` (`in_pipeline` at a pending
  `assessment` stage; once, because it completes the stage),
  `request-background-check-consent` (check types 1–20, unique, known; at a
  pending `background_check` stage with no active request, where `requested`
  and `given` are active and a `declined` or `ended` request lets the Org ask
  again; numbered per application as `check_number`), and
  `record-background-check-result` (needs the `given` request of the current
  stage; a type it did not name is `validation-failed` on `check_type`, one
  already recorded or recorded before consent is
  `org-application-state-conflict`; the result that completes the requested
  set completes the stage in the same statement). Notes are optional, trimmed,
  and blank means none. History holds the action and stage, never notes or
  links. `ApplicationDetail.assessments` and `background_checks` are empty
  for a reader who only interviews (HP-AUTH-003), as offers are.
- **HP-WRK-013** The applicant answers a consent request through
  `hub-give-background-check-consent` and
  `hub-decline-background-check-consent` (`backend/internal/hubconsent`,
  payload `HubBackgroundCheckConsentPayload` naming `check_number`), authority
  the Org, aggregate id the Opening number. An unknown application or request
  is `hub-application-not-found`; a request already answered or ended, or a
  candidacy that left the pipeline, is `hub-application-state-conflict`.
  `background_check_consent` is pending while a request is `requested`. The
  Hub detail's `background_check_consent` holds the number, check types,
  and the performer (`org`); it never holds the stage or any result.

- **HP-WRK-008** Offer: an offer letter (PDF, at most 5 MiB, the
  object-storage pipeline of [`object-storage.md`](object-storage.md)), an
  optional proposed joining date, and a response deadline of 1–60 days. A
  withdrawn offer keeps its letter in history for the Org only.

- **HP-WRK-009** The Org's interview writes are `schedule-interview`
  (`in_pipeline` at an interview stage; at most 10 not `cancelled` per
  candidacy and stage, else `org-interview-limit-reached`; a start in the
  future; interviewers that are not all active users of the Org are
  `org-interview-interviewers-invalid`), `change-interview` (replaces the
  details and interviewers of an upcoming interview; a change of start,
  duration, or mode details resets the response and its note, a change of
  interviewers alone keeps them), `cancel-interview` (upcoming only),
  `record-interview-outcome` (`completed` or `no_show` from `scheduled`, once
  the start passed; an interviewer of that interview, or whoever acts on the
  Opening's applications), and `submit-interview-feedback` (an interviewer of
  that interview, once, on a `completed` interview; notes 1–10,000 code
  points). `backend/handlers/orgs/applications/interviews.go` runs each
  through `transition`: it locks the application, answers
  `org-application-not-found`, `org-permission-required`, version conflict,
  then the interview refusals (`org-interview-not-found`,
  `org-interview-state-conflict`, `org-interview-feedback-exists`), then
  `validation-failed`. Each write bumps the application `version`, appends a
  history entry (`interview_*`, with `interview_number`, never notes), and
  returns `ApplicationDetail`. Timing is judged by the database clock.
- **HP-WRK-010** `ApplicationDetail.interviews` lists every interview with
  its stage, interviewers (and whether each submitted), and feedback. The
  query hides every other interviewer's feedback from an interviewer who has
  not submitted their own. `list-my-interviews` is keyed by the caller and
  paginates by interview id (a UUIDv7, so newest scheduled first).
- **HP-WRK-011** The applicant answers an upcoming interview through
  `hub-accept-interview` and `hub-request-interview-reschedule`
  (`backend/internal/hubinterview`, payloads `HubAcceptInterviewPayload` and
  `HubRescheduleInterviewPayload` with a note of 1–500 code points), authority
  the Org, aggregate id the Opening number. An unknown application or
  interview is `hub-application-not-found`; a cancelled, started, or
  finished interview, a candidacy that left the pipeline, or repeating the
  same answer is `hub-application-state-conflict`. `interview_response` is
  pending while an upcoming `scheduled` interview's response is `pending`.
  The Hub sees `scheduled` and `cancelled` interviews with time, duration,
  mode, link or location, response, and note; never the stage, interviewers,
  outcome, or feedback.

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
  `list-my-interviews` is how they find them. They see no offers: the
  offers and their letters are for readers of all the Opening's applications
  (`vetchium.org_user_reads_all_applications`).
- **HP-AUTH-004** `org:view_openings` grants no access to applications.
- **HP-AUTH-005** Pipeline templates and an Opening's pipeline need
  `org:manage_openings`.
- **HP-AUTH-006** Answer an application the caller may not read with
  `org-application-not-found`.
- **HP-AUTH-007** Every application read applies
  `vetchium.org_user_reads_applications(opening, user, application)` in its
  SQL; add a new read path to that function. Called without the application
  it answers whether the user may open the Opening at all (an interviewer of
  any of its applications may); called with it, whether they read that
  application. A list leads with the Opening call and keeps each row by the
  application call; counts and history use the application call. Answer a list,
  count, or history for an Opening the caller may not read with the same
  `org-application-not-found`, an unknown Opening included.

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
- **HP-HUB-006** The projection event is `hub-application-changed`
  (`typespec/federation/hiring`), aggregate `org_application`
  `<org did>:<opening number>:<application number>`, versioned by the
  application's `version`. `backend/internal/hubapplications` derives the Hub
  status and enqueues the event in every transaction that changes an
  application.
- **HP-HUB-007** `get-my-application` returns `MyApplicationDetail`: the
  latest offer unless the Org withdrew it, with a letter link signed in the
  Org's tenant. `offer_response` is pending while the application is
  `offered` and its extended offer's `respond_by` is ahead. The detail also
  lists the interviews (HP-WRK-011). The list projection judges time when the
  event is written, so an interview or offer whose time passes unanswered
  stays pending there until the next change; the live detail is exact.

## Orgs Candidacies pages

- **HP-ORG-001** Opening detail has an Applicants tab (`submitted`) and a
  Candidates tab (candidacies by stage, then terminal ones under a state
  filter). Each lists server-side with filters for
  state, stage, routed provider, and pending applicant action
  (`pending_applicant_action`: `interview_response`,
  `background_check_consent`, `offer_response`); display-name
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
| `org-pipeline-template-not-found` | 404 | the Org has no template with the id |
| `org-pipeline-template-limit-reached` | 409 | the Org already has 50 templates; carries `limit` |
| `hub-application-exists` | 409 | the applicant already applied to the Opening |
| `hub-opening-not-accepting` | 409 | the Opening is not `published` |
| `org-interview-not-found` | 404 | the application has no interview with the number |
| `org-interview-state-conflict` | 409 | the interview's state or time does not allow the action |
| `org-interview-feedback-exists` | 409 | the caller already submitted feedback on the interview |
| `org-interview-limit-reached` | 409 | the stage holds the most interviews; carries `limit` |
| `org-interview-interviewers-invalid` | 422 | a named interviewer is not an active user of the Org; carries `email_addresses` |
| `hub-application-not-found` | 404 | unknown application, or not the caller's |
| `hub-application-state-conflict` | 409 | the application's state does not allow the applicant's action |

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
