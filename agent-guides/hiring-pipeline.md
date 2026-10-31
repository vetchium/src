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
  links to the Hub Applications page; it never carries interview, offer, or
  result content. The event's optional `notice` (`ApplicationNotice`) asks for
  one: `applicationchanges.Record` derives it from the history action
  (`hubapplications.NoticeFor`: interview scheduled, changed, cancelled;
  consent requested; offer extended, withdrawn; any other Org action is
  `status_changed`), the offer-expiry job sends `offer_expired`, and the
  `refresh-hub-applications` job sends `offer_expiring` once, when a
  `respond_by` more than a day after `extended_at` has under a day left.
  Changes the applicant caused carry none. `Project` writes a
  `hub_application_notices` row beside the projection; `status_changed`
  counts only when the Hub status really changed and is not `withdrawn`. The
  workers' `queue-hub-application-emails` job (they hold the outbox key)
  turns each row into a `hub_email_outbox` row of kind
  `application-<notice with hyphens>`, with templates in every Hub locale.
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
  `vetchium.cancel_upcoming_interviews`, `vetchium.end_pending_consents`
  (HP-WRK-012), and `vetchium.end_provider_access` in the same statement;
  moving to another stage ends the consent requests and the route too.
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

## Application questions

An Opening may ask applicants questions; the answers are facts the Org reads.
Vetchium never scores, ranks, or rejects an application by its answers.

- **HP-QST-001** `OpeningContent.questions` holds 0–10 questions in display
  order. Each has an `id` (UUIDv7), `text` (trimmed, 1–500 code points), a
  `type`, and `required`. Types: `short_text` (answer 1–200 code points),
  `long_text` (1–2,000), `number` (an integer; optional `min` and `max`, each
  0–1,000,000,000, `min ≤ max`), `yes_no`, `single_choice` and
  `multiple_choice` (2–8 `options`, each trimmed 1–200 code points, unique
  ignoring case). `min` and `max` belong only to `number`, `options` only to
  the choice types. Declare `type` extensible on responses (OPN-CNT-001).
- **HP-QST-002** A question sent without `id` is new and the API assigns one;
  an `id` must name a question of the same Opening's working copy or live
  content, else `validation-failed`. Ids are unique within the list. Revising
  keeps ids, which is how answers are matched to later edits (HP-QST-006).
  Duplicating copies questions with their ids. AI drafting returns no
  questions.
- **HP-QST-003** Questions are content: they change only through `publish` and
  `revise` approval (OPN-LIFE, OPN-WC), and the Hub sees only live questions
  (`get-org-opening` and the mesh `org-openings/get`). Their absence never
  makes an Opening incomplete.
- **HP-QST-004** `apply-to-opening` and `HubApplyPayload` carry `answers`: at
  most 10 `{question_id, value}`, with `value` a trimmed string for the text
  types, an integer for `number`, a boolean for `yes_no`, one option for
  `single_choice`, and 1–8 unique options for `multiple_choice` (options by
  their exact text). hub-api checks only shape and lengths. The `hub-apply`
  handler checks the answers against the live questions after locking the
  Opening: every required question answered, no unknown or repeated id, each
  value valid for its type, bounds, and options. A blank text answer is no
  answer. A refusal is `hub-application-answers-invalid` (422, carries
  `question_ids`), a deterministic rejection stored as the command's outcome.
  The apply page enforces the same bounds in its inputs; on the refusal it
  reloads the Opening, keeps the answers that still fit their questions, and
  marks the named questions until edited.
- **HP-QST-005** The application stores its answers once, at apply time, as a
  snapshot: every live question in order with its full definition and the
  answer, or none for an unanswered optional question. Nothing changes it
  later. History and audit never hold questions or answers.
- **HP-QST-006** `ApplicationDetail.answers` lists the snapshot with
  `current` for each question, judged against the live content at read time:
  `same` when a live question with the id has the same text, type, and options;
  `changed` when it differs in any of them; `removed` when none has the id.
  Every reader of the application sees the answers, interviewer-only readers
  included (HP-AUTH-003). Providers never see them (MKT-ACC); no provider or
  agency read returns them.
- **HP-QST-007** `list-applications` accepts `answer_columns`, 0–3 ids of
  live `number`, `yes_no`, `single_choice`, or `multiple_choice` questions
  (any other id is `validation-failed`); each row then carries `answers` for
  those ids from its snapshot. Answers are never filters or sort keys.
- **HP-QST-008** `get-my-application` (and the mesh `hub-applications/get`)
  returns the applicant's own snapshot as `answers`, without `current`. The
  Hub projection holds no answers.
- **HP-QST-009** Orgs portal: the Opening editor edits questions with the
  content. When the Opening has live content and the working copy's questions
  differ from it, the editor warns that applications already received keep
  their answers and will show changed questions as changed. Application
  detail shows the answers and marks a `changed` or `removed` question with
  the question as it was asked. The Applicants and Candidates tabs offer a
  column picker for HP-QST-007, remembered per viewer and Opening in the
  browser.
- Answer shapes and normalization live in `typespec/orgs/applications/answers`
  (Go and TypeScript); the check against live questions is
  `backend/internal/hubapply` `ValidateAnswers`, and `current` is judged in
  `backend/handlers/orgs/applications/answers.go`. Extend these; never repeat
  a check in a handler.

## Interview feedback forms

- **HP-FRM-001** An `interview` stage of a pipeline template or an Opening's
  pipeline has `feedback_form`: 0–10 criteria. Each has an `id` (UUIDv7, assigned
  as HP-QST-002), `text` (trimmed, 1–500 code points), a `type`, and
  `required`. Types: `rating` (an integer 1–5), `yes_no` (a boolean), `text`
  (trimmed, 1–2,000 code points). Other stage kinds have no form
  (`validation-failed`). Declare `type` extensible on responses.
- **HP-FRM-002** Forms copy with stages (HP-PIP-003) and are edited with the
  pipeline (HP-PIP-004), keeping criterion ids. When an interview stage that
  already has submitted feedback changes its form, the Pipeline tab warns that
  submitted feedback keeps its answers and will show changed criteria as
  changed; `get-opening-pipeline` returns each stage's
  `feedback_submitted_count` (in-house and provider) for it.
- **HP-FRM-003** `submit-interview-feedback` and
  `submit-work-interview-feedback` carry `criteria_answers` (at most 10
  `{criterion_id, value}`) beside the unchanged `recommendation` and `notes`,
  checked against the form of the interview's stage when submitting: every
  required criterion answered, no unknown or repeated id, each value valid. A
  refusal is `org-interview-feedback-answers-invalid` (422, carries
  `criterion_ids`), answered after the existing interview refusals.
- **HP-FRM-004** Feedback stores its form snapshot and answers as HP-QST-005.
  `InterviewFeedback.criteria_answers` carries `current` as HP-QST-006,
  judged against the stage's form at read time (`removed` when the stage or
  criterion is gone). Visibility follows HP-WRK-004. Provider interviewers
  fill the consumer's form; provider work reads return the stage's form so
  the provider portal can render it, and never the application's answers.
- **HP-FRM-005** Application detail compares feedback per interview: criteria
  as rows and interviewers as columns, with the average of the `rating`
  answers whose `current` is `same`. A `changed` or `removed` answer shows
  marked, with the criterion as it was asked, outside the average.
- Criteria answers are checked against a stage's form, and their `current`
  judged, only in `backend/internal/feedbackform` (`Check`, `Judge`), for
  in-house and provider feedback alike.

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

- **HP-HUB-001** The Hub status is derived, never stored at the authority,
  and says what happened to the applicant: `applied` (`submitted`),
  `in_review` (`in_pipeline` not at an interview stage), `interviewing` (at an
  interview stage), `offered`, `offer_accepted`, `joined`, `not_selected`
  (`not_progressing`), `declined` (`offer_declined`, `did_not_join`),
  `withdrawn`. `joined`, `not_selected`, `declined`, and `withdrawn` are
  closed (`applications.ClosedStatuses`, `vetchium.hub_application_closed`);
  the rest are active. Stage names, routing, results, and feedback never
  reach the Hub.
- **HP-HUB-002** The list reads one view (`active` or `closed`) of the
  projection (HP-GEN-004), keyset paginated (at most 50), newest activity
  first; the portal loads 20 at a time with "Show more". `query` matches a
  substring of the Org display name or Opening title ignoring case;
  `awaiting_answer` keeps rows with a pending action; closed rows have none,
  so the portal offers it on Active only. A pagination key binds the view and
  normalized filters. The portal keeps the tab, `q`, and `awaiting=1` in the
  URL. Tab counts and the awaiting-answer badge come from
  `my-application-counts`, and an Opening page finds its application with
  `find-my-opening-application`; never walk the whole list. Detail reads live from the Org's tenant over the mesh with a
  deadline; failure is `hub-org-unavailable`.
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
  stays pending there until the next change; the live detail is exact. An
  offer's own expiry moves the application (HP-STA-013); for an interview,
  `org_applications.hub_refresh_at` holds when the next unanswered interview
  starts (every projection event rewrites it) and the workers'
  `refresh-hub-applications` job re-reports the application then, bumping
  `version` but not `updated_at`.

## Orgs Candidacies pages

- **HP-ORG-001** Opening detail has an Applicants tab (`submitted`) and a
  Candidates tab (candidacies by stage, then terminal ones under a state
  filter). Each lists server-side with filters for
  state, stage, routed provider (`routed_engagement_id`), and pending applicant action
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
  "Becomes terminal" is `updated_at`, which a terminal application no longer
  moves. The Hub projection goes by the `hub-application-removed` event
  (`HubApplicationRemovedPayload`, origin and aggregate as
  `hub-application-changed`, version the application's version after
  removal); after it `get-my-application` answers `hub-application-not-found`.
- **HP-RET-002** The deletion is one state-guarded statement per
  application (`RetainOrgApplication`) with history (`removed`, actor
  `system`) and audit counts, and enqueues the offer letter's object for
  deletion. It replaces the snapshot with `{"display_name": "Removed
  applicant"}`, sets `removed_at`, bumps `version`, and deletes the
  application's answers, feedback (with its criteria answers), interviewers,
  interviews, assessments, background
  check results and checks, and offers each by name, never by cascade alone.
  Offers go with their letters (not kept); each letter becomes
  `pending_delete` for `delete-offer-letters`. Readers return
  `removed: true`, an empty `cover_note`, and no answers, interviews,
  results, or offers; the portals replace the placeholder name with their own localized
  "Removed applicant". Name search skips removed applications.

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
| `hub-application-answers-invalid` | 422 | the answers do not satisfy the Opening's live questions; carries `question_ids` |
| `org-interview-feedback-answers-invalid` | 422 | the criteria answers do not satisfy the stage's form; carries `criterion_ids` |

## Tests and fixtures

- **HP-TST-001** Cover in `playwright/api/`: every state transition and its
  refusals, applying to a local and a remote Org (including the `202` path),
  duplicate applications under concurrency, each access path in HP-AUTH,
  interview feedback visibility, every question and criterion type with its
  bounds and refusals, `current` after edits and removals, consent gating,
  offer expiry, date corrections and their window, retention deletion, that
  no stage name, feedback, or result reaches a Hub or mesh response to the
  Hub, and that no provider read returns application answers.
- **HP-TST-002** `make dev-seed` gives each seeded Org pipeline templates and
  applications in every non-terminal state from Hub users in more than one
  region, Openings with questions of every type, one revised after answers
  arrived, and interview stages with feedback forms and submitted feedback.
