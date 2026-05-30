# Hiring: Applications, Candidacies, Interviews, Offers, and Connection-Enhanced Features

> Canonical hiring spec for Vetchium. Supersedes the earlier brainstorm notes (`hiring-flow.md`, `connection-enhanced-hiring.md`) and the one-shot implementation prompt (`prompt.txt`), all now removed; this document is the single source of truth.

---

## Stage 1: Requirements

Status: **APPROVED**
Authors: @psankar
Dependencies:

- `org/openings.tsp` (implemented) — opening lifecycle Draft → PendingReview → Published → Paused → Expired → Closed → Archived
- `hub/connections.tsp` (implemented) — verified colleague graph
- `hub/work-emails.tsp` (implemented) — verified employer stints with overlap years
- `org/tiers.tsp` (implemented) — quota caps (no new caps added by this spec)

### Overview

This spec delivers the complete candidate-side hiring experience plus the connection-enhanced features that make Vetchium structurally different from generic ATS products. It touches **both** portals:

- **hub-ui**: candidates browse openings, apply with cover letter + resume, request endorsements from verified colleagues, accept referrals from current employees of target companies, RSVP to interviews, comment on candidacies, nominate references, and submit reference responses.
- **org-ui**: recruiters and hiring managers review applications (with attached colleague endorsements and verified work history visible inline), shortlist or reject, label, schedule and conduct interviews, extend offers, and request structured references.

Connection-enhanced features layered on top of the basic flow:

1. **Colleague endorsements** attached to specific applications, written by verified former colleagues.
2. **Connection visibility during browsing**: privacy-respecting count of colleagues at each hiring company.
3. **Current-employee referrals**: a hub user with an active work-email stint at the hiring company nominates a former colleague.
4. **Passive colleague alerts**: opt-in notification to a candidate's connections at the target company when the candidate applies.
5. **Relationship context** rendered inline beside every endorsement (domain, overlap years, current connection state).
6. **Network-based job discovery**: surface openings at companies where the user's colleagues currently work.
7. **Structured reference facilitation**: candidate nominates references from the connection graph; nominees opt in and respond to a structured questionnaire.

Cross-cutting design rules carried forward from the brainstorm:

- The employer never browses the candidate's connection graph or contacts connections directly.
- The candidate's current employer never receives a signal that the candidate is applying elsewhere.
- An endorser can decline silently; the candidate is not told who declined.
- Endorsements supplement evaluation; they never auto-rank candidates.

### Acceptance Criteria

Grouped by persona. Every item below is an acceptance test for Stage 1 sign-off.

#### Candidate (hub user)

- [ ] Can browse `published` openings without authentication for public fields; full apply requires login + `hub:apply_jobs` role.
- [ ] Sees a "N of your colleagues work here" count on opening detail when ≥1 connection has an `active` work-email stint at **any** verified domain owned by the opening's org (an org can own multiple domains via the existing claim-domain flow; all of them count).
- [ ] Can click through to a list of those colleagues' handles (deliberate action, not passive display). The list shows, for each colleague, the shared domain + overlap years (so the candidate can recognise the relationship), plus the colleague's current employer domain at this org.
- [ ] Can apply to an opening in `published` state via a **multipart/form-data** POST to `/hub/apply-for-opening` carrying: `cover_letter` (text field, 100–5000 chars), `resume` (file part, PDF or DOCX, ≤5 MB; magic-byte check enforced server-side), `org_domain` (text), `opening_number` (text/int), optional repeated `endorser_handles[]` (≤10), optional `endorsement_request_note`, optional `notify_colleagues_at_target` (`"true"`/`"false"`). The handler streams the file to the **opening's** region S3 bucket inside the same transaction that creates the application row. No presigned URLs — the codebase does not use that pattern (verified against `admin/upload-tag-icon.go`).
- [ ] Cannot apply if any other application of theirs at the same org is in `applied`, `shortlisted`, or candidacy state `interviewing` / `offered` (409 with `live_application_exists`).
- [ ] Cannot apply twice to the exact same opening regardless of prior outcome (409 with `already_applied`).
- [ ] Cannot apply during the org's cool-off window if a prior application **reached candidacy** at that org. The cool-off window is measured from the prior application's `applied_at` (not from shortlist time, per `hiring-flow.md`). 422 with `cool_off_active` and the earliest re-apply date in the body. Cool-off is per-org, default 90 days; `0` disables.
- [ ] Each nominated endorser must be in `connected` state with the candidate; any non-connection in the list → 400 `not_a_connection`.
- [ ] Can withdraw their application **only** while in `applied` state.
- [ ] Can list own applications filtered by state, paginated keyset.
- [ ] Can get full application detail including all written endorsements, current state, label (Green/Yellow/Red), `ai_score` (nullable, exposed but never blocking).
- [ ] Can list own candidacies (created on shortlist) and view interview schedule.
- [ ] Can RSVP `yes`/`no` to a `scheduled` interview; can change RSVP until the interview transitions to `completed` or `cancelled`.
- [ ] Sees interview meta (type, times, description, own RSVP, each interviewer's RSVP **state**) but never interviewer names, decisions, or written feedback.
- [ ] Can comment on a candidacy while it is in `interviewing` or `offered`; cannot once it reaches a terminal state.
- [ ] Receives notifications: own application shortlisted, own application rejected, interview scheduled (with type, times, description, interviewer count), interview rescheduled, interview cancelled, offer extended, reference request received, endorsement request received, **endorsement written** (visibility that the colleague responded — declines are silent), **reference nomination accepted** (so candidate sees momentum), referral nomination received.
- [ ] Can request endorsements at apply-time or any time while the application is in `applied`. Per (application, endorser) pair only one request may exist.
- [ ] Can remove any endorsement from own application at any time (even after shortlist) — does not delete the endorsement; sets `hidden_by_candidate=true` so it is no longer surfaced to the employer.
- [ ] Can re-show a previously hidden endorsement while application is still in `applied`.
- [ ] Per-application preference `notify_colleagues_at_target` overrides the global setting; default OFF.
- [ ] Sees "Opportunities through your network" tile on hub dashboard: for each company where ≥1 connection currently works, surfaces up to 3 `published` openings ranked by recency.
- [ ] Can opt in/out globally via `/hub/set-notify-connections-on-apply`. Setting only affects future applications.
- [ ] Receives a referral notification listing the referrer's handle, domain + overlap years, the opening title, and the referrer's statement. Can: accept-and-prefill-apply, decline, or ignore (auto-expires after 30 days).
- [ ] On accepting a referral, the candidate completes the apply form normally; the referrer's statement is auto-attached as a `referral` endorsement on the resulting application.
- [ ] On reference request from the hiring team, can nominate `max_references` from own connection list. Nominees must be `connected`. Nominator cannot bypass the questionnaire — references must complete the structured questionnaire (no free-form).
- [ ] Can never see which endorsers the org reviewer has read, nor whether the org has actioned the application beyond the public state.

#### Endorser (hub user, when colleague asks)

- [ ] Receives a notification with the candidate's handle + display name, the opening (title, company domain, location summary), the candidate's optional note, and the relationship context (shared domain + overlap year range computed from stints).
- [ ] Can write an endorsement (100–2000 chars) or decline. Declining does not notify the candidate and leaves no audit trace visible to the candidate.
- [ ] Can edit their own endorsement only while the application is still in `applied` state. Once the application moves to `shortlisted` or `rejected`, endorsement is frozen.
- [ ] An endorser can write **exactly one** endorsement per (candidate, opening) pair.
- [ ] An endorser can voluntarily endorse a candidate's specific application even without being asked, **only if** the candidate's preference `allow_unsolicited_endorsements` is ON (default OFF). Mirrors the consent table in the brainstorm doc.
- [ ] If the connection is later severed, the endorsement persists; the employer view shows a "no longer connected" badge alongside the relationship context.

#### Referrer (hub user with active stint at hiring company)

- [ ] Can list `published` openings at any company where they have an `active` verified work-email stint (at any of the org's domains). The "Refer a colleague" button on the regular opening detail page is shown only when `/hub/get-opening`'s response includes `viewer_can_refer=true`, which the backend computes from the viewer's active stints crossed with the opening's org's domains.
- [ ] Can nominate a **connection** (not stranger) for any such opening with a statement of 100–2000 chars.
- [ ] Per (referrer, candidate, opening) only one open nomination may exist (409 on retry while pending).
- [ ] Can see only whether the candidate applied as a result (boolean). Cannot see application state, label, candidacy state, interviews, or offer status.
- [ ] Referrer's statement becomes a `referral` endorsement attached to the candidate's application iff the candidate accepts and submits.
- [ ] Cannot nominate themselves.
- [ ] Cannot nominate a candidate already in `applied`/`shortlisted`/candidacy state for that opening (422 `already_in_pipeline`).

#### Recruiter / hiring manager / hiring team member (org user)

- [ ] With `org:view_applications` — can list applications for any opening at own org, paginated, with filters: state, label, has_endorsements, has_referral. Can get full application detail including: candidate handle and display name, verified work history (employer stints embedded), cover letter, resume download URL, all visible endorsements (with relationship context badge, connection status badge), `ai_score`, label, state, applied_at, state-changed-at.
- [ ] With `org:manage_applications` — can move application from `applied` to `shortlisted` (creates candidacy) or `rejected`. Can set/clear the colour label while in `applied`. Cannot label or change state outside `applied`.
- [ ] With `org:view_applications` — can list candidacies and read candidacy detail (state, comments, interviews, offer, references).
- [ ] With `org:manage_candidacies` — can schedule, reschedule, cancel interviews; add interviewers; remove interviewers; add candidacy comments; extend offer; request references; review reference responses.
- [ ] An org user assigned as an interviewer can submit feedback **only for interviews they are an interviewer on**, regardless of any other role they hold. Submitting feedback transitions the interview to `completed`. Feedback overwrites cleanly per (interview, interviewer); each save replaces the prior submission.
- [ ] Extending an offer transitions candidacy to `offered`, auto-cancels every interview still in `scheduled`, writes a system comment on the candidacy, and notifies the candidate + opening watchers.
- [ ] With `org:manage_hiring_settings` — can read and update the per-org cool-off period (`cool_off_days`, integer, 0–365; default 90).
- [ ] All write actions are recorded in the regional `audit_logs` table under `org.*` event types.
- [ ] Cannot view the candidate's full connection graph; cannot contact endorsers, referrers, or references except through the platform's structured request flow.
- [ ] Cannot see which colleagues the candidate asked who declined — only written endorsements appear.

#### Watcher (org user)

- [ ] Up to 25 watchers per opening (enforced at add time; 422 `watcher_cap_reached`).
- [ ] Receives notifications when: application is shortlisted/rejected on the opening, interview is scheduled/rescheduled/cancelled, offer is extended, application is withdrawn by the candidate.
- [ ] Watchers added/removed by anyone with `org:manage_openings`.

#### Reference (hub user nominated by candidate)

- [ ] Receives notification with the candidate's handle, the opening title and company domain, the questionnaire preview, and the relationship context derived from shared stints.
- [ ] Can accept and respond, or decline. Declining sends no notification to the candidate.
- [ ] If accepts: must answer every required question in the structured questionnaire to submit. Once submitted, response is final (no edit).
- [ ] If accepts but does not submit by the request's `response_deadline`, the nomination auto-expires.
- [ ] Can see only own response, never other references' responses, never the org's notes, never the candidate's other materials.
- [ ] The **candidate** never sees reference responses — responses are visible only to the hiring team (per `connection-enhanced-hiring.md` §7 "P3's responses are attached to the application and visible only to the hiring team").

#### Privacy and consent invariants (must be true everywhere)

- [ ] No notification, audit log, or read endpoint ever surfaces to the candidate's current employer (`active` stint domain) that the candidate has applied elsewhere. Verified work history showing the current employer is allowed (it is already public on the candidate's profile).
- [ ] The endpoint that returns "N colleagues at this company" returns only a count to non-clicking callers; the colleague-list endpoint requires an explicit second call.
- [ ] An org user cannot read endorsements that the candidate has hidden via `remove-endorsement-from-application`.
- [ ] An org user cannot read the candidate's connections list under any endpoint.
- [ ] An endorser cannot see other endorsers on the same application.

#### System invariants

- [ ] All hiring data (applications, candidacies, interviews, offers, endorsements, referrals, references) lives in the **opening's home region** (the regional DB of the hiring org).
- [ ] A global index table `applications_index` (global DB) maps `hub_user_global_id` + `applied_at` to `(region, application_id)` so that a hub user's "my applications" list does a bounded global lookup followed by one query per region (max 3 regions today).
- [ ] Cross-region writes follow ADR-001 §7: write to opening's region first, then write index row to global DB inside a compensating transaction on failure.
- [ ] All list endpoints use keyset pagination — no `OFFSET`.
- [ ] Every write handler writes an audit log row inside the same transaction.

### User-Facing Screens

Notation: each screen is reachable in the portal indicated; routes follow the existing pattern (see CLAUDE.md UI Route Structure).

#### Hub portal

**Screen: Browse Openings**

Portal: hub-ui | Route: `/openings`

```html
<header>
	<input type="search" placeholder="Search role / company" />
	<select id="employment_type">
		…
	</select>
	<select id="work_location_type">
		…
	</select>
	<input id="filter_country" />
	<input id="filter_min_yoe" type="number" />
	<input id="filter_tags" placeholder="Tags" />
	<input id="filter_only_with_colleagues" type="checkbox" />
</header>
<table>
	<Column title="Role" />
	<Column title="Company" />
	<Column title="Location" />
	<Column title="Type" />
	<Column title="Colleagues here">e.g. "3"</Column>
	<Column title="Posted" />
</table>
```

**Screen: Opening Detail**

Portal: hub-ui | Route: `/openings/:orgDomain/:openingNumber`

```html
<section class="header">
	<h1>Senior Platform Engineer</h1>
	<div class="company">acme.com — Bangalore, India · Hybrid · Full-time</div>
	<span class="badge">3 of your colleagues work here</span>
	<button id="view_colleagues">View colleagues</button>
	<button id="apply_now" type="primary">Apply</button>
</section>
<section class="description">…rendered markdown…</section>
<section class="meta">
	<div>Minimum YoE: 7</div>
	<div>Education: Bachelor or higher</div>
	<div>Salary: ₹40L–₹70L</div>
	<div>Tags: distributed-systems, golang</div>
</section>
```

**Screen: Colleagues at Company (modal/sub-page)**

Triggered by: "View colleagues" button on the opening detail page

```html
<table>
	<Column title="Handle" />
	<Column title="Name" />
	<Column title="Worked together at">e.g. "globex.com 2019–2023"</Column>
	<Column title="Currently here since" />
</table>
```

**Screen: Apply for Opening**

Portal: hub-ui | Route: `/openings/:orgDomain/:openingNumber/apply`

```html
<form enctype="multipart/form-data">
	<input type="hidden" name="org_domain" />
	<input type="hidden" name="opening_number" />

	<label>Cover letter (required, 100–5000 chars)</label>
	<textarea
		name="cover_letter"
		minlength="100"
		maxlength="5000"
		required
	></textarea>

	<label>Resume (required, PDF or DOCX, ≤5 MB)</label>
	<input type="file" name="resume" accept=".pdf,.docx" required />

	<label>Request endorsements from colleagues (optional)</label>
	<MultiSelect
		name="endorser_handles"
		source="my_connections"
		render="{handle} — {shared_domain} {start}–{end} ({years}y)"
	/>
	<textarea name="endorsement_request_note" maxlength="500"></textarea>

	<label>
		<input type="checkbox" name="notify_colleagues_at_target" value="true" />
		Let my connections currently at this company know I applied (default off)
	</label>

	<button type="submit">Submit application</button>
</form>
```

**Screen: My Applications**

Portal: hub-ui | Route: `/my-applications`

```html
<table>
	<Column title="Role" />
	<Column title="Company" />
	<Column title="State"
		>applied | shortlisted | rejected | withdrawn | expired</Column
	>
	<Column title="Applied" />
	<Column title="Endorsements">e.g. "2"</Column>
	<Column title="Actions">View | Withdraw (if applied)</Column>
</table>
```

**Screen: My Application Detail**

Portal: hub-ui | Route: `/my-applications/:applicationId`

```html
<section class="summary">
	<h1>Senior Platform Engineer · acme.com</h1>
	<div class="state">Shortlisted</div>
	<div class="ai_score">AI score: 0.82 (informational)</div>
</section>
<section class="cover_letter">…</section>
<section class="endorsements">
	<h2>Endorsements</h2>
	<EndorsementCard handle="p1" status="written" hidden="false" />
	<EndorsementCard handle="p4" status="requested" />
	<button id="add_endorsers" disabled="if-not-applied">Request more</button>
</section>
<section class="candidacy" if="state === 'shortlisted'">
	<Link to="/my-candidacies/{candidacyId}">Open candidacy</Link>
</section>
```

**Screen: My Candidacies + Detail**

Portal: hub-ui | Route: `/my-candidacies`, `/my-candidacies/:candidacyId`

```html
<table>
	<Column title="Role" />
	<Column title="Company" />
	<Column title="State">interviewing | offered | terminal</Column>
	<Column title="Last activity" />
	<Column title="Actions">View</Column>
</table>
```

Detail page sections: header, scheduled interviews list with RSVP buttons, comment thread (input disabled in terminal states), offer panel (visible iff state == `offered`).

**Screen: Interview RSVP**

Portal: hub-ui | Route: `/my-candidacies/:candidacyId/interviews/:interviewId`

```html
<section>
	<h2>Video interview — 2026-06-04 14:00 IST → 15:00 IST</h2>
	<p>Description: 60-minute technical screening.</p>
	<p>Interviewers: 2 (RSVP: 1 yes, 1 pending)</p>
	<form>
		<button name="rsvp" value="yes">Will attend</button>
		<button name="rsvp" value="no">Cannot attend</button>
	</form>
</section>
```

**Screen: Endorsement Requests Inbox**

Portal: hub-ui | Route: `/endorsement-requests`

```html
<table>
	<Column title="Colleague" />
	<Column title="Role" />
	<Column title="Company" />
	<Column title="Asked" />
	<Column title="State">pending | written | declined</Column>
	<Column title="Actions">Write | Decline | Edit</Column>
</table>
```

**Screen: Write Endorsement**

Portal: hub-ui | Route: `/endorsement-requests/:requestId/write`

```html
<section class="context">
	<h2>Endorse P2 for Senior Platform Engineer at acme.com</h2>
	<p>You worked together at globex.com from 2019 to 2023 (4 years).</p>
	<p>P2's note: "Anything you can say about distributed systems would help."</p>
</section>
<form>
	<label>Endorsement (100–2000 chars)</label>
	<textarea
		id="endorsement_text"
		minlength="100"
		maxlength="2000"
		required
	></textarea>
	<button type="submit">Submit endorsement</button>
	<button type="button" id="decline">Decline silently</button>
</form>
```

**Screen: Referral Nomination (referrer side)**

Portal: hub-ui | Route: `/my-employer/:orgDomain/openings/:openingNumber/refer`

```html
<form>
	<label>Choose colleague to nominate</label>
	<select source="my_connections" />
	<label>Why are they a fit? (100–2000 chars)</label>
	<textarea minlength="100" maxlength="2000" required></textarea>
	<button type="submit">Send nomination</button>
</form>
```

**Screen: Referral Inbox (candidate side)**

Portal: hub-ui | Route: `/referrals`

```html
<table>
	<Column title="Referrer" />
	<Column title="Role" />
	<Column title="Company" />
	<Column title="Worked together" />
	<Column title="Received" />
	<Column title="Actions">View | Accept & Apply | Decline</Column>
</table>
```

**Screen: Network Opportunities Tile (dashboard)**

Portal: hub-ui | Route: `/` (dashboard)

```html
<Card title="Opportunities through your network">
	<List>
		<Item>
			<strong>acme.com</strong>: 2 open roles · your colleague @p1 (globex.com,
			2019–2023) works here
		</Item>
	</List>
</Card>
```

**Screen: Reference Request Inbox**

Portal: hub-ui | Route: `/reference-requests`

Two roles use this surface — candidate (nominate), nominee (respond):

```html
<section class="for_candidate">
	<h2>Reference requests asking you to nominate</h2>
	<table>
		columns: company, role, max references, deadline, Actions: Nominate
	</table>
</section>
<section class="for_nominee">
	<h2>You have been nominated as a reference</h2>
	<table>
		columns: candidate, company, role, Actions: Accept & Respond | Decline
	</table>
</section>
```

**Screen: Reference Response Form**

Portal: hub-ui | Route: `/reference-requests/:nominationId/respond`

Rendered from the questionnaire defined by the requester; each item is a textarea with min/max chars set by the org.

#### Org portal

**Screen: Opening Applications**

Portal: org-ui | Route: `/openings/:openingId/applications`

```html
<header>
	<select id="filter_state">
		all | applied | shortlisted | rejected | withdrawn | expired
	</select>
	<select id="filter_label">
		any | green | yellow | red | none
	</select>
	<input id="filter_has_endorsements" type="checkbox" />
	<input id="filter_has_referral" type="checkbox" />
</header>
<table>
	<Column title="Candidate" />
	<Column title="Verified employers" />
	<Column title="YoE" />
	<Column title="Endorsements">e.g. "3 ✚ 1 referral"</Column>
	<Column title="AI score" />
	<Column title="State" />
	<Column title="Label" />
	<Column title="Applied" />
	<Column title="Actions">View</Column>
</table>
```

**Screen: Application Detail (org reviewer)**

Portal: org-ui | Route: `/openings/:openingId/applications/:applicationId`

```html
<section class="candidate_header">
	<h1>@p2 — Priya Iyer</h1>
	<div class="verified_work_history">
		<EmployerStint domain="globex.com" years="2019–2023" />
		<EmployerStint domain="initech.com" years="2017–2019" />
	</div>
</section>
<section class="application_meta">
	<span>State: Applied</span>
	<select id="label">
		— | Green | Yellow | Red
	</select>
	<span>AI score: 0.82</span>
	<button id="shortlist">Shortlist</button>
	<button id="reject">Reject</button>
</section>
<section class="cover_letter">…</section>
<section class="resume"><a href="…">Download resume.pdf</a></section>
<section class="endorsements">
	<h2>Colleague endorsements (3 written, 1 referral)</h2>
	<EndorsementCard
		handle="p1"
		display_name="P1"
		shared_domain="globex.com"
		years="2019–2023 (4y)"
		volunteered="false"
		connection_status="connected"
		hidden="false"
		text="…"
	/>
	<EndorsementCard handle="p3" disconnected="true" />
	<!-- "no longer connected" badge -->
	<EndorsementCard handle="p5" volunteered="true" />
	<EndorsementCard handle="p9" referral="true" current_employee="true" />
</section>
```

**Screen: Candidacy Detail**

Portal: org-ui | Route: `/candidacies/:candidacyId`

Sections: candidacy header (state badges), interview list with Schedule button, comment thread (visible to both sides), offer panel (Extend Offer button when state is `interviewing`), references panel (Request References button + responses).

**Screen: Schedule Interview**

Portal: org-ui | Route: `/candidacies/:candidacyId/schedule-interview`

```html
<form>
	<label>Type</label>
	<select>
		in_person | video | take_home | other
	</select>
	<label>Start (ISO datetime)</label><input type="datetime-local" required />
	<label>End (ISO datetime)</label><input type="datetime-local" required />
	<label>Description (max 2000)</label><textarea maxlength="2000"></textarea>
	<label>Interviewers (1–5, active org users)</label>
	<MultiSelect source="active_org_users" min="1" max="5" />
	<button type="submit">Schedule</button>
</form>
```

**Screen: Submit Interview Feedback**

Portal: org-ui | Route: `/interviews/:interviewId/feedback`

```html
<form>
	<label>Decision</label>
	<select>
		strong_yes | yes | neutral | no | strong_no
	</select>
	<label>Positives (max 4000)</label><textarea maxlength="4000"></textarea>
	<label>Negatives (max 4000)</label><textarea maxlength="4000"></textarea>
	<label>Overall assessment (max 4000)</label
	><textarea maxlength="4000"></textarea>
	<label
		>Optional feedback for the candidate (max 2000, becomes visible to candidate
		after offer or rejection)</label
	>
	<textarea maxlength="2000"></textarea>
	<button type="submit">Submit and complete interview</button>
</form>
```

**Screen: Extend Offer**

Portal: org-ui | Route: `/candidacies/:candidacyId/extend-offer`

```html
<form>
	<label>Offer letter URL (S3 key, PDF only, ≤10MB)</label>
	<input type="file" accept=".pdf" required />
	<label>Salary (currency + amount)</label>
	<input id="currency" maxlength="3" /><input id="amount" type="number" />
	<label>Start date</label><input type="date" required />
	<label>Notes (max 4000)</label><textarea maxlength="4000"></textarea>
	<button type="submit">Extend offer</button>
</form>
```

**Screen: Hiring Settings**

Portal: org-ui | Route: `/settings/hiring`

```html
<form>
	<label>Cool-off period in days (0–365, 0 disables)</label>
	<input type="number" min="0" max="365" />
	<button type="submit">Save</button>
</form>
```

**Screen: Reference Request**

Portal: org-ui | Route: `/candidacies/:candidacyId/request-references`

```html
<form>
	<label>Max references to nominate</label
	><input type="number" min="1" max="5" />
	<label>Questions (1–10 items, each 10–500 chars)</label>
	<QuestionList />
	<label>Response deadline</label><input type="date" required />
	<button type="submit">Send to candidate</button>
</form>
```

### API Surface

| Endpoint                                       | Portal | Caller      | Intent                                                                                                                      |
| ---------------------------------------------- | ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /hub/list-openings`                      | hub    | hub user    | Browse openings; embeds colleague-count per opening                                                                         |
| `POST /hub/get-opening`                        | hub    | hub user    | Opening detail incl. colleague count and per-domain stints overlap                                                          |
| `POST /hub/list-colleagues-at-employer`        | hub    | hub user    | Reveal colleague handles for a given org domain (explicit click)                                                            |
| `POST /hub/list-network-opportunities`         | hub    | hub user    | Passive discovery feed                                                                                                      |
| `POST /hub/apply-for-opening`                  | hub    | hub user    | Submit an application (**multipart/form-data**: cover_letter, resume file, endorser_handles[], notify_colleagues_at_target) |
| `POST /hub/withdraw-application`               | hub    | hub user    | Withdraw while `applied`                                                                                                    |
| `POST /hub/list-my-applications`               | hub    | hub user    | List own applications across regions                                                                                        |
| `POST /hub/get-my-application`                 | hub    | hub user    | Detail (includes endorsements)                                                                                              |
| `POST /hub/request-endorsements`               | hub    | hub user    | Send endorsement requests for an application                                                                                |
| `POST /hub/list-endorsement-requests-incoming` | hub    | hub user    | Endorsement requests I received                                                                                             |
| `POST /hub/list-endorsement-requests-outgoing` | hub    | hub user    | Endorsement requests I sent                                                                                                 |
| `POST /hub/write-endorsement`                  | hub    | hub user    | Write/respond to a request OR write unsolicited (if candidate opted in)                                                     |
| `POST /hub/update-endorsement`                 | hub    | hub user    | Edit own endorsement while application is `applied`                                                                         |
| `POST /hub/decline-endorsement-request`        | hub    | hub user    | Decline silently                                                                                                            |
| `POST /hub/hide-endorsement-on-application`    | hub    | hub user    | Candidate hides one of their own endorsements                                                                               |
| `POST /hub/show-endorsement-on-application`    | hub    | hub user    | Re-show a hidden endorsement (only while `applied`)                                                                         |
| `POST /hub/nominate-colleague-for-role`        | hub    | hub user    | Current-employee referral                                                                                                   |
| `POST /hub/list-referrals-received`            | hub    | hub user    | Candidate's referral inbox                                                                                                  |
| `POST /hub/list-referrals-made`                | hub    | hub user    | Referrer's history                                                                                                          |
| `POST /hub/accept-referral`                    | hub    | hub user    | Accept (does not submit; navigates to apply form with statement prefilled)                                                  |
| `POST /hub/decline-referral`                   | hub    | hub user    | Decline silently                                                                                                            |
| `POST /hub/list-my-candidacies`                | hub    | hub user    | Active candidacies                                                                                                          |
| `POST /hub/get-my-candidacy`                   | hub    | hub user    | Candidacy detail                                                                                                            |
| `POST /hub/add-candidacy-comment`              | hub    | hub user    | Comment on candidacy                                                                                                        |
| `POST /hub/rsvp-interview`                     | hub    | hub user    | Candidate RSVP                                                                                                              |
| `POST /hub/list-reference-requests-incoming`   | hub    | hub user    | Both 'asking me to nominate' and 'I was nominated' lists (paginated, typed)                                                 |
| `POST /hub/nominate-references`                | hub    | hub user    | Candidate nominates                                                                                                         |
| `POST /hub/accept-reference-nomination`        | hub    | hub user    | Nominee accepts                                                                                                             |
| `POST /hub/decline-reference-nomination`       | hub    | hub user    | Nominee declines silently                                                                                                   |
| `POST /hub/submit-reference-response`          | hub    | hub user    | Submit structured answers                                                                                                   |
| `POST /hub/set-notify-connections-on-apply`    | hub    | hub user    | Global preference toggle                                                                                                    |
| `POST /hub/set-allow-unsolicited-endorsements` | hub    | hub user    | Global preference toggle                                                                                                    |
| `POST /org/list-applications`                  | org    | org user    | For a given opening                                                                                                         |
| `POST /org/get-application`                    | org    | org user    | Detail incl. endorsements, work history                                                                                     |
| `POST /org/shortlist-application`              | org    | org user    | Applied → shortlisted; creates candidacy                                                                                    |
| `POST /org/reject-application`                 | org    | org user    | Applied → rejected                                                                                                          |
| `POST /org/label-application`                  | org    | org user    | Set/clear Green/Yellow/Red while `applied`                                                                                  |
| `POST /org/list-candidacies`                   | org    | org user    | Across openings of own org                                                                                                  |
| `POST /org/get-candidacy`                      | org    | org user    | Full detail                                                                                                                 |
| `POST /org/add-candidacy-comment`              | org    | org user    | Comment thread                                                                                                              |
| `POST /org/schedule-interview`                 | org    | org user    | Create interview                                                                                                            |
| `POST /org/update-interview`                   | org    | org user    | Reschedule / edit description before completion                                                                             |
| `POST /org/cancel-interview`                   | org    | org user    | Cancel while scheduled                                                                                                      |
| `POST /org/add-interviewer`                    | org    | org user    | Add up to 5 total                                                                                                           |
| `POST /org/remove-interviewer`                 | org    | org user    | Remove                                                                                                                      |
| `POST /org/list-interviews`                    | org    | org user    | For a candidacy or by date range                                                                                            |
| `POST /org/get-interview`                      | org    | org user    | Detail incl. feedback (only after submitted)                                                                                |
| `POST /org/rsvp-interview`                     | org    | org user    | Interviewer RSVP                                                                                                            |
| `POST /org/submit-interview-feedback`          | org    | interviewer | Submit assessment; transitions interview to `completed`                                                                     |
| `POST /org/extend-offer`                       | org    | org user    | Candidacy → `offered`; cancels scheduled interviews                                                                         |
| `POST /org/request-references`                 | org    | org user    | Open a reference request on a candidacy                                                                                     |
| `POST /org/list-reference-nominations`         | org    | org user    | See who candidate nominated and their state                                                                                 |
| `POST /org/list-reference-responses`           | org    | org user    | Read submitted responses                                                                                                    |
| `POST /org/get-hiring-settings`                | org    | org user    | Read cool-off period                                                                                                        |
| `POST /org/update-hiring-settings`             | org    | org user    | Write cool-off period                                                                                                       |
| `POST /org/add-watcher`                        | org    | org user    | Up to 25 per opening                                                                                                        |
| `POST /org/remove-watcher`                     | org    | org user    | Remove a watcher                                                                                                            |

---

## Stage 2: Implementation Plan

Status: **READY**
Authors: @psankar

### API Contract

All types in `specs/typespec/hub/applications.tsp`, `specs/typespec/hub/endorsements.tsp`, `specs/typespec/hub/referrals.tsp`, `specs/typespec/hub/references.tsp`, `specs/typespec/hub/hiring-discovery.tsp`, `specs/typespec/org/applications.tsp`, `specs/typespec/org/candidacies.tsp`, `specs/typespec/org/interviews.tsp`, `specs/typespec/org/offers.tsp`, `specs/typespec/org/references.tsp`, `specs/typespec/org/hiring-settings.tsp`. Matching `.ts` and `.go` files mirror each.

Below are the **canonical models** — these are reproduced verbatim in TypeSpec.

```typespec
// specs/typespec/hub/applications.tsp

union ApplicationState {
  Applied:     "applied",
  Shortlisted: "shortlisted",
  Rejected:    "rejected",
  Withdrawn:   "withdrawn",
  Expired:     "expired",
}

union ApplicationColorLabel {
  Green:  "green",
  Yellow: "yellow",
  Red:    "red",
}

model ApplyForOpeningRequest {
  org_domain:                     string;
  opening_number:                 int32;
  cover_letter:                   string;     // 100..5000
  resume_upload_id:               string;     // pre-signed upload completed
  endorser_handles?:              Handle[];   // 0..10; each must be a connected hub user
  endorsement_request_note?:      string;     // 0..500
  notify_colleagues_at_target?:   boolean;    // per-application override
}

model ApplyForOpeningResponse {
  application_id: string;
}

model HubApplication {
  application_id:        string;
  org_domain:            string;
  opening_number:        int32;
  opening_title:         string;
  state:                 ApplicationState;
  label?:                ApplicationColorLabel;
  ai_score?:             decimal;
  applied_at:            utcDateTime;
  state_changed_at:      utcDateTime;
  cover_letter:          string;
  resume_download_url:   string;             // signed, short TTL
  endorsements:          MyEndorsementOnApplication[];
  endorsement_requests:  MyEndorsementRequestSent[];
  notify_colleagues_at_target: boolean;
}

model MyEndorsementOnApplication {
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  is_referral:           boolean;
  is_unsolicited:        boolean;
  text:                  string;
  hidden_by_candidate:   boolean;
  written_at:            utcDateTime;
  edited_at?:            utcDateTime;
}

model ListMyApplicationsRequest {
  filter_state?:    ApplicationState[];
  pagination_key?:  string;     // composite "{applied_at_iso}|{application_id}"
  limit?:           int32;      // default 20, max 100
}

model ListMyApplicationsResponse {
  applications:         HubApplicationSummary[];
  next_pagination_key?: string;
}

// ... (full TypeSpec set lives in the .tsp files; same pattern repeats for endorsements,
// referrals, candidacies, interviews, offers, references, hiring settings, discovery)
```

The hub-side opening response is extended with these viewer-aware fields:

```typespec
model HubOpeningDetail extends Opening {
  // viewer-aware fields, computed per request
  colleague_count_here:    int32;     // count of viewer's connections with active stint at any of org's domains
  viewer_can_refer:        boolean;   // viewer has an active stint at any of org's domains
  viewer_has_applied:      boolean;   // any application by viewer to this opening exists, any state
}
```

```typespec
// specs/typespec/org/applications.tsp (key models)

model ListApplicationsRequest {
  opening_id:                string;
  filter_state?:             ApplicationState[];
  filter_label?:             ApplicationColorLabel[];
  filter_has_endorsements?:  boolean;
  filter_has_referral?:      boolean;
  pagination_key?:           string;
  limit?:                    int32;
}

model OrgApplication {
  application_id:        string;
  candidate_handle:      Handle;
  candidate_display_name: string;
  candidate_short_bio?:  string;
  candidate_employer_stints: PublicEmployerStint[];   // imported from hub/work-emails.tsp
  cover_letter:          string;
  resume_download_url:   string;
  ai_score?:             decimal;
  state:                 ApplicationState;
  label?:                ApplicationColorLabel;
  applied_at:            utcDateTime;
  endorsements:          OrgVisibleEndorsement[];     // hidden-by-candidate are excluded
  notify_colleagues_used: boolean;                    // did candidate opt-in
}

model OrgVisibleEndorsement {
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  current_connection_state: ConnectionState;          // "connected" | "they_disconnected" | ...
  is_referral:           boolean;
  is_unsolicited:        boolean;
  endorser_is_current_employee: boolean;              // active stint at hiring org
  text:                  string;
  written_at:            utcDateTime;
  edited_at?:            utcDateTime;
}

model ShortlistApplicationRequest { application_id: string; }
model RejectApplicationRequest    { application_id: string; rejection_reason?: string; /* 0..2000, never shown to candidate as freeform — used internally */ }
model LabelApplicationRequest     { application_id: string; label?: ApplicationColorLabel; }

@route("/org/list-applications")          @post listApplications(...ListApplicationsRequest):    OkResponse<ListApplicationsResponse> | BadRequestResponse;
@route("/org/get-application")            @post getApplication  (...ApplicationIdRequest):       OkResponse<OrgApplication> | NotFoundResponse;
@route("/org/shortlist-application")      @post shortlistApp    (...ShortlistApplicationRequest): OkResponse<OrgCandidacy>  | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/reject-application")         @post rejectApp       (...RejectApplicationRequest):    OkResponse<{}>            | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/label-application")          @post labelApp        (...LabelApplicationRequest):     OkResponse<{}>            | NotFoundResponse | UnprocessableEntityResponse;
```

The full TypeSpec set is generated in this spec's PR. The remaining surface (interviews, offers, references, referrals, endorsements, candidacies) follows the same modeling pattern. Confirm endpoint list with the team before generating `.ts` and `.go` mirrors.

### Database Schema

All changes go into the existing initial schema files (no new migration files):

- `api-server/db/migrations/global/00000000000001_initial_schema.sql`
- `api-server/db/migrations/regional/00000000000001_initial_schema.sql`

#### Global DB (cross-region indexes only)

```sql
-- Global routing index so a hub user can list applications across regions in one global query
-- followed by at most N regional fetches (N = number of regions, currently 3).
CREATE TABLE applications_index (
    application_id         UUID PRIMARY KEY,
    hub_user_global_id     UUID NOT NULL,
    region                 TEXT NOT NULL,       -- 'ind1' | 'usa1' | 'deu1'
    org_id                 UUID NOT NULL,       -- denormalized so list-my-applications can group by company
    org_domain             TEXT NOT NULL,
    opening_number         INT  NOT NULL,
    applied_at             TIMESTAMPTZ NOT NULL,
    state                  TEXT NOT NULL,       -- denormalized for filter; updated by compensating write
    UNIQUE (hub_user_global_id, applied_at, application_id)
);
CREATE INDEX applications_index_by_user ON applications_index (hub_user_global_id, applied_at DESC, application_id DESC);

-- Endorsement requests index — needed so an endorser (whose home region may differ from
-- the application's region) can list their incoming requests with bounded fan-out.
CREATE TABLE endorsement_requests_index (
    request_id         UUID PRIMARY KEY,
    endorser_hub_user_global_id  UUID NOT NULL,
    region             TEXT NOT NULL,
    application_id     UUID NOT NULL,
    state              TEXT NOT NULL,            -- pending | written | declined | expired
    requested_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX endorsement_requests_by_endorser
    ON endorsement_requests_index (endorser_hub_user_global_id, requested_at DESC, request_id DESC);

-- Referral nominations index
CREATE TABLE referral_nominations_index (
    nomination_id      UUID PRIMARY KEY,
    candidate_hub_user_global_id UUID NOT NULL,
    referrer_hub_user_global_id  UUID NOT NULL,
    region             TEXT NOT NULL,
    opening_id         UUID NOT NULL,
    state              TEXT NOT NULL,            -- pending | accepted_applied | declined | expired
    created_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX referral_nominations_by_candidate
    ON referral_nominations_index (candidate_hub_user_global_id, created_at DESC, nomination_id DESC);
CREATE INDEX referral_nominations_by_referrer
    ON referral_nominations_index (referrer_hub_user_global_id, created_at DESC, nomination_id DESC);

-- Reference nominations index (for a nominee whose home region differs from the opening's)
CREATE TABLE reference_nominations_index (
    nomination_id      UUID PRIMARY KEY,
    nominee_hub_user_global_id UUID NOT NULL,
    region             TEXT NOT NULL,
    candidacy_id       UUID NOT NULL,
    state              TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX reference_nominations_by_nominee
    ON reference_nominations_index (nominee_hub_user_global_id, created_at DESC, nomination_id DESC);
```

#### Regional DB (authoritative data — every table below lives in opening's region)

```sql
CREATE TABLE org_hiring_settings (
    org_id          UUID PRIMARY KEY,
    cool_off_days   INT NOT NULL DEFAULT 90 CHECK (cool_off_days >= 0 AND cool_off_days <= 365),
    allow_unsolicited_endorsements_default BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID
);

CREATE TABLE applications (
    application_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                 UUID NOT NULL,
    opening_id             UUID NOT NULL,
    opening_number         INT  NOT NULL,
    applicant_hub_user_global_id UUID NOT NULL,
    applicant_handle_snapshot    TEXT NOT NULL,   -- captured at apply for stable display
    applicant_display_name_snapshot TEXT NOT NULL,
    cover_letter           TEXT NOT NULL,
    resume_s3_key          TEXT NOT NULL,
    ai_score               NUMERIC(5,4),
    state                  TEXT NOT NULL DEFAULT 'applied'
                            CHECK (state IN ('applied','shortlisted','rejected','withdrawn','expired')),
    label                  TEXT CHECK (label IN ('green','yellow','red')),
    notify_colleagues_at_target BOOLEAN NOT NULL DEFAULT FALSE,
    rejection_reason       TEXT,
    applied_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state_changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- one live application per (org, candidate) — enforced by partial unique:
    UNIQUE (org_id, applicant_hub_user_global_id, opening_id)
);
CREATE UNIQUE INDEX applications_one_live_per_org
    ON applications (org_id, applicant_hub_user_global_id)
    WHERE state IN ('applied','shortlisted');

CREATE TABLE candidacies (
    candidacy_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id         UUID NOT NULL UNIQUE,
    org_id                 UUID NOT NULL,
    opening_id             UUID NOT NULL,
    applicant_hub_user_global_id UUID NOT NULL,
    state                  TEXT NOT NULL DEFAULT 'interviewing'
                            CHECK (state IN ('interviewing','offered','offer_accepted','offer_declined','candidate_unsuitable','candidate_not_responding','employer_defunct')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state_changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE candidacy_comments (
    comment_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidacy_id         UUID NOT NULL,
    author_org_user_id   UUID,
    author_hub_user_global_id UUID,
    is_system            BOOLEAN NOT NULL DEFAULT FALSE,
    body                 TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((author_org_user_id IS NOT NULL) <> (author_hub_user_global_id IS NOT NULL) OR is_system)
);
CREATE INDEX candidacy_comments_by_candidacy ON candidacy_comments (candidacy_id, created_at);

CREATE TABLE interviews (
    interview_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidacy_id   UUID NOT NULL,
    interview_type TEXT NOT NULL CHECK (interview_type IN ('in_person','video','take_home','other')),
    starts_at      TIMESTAMPTZ NOT NULL,
    ends_at        TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
    description    TEXT,
    state          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (state IN ('scheduled','completed','cancelled')),
    candidate_rsvp TEXT CHECK (candidate_rsvp IN ('yes','no')),
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interviews_by_candidacy ON interviews (candidacy_id, starts_at);

CREATE TABLE interview_interviewers (
    interview_id      UUID NOT NULL,
    org_user_id       UUID NOT NULL,
    rsvp              TEXT CHECK (rsvp IN ('yes','no')),
    added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (interview_id, org_user_id)
);

CREATE TABLE interview_feedback (
    interview_id       UUID NOT NULL,
    interviewer_org_user_id UUID NOT NULL,
    decision           TEXT NOT NULL CHECK (decision IN ('strong_yes','yes','neutral','no','strong_no')),
    positives          TEXT NOT NULL CHECK (length(positives) BETWEEN 1 AND 4000),
    negatives          TEXT NOT NULL CHECK (length(negatives) BETWEEN 1 AND 4000),
    overall_assessment TEXT NOT NULL CHECK (length(overall_assessment) BETWEEN 1 AND 4000),
    candidate_feedback TEXT CHECK (candidate_feedback IS NULL OR length(candidate_feedback) <= 2000),
    submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (interview_id, interviewer_org_user_id)
);

CREATE TABLE offers (
    candidacy_id       UUID PRIMARY KEY,
    offer_letter_s3_key TEXT NOT NULL,
    salary_currency    TEXT,
    salary_amount      NUMERIC,
    start_date         DATE,
    notes              TEXT,
    extended_by_org_user_id UUID NOT NULL,
    extended_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Endorsement requests: who candidate asked. Lifecycle: pending -> (written | declined | expired).
CREATE TABLE endorsement_requests (
    request_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id      UUID NOT NULL,
    endorser_hub_user_global_id UUID NOT NULL,
    note                TEXT CHECK (note IS NULL OR length(note) <= 500),
    state               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending','written','declined','expired')),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    UNIQUE (application_id, endorser_hub_user_global_id)
);

CREATE TABLE endorsements (
    endorsement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id      UUID NOT NULL,
    endorser_hub_user_global_id UUID NOT NULL,
    request_id          UUID UNIQUE,     -- NULL for unsolicited / referral-generated
    is_referral         BOOLEAN NOT NULL DEFAULT FALSE,
    referral_id         UUID,            -- references referral_nominations.nomination_id if is_referral
    shared_domain       TEXT NOT NULL,   -- snapshotted at write time
    overlap_start_year  INT  NOT NULL,
    overlap_end_year    INT  NOT NULL,
    text                TEXT NOT NULL CHECK (length(text) BETWEEN 100 AND 2000),
    hidden_by_candidate BOOLEAN NOT NULL DEFAULT FALSE,
    written_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at           TIMESTAMPTZ,
    UNIQUE (application_id, endorser_hub_user_global_id)
);

CREATE TABLE referral_nominations (
    nomination_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_hub_user_global_id UUID NOT NULL,
    candidate_hub_user_global_id UUID NOT NULL,
    opening_id          UUID NOT NULL,
    org_id              UUID NOT NULL,
    statement_text      TEXT NOT NULL CHECK (length(statement_text) BETWEEN 100 AND 2000),
    shared_domain       TEXT NOT NULL,
    overlap_start_year  INT  NOT NULL,
    overlap_end_year    INT  NOT NULL,
    state               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending','accepted_applied','declined','expired')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    UNIQUE (referrer_hub_user_global_id, candidate_hub_user_global_id, opening_id)
);

CREATE TABLE reference_requests (
    request_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidacy_id         UUID NOT NULL,
    requested_by_org_user_id UUID NOT NULL,
    max_references       INT  NOT NULL CHECK (max_references BETWEEN 1 AND 5),
    response_deadline    DATE NOT NULL,
    questions            JSONB NOT NULL,  -- [{id, text, min_chars, max_chars, required}]
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reference_nominations (
    nomination_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id           UUID NOT NULL,
    nominee_hub_user_global_id UUID NOT NULL,
    shared_domain        TEXT NOT NULL,
    overlap_start_year   INT  NOT NULL,
    overlap_end_year     INT  NOT NULL,
    state                TEXT NOT NULL DEFAULT 'nominated'
                           CHECK (state IN ('nominated','accepted','declined','submitted','expired')),
    nominated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at         TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ NOT NULL,   -- set to reference_requests.response_deadline at NOW() midnight UTC
    UNIQUE (request_id, nominee_hub_user_global_id)
);

CREATE TABLE reference_responses (
    response_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nomination_id        UUID NOT NULL,
    question_id          TEXT NOT NULL,
    response_text        TEXT NOT NULL,
    UNIQUE (nomination_id, question_id)
);

CREATE TABLE hub_apply_preferences (
    hub_user_global_id           UUID PRIMARY KEY,
    notify_connections_on_apply  BOOLEAN NOT NULL DEFAULT FALSE,
    allow_unsolicited_endorsements BOOLEAN NOT NULL DEFAULT FALSE
);
```

Watchers/hiring-team tables already exist on `openings` (see `org/openings.tsp`). The 25-watcher cap is enforced in the existing handler; no schema change. The hiring-team join already supports the application-detail "is this org user authorised" check; reused here.

#### SQL Queries

New query files under `api-server/db/regional/queries/`:

- `applications.sql` — `CreateApplication`, `GetApplicationByID`, `ListApplicationsForOpening`, `ListMyApplicationsByIDs` (used with global index), `WithdrawApplication`, `ShortlistApplication`, `RejectApplication`, `LabelApplication`, `CountLiveApplicationsAtOrg`, `GetLastShortlistedAtOrg` (for cool-off).
- `candidacies.sql` — `CreateCandidacyFromApplication`, `GetCandidacy`, `ListCandidaciesForOrg`, `ListMyCandidacies` (joins index), `AddCandidacyComment`, `GetCandidacyCommentThread`, `AddSystemComment`.
- `interviews.sql` — `ScheduleInterview` (bulk insert interviewers), `UpdateInterview`, `CancelInterview`, `AddInterviewer`, `RemoveInterviewer`, `SetCandidateRSVP`, `SetInterviewerRSVP`, `SubmitInterviewFeedback`, `GetInterviewWithInterviewers`, `CompleteInterview`, `CancelAllScheduledForCandidacy` (used by extend-offer).
- `offers.sql` — `CreateOffer`, `GetOffer`.
- `endorsements.sql` — `CreateEndorsementRequest`, `ListEndorsementRequestsForApplication`, `ResolveEndorsementRequestWritten`, `ResolveEndorsementRequestDeclined`, `CreateEndorsement`, `UpdateEndorsement`, `HideEndorsement`, `ShowEndorsement`, `ListEndorsementsForApplicationOrgView`, `ListEndorsementsForApplicationHubView`.
- `referrals.sql` — `CreateReferral`, `ResolveReferralAcceptedApplied`, `ResolveReferralDeclined`, `ListReferralsByIDs`, `CheckReferrerHasActiveStintAtOrg`.
- `references.sql` — `CreateReferenceRequest`, `NominateReferences`, `AcceptReferenceNomination`, `DeclineReferenceNomination`, `SubmitReferenceResponses`, `ListReferenceNominationsForRequest`, `ListReferenceResponsesForRequest`.
- `hiring_settings.sql` — `GetOrgHiringSettings`, `UpsertOrgHiringSettings`.
- `discovery.sql` — `CountConnectionsAtDomain`, `ListConnectionsAtDomain` (with overlap stints), `ListNetworkOpportunities` (CTE: each connection's current active stint → distinct domains → published openings of those orgs).

Key non-trivial query: live-application + cool-off compound check, performed in one statement inside the apply transaction:

```sql
-- name: CheckCanApply :one
-- Cool-off window is measured from applied_at of the most recent prior application that
-- reached candidacy (state IN ('shortlisted')). This matches hiring-flow.md verbatim:
-- "cool-off is measured from when their earlier application was submitted".
WITH last_reached_candidacy AS (
  SELECT MAX(applied_at) AS last_applied_at
  FROM applications
  WHERE org_id = $1 AND applicant_hub_user_global_id = $2
    AND application_id IN (SELECT application_id FROM candidacies WHERE org_id = $1 AND applicant_hub_user_global_id = $2)
), live AS (
  SELECT 1
  FROM applications
  WHERE org_id = $1 AND applicant_hub_user_global_id = $2 AND state IN ('applied','shortlisted')
  LIMIT 1
), already AS (
  SELECT 1 FROM applications WHERE opening_id = $3 AND applicant_hub_user_global_id = $2 LIMIT 1
), settings AS (
  SELECT COALESCE(cool_off_days, 90) AS days FROM org_hiring_settings WHERE org_id = $1
)
SELECT
  EXISTS(SELECT 1 FROM live)                       AS has_live,
  EXISTS(SELECT 1 FROM already)                    AS already_applied,
  (SELECT last_applied_at FROM last_reached_candidacy) AS last_prior_applied_at,
  COALESCE((SELECT days FROM settings), 90)        AS cool_off_days;
```

The handler computes the next-allowed-apply timestamp as `last_prior_applied_at + interval cool_off_days days` and returns it in the 422 body so the UI can render an exact date.

### Backend

#### Endpoints (subset; full table mirrors the API surface above)

| Method | Path                                      | Handler file                          | Middleware            | Role required                              |
| ------ | ----------------------------------------- | ------------------------------------- | --------------------- | ------------------------------------------ |
| POST   | `/hub/apply-for-opening`                  | `handlers/hub/applications.go`        | `HubAuth` + `HubRole` | `hub:apply_jobs` (**multipart/form-data**) |
| POST   | `/hub/withdraw-application`               | `handlers/hub/applications.go`        | `HubAuth`             | (owner-only, no role gate)                 |
| POST   | `/hub/list-my-applications`               | `handlers/hub/applications.go`        | `HubAuth`             | (owner-only)                               |
| POST   | `/hub/get-my-application`                 | `handlers/hub/applications.go`        | `HubAuth`             | (owner-only)                               |
| POST   | `/hub/request-endorsements`               | `handlers/hub/endorsements.go`        | `HubAuth`             | (owner-only)                               |
| POST   | `/hub/write-endorsement`                  | `handlers/hub/endorsements.go`        | `HubAuth`             | (connection-only)                          |
| POST   | `/hub/update-endorsement`                 | `handlers/hub/endorsements.go`        | `HubAuth`             | (own-endorsement)                          |
| POST   | `/hub/decline-endorsement-request`        | `handlers/hub/endorsements.go`        | `HubAuth`             | (own-request)                              |
| POST   | `/hub/hide-endorsement-on-application`    | `handlers/hub/endorsements.go`        | `HubAuth`             | (owner-only)                               |
| POST   | `/hub/show-endorsement-on-application`    | `handlers/hub/endorsements.go`        | `HubAuth`             | (owner-only)                               |
| POST   | `/hub/nominate-colleague-for-role`        | `handlers/hub/referrals.go`           | `HubAuth`             | (must have active stint at opening's org)  |
| POST   | `/hub/accept-referral`                    | `handlers/hub/referrals.go`           | `HubAuth`             | (own-referral)                             |
| POST   | `/hub/decline-referral`                   | `handlers/hub/referrals.go`           | `HubAuth`             | (own-referral)                             |
| POST   | `/hub/rsvp-interview`                     | `handlers/hub/interviews.go`          | `HubAuth`             | (own-candidacy)                            |
| POST   | `/hub/add-candidacy-comment`              | `handlers/hub/candidacies.go`         | `HubAuth`             | (own-candidacy)                            |
| POST   | `/hub/nominate-references`                | `handlers/hub/references.go`          | `HubAuth`             | (own-candidacy)                            |
| POST   | `/hub/accept-reference-nomination`        | `handlers/hub/references.go`          | `HubAuth`             | (own-nomination)                           |
| POST   | `/hub/submit-reference-response`          | `handlers/hub/references.go`          | `HubAuth`             | (own-nomination)                           |
| POST   | `/hub/list-openings`                      | `handlers/hub/openings.go`            | `HubAuth` (optional)  | —                                          |
| POST   | `/hub/get-opening`                        | `handlers/hub/openings.go`            | `HubAuth` (optional)  | —                                          |
| POST   | `/hub/list-colleagues-at-employer`        | `handlers/hub/discovery.go`           | `HubAuth`             | —                                          |
| POST   | `/hub/list-network-opportunities`         | `handlers/hub/discovery.go`           | `HubAuth`             | —                                          |
| POST   | `/hub/set-notify-connections-on-apply`    | `handlers/hub/preferences.go`         | `HubAuth`             | —                                          |
| POST   | `/hub/set-allow-unsolicited-endorsements` | `handlers/hub/preferences.go`         | `HubAuth`             | —                                          |
| POST   | `/org/list-applications`                  | `handlers/org/applications.go`        | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/get-application`                    | `handlers/org/applications.go`        | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/shortlist-application`              | `handlers/org/applications.go`        | `OrgAuth` + `OrgRole` | `org:manage_applications`                  |
| POST   | `/org/reject-application`                 | `handlers/org/applications.go`        | `OrgAuth` + `OrgRole` | `org:manage_applications`                  |
| POST   | `/org/label-application`                  | `handlers/org/applications.go`        | `OrgAuth` + `OrgRole` | `org:manage_applications`                  |
| POST   | `/org/list-candidacies`                   | `handlers/org/candidacies.go`         | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/get-candidacy`                      | `handlers/org/candidacies.go`         | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/add-candidacy-comment`              | `handlers/org/candidacies.go`         | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/schedule-interview`                 | `handlers/org/interviews.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/update-interview`                   | `handlers/org/interviews.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/cancel-interview`                   | `handlers/org/interviews.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/add-interviewer`                    | `handlers/org/interviews.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/remove-interviewer`                 | `handlers/org/interviews.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/rsvp-interview`                     | `handlers/org/interviews.go`          | `OrgAuth`             | (must be an interviewer on this row)       |
| POST   | `/org/submit-interview-feedback`          | `handlers/org/interviews.go`          | `OrgAuth`             | (must be an interviewer on this row)       |
| POST   | `/org/extend-offer`                       | `handlers/org/offers.go`              | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/request-references`                 | `handlers/org/references.go`          | `OrgAuth` + `OrgRole` | `org:manage_candidacies`                   |
| POST   | `/org/list-reference-nominations`         | `handlers/org/references.go`          | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/list-reference-responses`           | `handlers/org/references.go`          | `OrgAuth` + `OrgRole` | `org:view_applications`                    |
| POST   | `/org/get-hiring-settings`                | `handlers/org/hiring_settings.go`     | `OrgAuth` + `OrgRole` | `org:view_hiring_settings`                 |
| POST   | `/org/update-hiring-settings`             | `handlers/org/hiring_settings.go`     | `OrgAuth` + `OrgRole` | `org:manage_hiring_settings`               |
| POST   | `/org/add-watcher`                        | `handlers/org/openings.go` (existing) | `OrgAuth` + `OrgRole` | `org:manage_openings` (existing)           |
| POST   | `/org/remove-watcher`                     | `handlers/org/openings.go` (existing) | `OrgAuth` + `OrgRole` | `org:manage_openings` (existing)           |

#### Handler Notes

- All write handlers follow the standard pattern: decode → validate → `WithRegionalTx` (with global compensating tx where needed) → respond.
- The hub `apply-for-opening` and `org/extend-offer` handlers are **multipart/form-data**, not JSON. They follow the exact pattern of `api-server/handlers/admin/upload-tag-icon.go`: call `r.ParseMultipartForm(10 << 20)`, read text fields via `r.FormValue`, read the file via `r.FormFile("resume")` with magic-byte content-type detection. Do **not** call `json.NewDecoder(r.Body).Decode(...)` on these handlers. The matching TypeSpec request models use `@multipartBody` and `HttpPart<...>` and exist only for documentation — the Go handler does not import a generated multipart struct (the typespec `.go` file for these endpoints contains the helper validators for the text fields only). nginx `client_max_body_size 10m` already permits the 5 MB resume + form fields; offer letter is also ≤10 MB per the constraint. If the offer letter is increased above 10 MB in future, raise nginx limit in lockstep.
- The hub `apply-for-opening` handler is the most complex; pseudocode:

  ```text
  parse multipart (max 10MB memory, max 5MB file)
  decode form fields → typed struct + Validate()
  detect resume content-type via magic bytes (PDF: %PDF, DOCX: PK zip + verify [Content_Types].xml entry)
    -> 400 invalid_resume on mismatch with extension
  resolve org_id, opening_id, region from org_domain + opening_number   (1 global lookup)
  call regional CheckCanApply CTE (live/already/cool-off)
    -> 409 live_application_exists | already_applied
    -> 422 cool_off_active (body includes earliest_next_apply_at)
  validate every endorser_handle is a Connected connection (single regional bulk lookup against hub_connections)
    -> 400 not_a_connection (response body lists offending handles)
  generate s3_key = "applications/{org_id}/{application_id_uuid}/resume.{ext}"   (application_id pre-generated)
  Upload resume bytes to opening's region S3 (s.GetStorageConfig(openingRegion))
    -> on failure: 500, no DB rows written
  Tx (regional, opening's region):
    INSERT applications (state='applied', notify_colleagues_at_target=<val>, resume_s3_key=<key>)
    INSERT endorsement_requests (1 row per endorser_handle, state='pending')
    INSERT emails rows (one per endorser, type='hub_endorsement_request')
    INSERT emails rows (one per opening watcher, type='org_new_application')
    if notify_colleagues_at_target=true:
      query regional hub_connections × work_email_stints for active stints at org's domains
      bulk INSERT emails rows (one per such colleague, type='hub_colleague_applied_alert')
    INSERT audit_logs (event_type='hub.apply_for_opening')
  Tx (global, after regional commit):
    INSERT applications_index (region, hub_user_global_id, applied_at, state='applied')
    INSERT endorsement_requests_index (one per endorser)
    on failure: best-effort DELETE of regional rows (log CONSISTENCY_ALERT if delete fails);
                also DELETE S3 object via DeleteObject (log CONSISTENCY_ALERT on failure)
  return 201 { application_id }
  ```

- The `org/shortlist-application` handler in a single regional tx:
  - Reads `applications` for state check.
  - Updates state to `shortlisted`, sets `state_changed_at`.
  - Inserts a row into `candidacies`.
  - Writes audit log `org.shortlist_application`.
  - On commit, asynchronously updates the global `applications_index.state` (compensating in same global tx) and sends candidate notification.

- The `org/extend-offer` handler in a single regional tx:
  - Reads candidacy state (must be `interviewing` → 422 otherwise).
  - Inserts row into `offers`.
  - Updates candidacy to `offered`.
  - Bulk-updates interviews `WHERE candidacy_id = $1 AND state = 'scheduled'` → `cancelled`.
  - Inserts system comment.
  - Writes audit log `org.extend_offer`.
  - Notifies candidate + watchers post-commit.

- The `submit-interview-feedback` handler checks the caller is an interviewer on this row **before** writing — no separate role grants permission; interviewer membership is the gate.

- The `org/get-application` handler joins applications + endorsements (filtered `hidden_by_candidate=false`) + connection states (single round-trip) and a separate global call for the candidate's `PublicEmployerStint[]`.

##### Cross-region write pattern (critical — easy to get wrong)

Hub users authenticate against their **home region**, but most write actions in this spec land in the **opening's region** (where hiring data lives). The implementation must use `s.WithRegionalTxFor(ctx, openingRegion, fn)` (already documented in MEMORY) rather than the default `s.WithRegionalTx(ctx, fn)` (which targets the authenticated user's home region).

Endpoints where this matters:

| Endpoint                               | Region resolution                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/hub/apply-for-opening`               | opening's region (from `org_domains` global lookup)                                                         |
| `/hub/withdraw-application`            | opening's region (from `applications_index` global lookup by application_id)                                |
| `/hub/get-my-application`              | reads from opening's region                                                                                 |
| `/hub/request-endorsements`            | opening's region (application_id → applications_index → region)                                             |
| `/hub/write-endorsement`               | opening's region (request_id → endorsement_requests_index → region; or application_id for unsolicited path) |
| `/hub/update-endorsement`              | opening's region (endorsement_id → applications_index via app join)                                         |
| `/hub/decline-endorsement-request`     | opening's region                                                                                            |
| `/hub/hide-endorsement-on-application` | opening's region                                                                                            |
| `/hub/show-endorsement-on-application` | opening's region                                                                                            |
| `/hub/nominate-colleague-for-role`     | opening's region                                                                                            |
| `/hub/accept-referral`                 | opening's region (read-only; returns prefill, no write here)                                                |
| `/hub/decline-referral`                | opening's region                                                                                            |
| `/hub/add-candidacy-comment`           | candidacy's region = opening's region                                                                       |
| `/hub/rsvp-interview`                  | interview's region = opening's region                                                                       |
| `/hub/nominate-references`             | opening's region                                                                                            |
| `/hub/accept-reference-nomination`     | opening's region                                                                                            |
| `/hub/decline-reference-nomination`    | opening's region                                                                                            |
| `/hub/submit-reference-response`       | opening's region                                                                                            |

The global index tables (`applications_index`, `endorsement_requests_index`, `referral_nominations_index`, `reference_nominations_index`) exist precisely to make this routing one-hop: the caller passes an ID that the handler resolves in global DB to find the region.

For endpoints touching purely hub-side data (`/hub/get-apply-preferences`, `/hub/set-notify-connections-on-apply`, `/hub/set-allow-unsolicited-endorsements`, `/hub/list-network-opportunities`, `/hub/list-colleagues-at-employer`) — these stay in the caller's home region (`s.WithRegionalTx`), since the preference table `hub_apply_preferences` and the `hub_connections` data live there.

For `/hub/list-my-applications` and `/hub/list-my-candidacies`: global query against the index, then bulk-fetch from each region with `WHERE application_id = ANY($1)`. Group by region first to keep one query per region.

##### Concurrency, consistency and races

- **Two recruiters racing to shortlist the same application**: the `UPDATE applications SET state='shortlisted' WHERE application_id=$1 AND state='applied'` returns 0 rows for the loser; the loser receives 422 `invalid_state`. The `candidacies.application_id` `UNIQUE` constraint provides a second line of defence.
- **Two endorsers writing simultaneously**: the `endorsements.(application_id, endorser_hub_user_global_id)` `UNIQUE` constraint serializes them. Second writer gets 409.
- **Endorser deactivates between request and write**: `HubAuth` middleware blocks them from logging in at all, so this is not reachable via a live session. A still-cached session is invalidated by the existing token-versioning middleware (no change here).
- **Compensating-transaction failure** (regional commit succeeded, global index write failed): log `CONSISTENCY_ALERT` per the standard pattern in `CLAUDE.md`, then attempt the global write again via a background reconciliation worker. The application is still queryable by the org (it lives regionally); only the hub-user "my applications" list misses it briefly.
- **Connection severed during apply** (between endorser-list validation and the insert): the application still succeeds, but the endorsement request is created against the now-severed connection. The endorser, on opening the request, will see "you are no longer connected to this candidate"; they cannot write. Operationally fine; the candidate's `request-endorsements` retry is blocked by the unique constraint.
- **Cross-region notification fanout for `notify_colleagues_at_target`**: for each `connected` colleague at the target org, look up that colleague's home region from the global users table and enqueue the notification on their region's notification queue (one query per region with `IN (?)`). No cross-region writes — notifications use existing regional pipelines.
- **Concurrent extend-offer**: candidacy state read+write happens inside the regional tx; second caller gets 422.
- **Watcher cap race**: enforce via `COUNT(*) < 25` inside the tx that inserts the watcher (held lock on the opening row via `SELECT FOR UPDATE`).

- The hub `list-my-applications` handler:
  - One global query against `applications_index` to keyset-paginate IDs and group by region.
  - One regional query per touched region (max 3) using `WHERE application_id = ANY($1)` to hydrate full rows.
  - Stitch and return in original `applied_at DESC` order.

#### Audit Log Events

All in regional `audit_logs` unless stated otherwise. Every write handler emits exactly one row inside its primary transaction.

| event_type                         | actor type | target                     | event_data keys                                                     |
| ---------------------------------- | ---------- | -------------------------- | ------------------------------------------------------------------- |
| `hub.apply_for_opening`            | hub user   | hub user (self)            | `application_id`, `org_id`, `opening_id`, `endorser_count`          |
| `hub.withdraw_application`         | hub user   | hub user (self)            | `application_id`                                                    |
| `hub.request_endorsement`          | hub user   | hub user (endorser, hash)  | `application_id`, `request_id`                                      |
| `hub.write_endorsement`            | hub user   | hub user (candidate, hash) | `endorsement_id`, `application_id`, `is_referral`, `is_unsolicited` |
| `hub.update_endorsement`           | hub user   | hub user (candidate, hash) | `endorsement_id`                                                    |
| `hub.decline_endorsement_request`  | hub user   | hub user (candidate, hash) | `request_id`                                                        |
| `hub.hide_endorsement`             | hub user   | hub user (self)            | `endorsement_id`                                                    |
| `hub.show_endorsement`             | hub user   | hub user (self)            | `endorsement_id`                                                    |
| `hub.nominate_colleague`           | hub user   | hub user (candidate, hash) | `nomination_id`, `opening_id`                                       |
| `hub.accept_referral`              | hub user   | hub user (self)            | `nomination_id`, `application_id`                                   |
| `hub.decline_referral`             | hub user   | hub user (self)            | `nomination_id`                                                     |
| `hub.rsvp_interview`               | hub user   | hub user (self)            | `interview_id`, `rsvp`                                              |
| `hub.add_candidacy_comment`        | hub user   | hub user (self)            | `candidacy_id`, `comment_id`                                        |
| `hub.nominate_references`          | hub user   | hub user (nominee, hash)   | `request_id`, `nomination_count`                                    |
| `hub.accept_reference_nomination`  | hub user   | hub user (self)            | `nomination_id`                                                     |
| `hub.decline_reference_nomination` | hub user   | hub user (self)            | `nomination_id`                                                     |
| `hub.submit_reference_response`    | hub user   | hub user (self)            | `nomination_id`                                                     |
| `hub.set_apply_preferences`        | hub user   | hub user (self)            | `notify_connections_on_apply`, `allow_unsolicited_endorsements`     |
| `org.shortlist_application`        | org user   | hub user (hash)            | `application_id`, `candidacy_id`                                    |
| `org.reject_application`           | org user   | hub user (hash)            | `application_id`                                                    |
| `org.label_application`            | org user   | hub user (hash)            | `application_id`, `label`                                           |
| `org.add_candidacy_comment`        | org user   | hub user (hash)            | `candidacy_id`, `comment_id`                                        |
| `org.schedule_interview`           | org user   | hub user (hash)            | `interview_id`, `candidacy_id`, `type`, `starts_at`                 |
| `org.update_interview`             | org user   | hub user (hash)            | `interview_id`                                                      |
| `org.cancel_interview`             | org user   | hub user (hash)            | `interview_id`                                                      |
| `org.add_interviewer`              | org user   | org user (added)           | `interview_id`, `interviewer_org_user_id`                           |
| `org.remove_interviewer`           | org user   | org user (removed)         | `interview_id`, `interviewer_org_user_id`                           |
| `org.rsvp_interview`               | org user   | self                       | `interview_id`, `rsvp`                                              |
| `org.submit_interview_feedback`    | org user   | hub user (hash)            | `interview_id`, `decision`                                          |
| `org.extend_offer`                 | org user   | hub user (hash)            | `candidacy_id`, `cancelled_interview_count`                         |
| `org.request_references`           | org user   | hub user (hash)            | `request_id`, `candidacy_id`, `max_references`                      |
| `org.update_hiring_settings`       | org user   | —                          | `cool_off_days`                                                     |

Negative path: no audit row written when handler returns 4xx/5xx (asserted by tests).

### Frontend

#### New Routes

| Portal | Route path                                              | Page component                                       |
| ------ | ------------------------------------------------------- | ---------------------------------------------------- |
| hub-ui | `/openings`                                             | `src/pages/openings/OpeningsListPage.tsx`            |
| hub-ui | `/openings/:orgDomain/:openingNumber`                   | `src/pages/openings/OpeningDetailPage.tsx`           |
| hub-ui | `/openings/:orgDomain/:openingNumber/apply`             | `src/pages/openings/ApplyForOpeningPage.tsx`         |
| hub-ui | `/my-applications`                                      | `src/pages/applications/MyApplicationsPage.tsx`      |
| hub-ui | `/my-applications/:applicationId`                       | `src/pages/applications/MyApplicationDetailPage.tsx` |
| hub-ui | `/my-candidacies`                                       | `src/pages/candidacies/MyCandidaciesPage.tsx`        |
| hub-ui | `/my-candidacies/:candidacyId`                          | `src/pages/candidacies/MyCandidacyDetailPage.tsx`    |
| hub-ui | `/endorsement-requests`                                 | `src/pages/endorsements/InboxPage.tsx`               |
| hub-ui | `/endorsement-requests/:requestId/write`                | `src/pages/endorsements/WritePage.tsx`               |
| hub-ui | `/referrals`                                            | `src/pages/referrals/ReferralInboxPage.tsx`          |
| hub-ui | `/my-employer/:orgDomain/openings/:openingNumber/refer` | `src/pages/referrals/NominatePage.tsx`               |
| hub-ui | `/reference-requests`                                   | `src/pages/references/InboxPage.tsx`                 |
| hub-ui | `/reference-requests/:nominationId/respond`             | `src/pages/references/RespondPage.tsx`               |
| hub-ui | `/settings/apply-preferences`                           | `src/pages/settings/ApplyPreferencesPage.tsx`        |
| org-ui | `/openings/:openingId/applications`                     | `src/pages/applications/ApplicationsListPage.tsx`    |
| org-ui | `/openings/:openingId/applications/:applicationId`      | `src/pages/applications/ApplicationDetailPage.tsx`   |
| org-ui | `/candidacies`                                          | `src/pages/candidacies/CandidaciesListPage.tsx`      |
| org-ui | `/candidacies/:candidacyId`                             | `src/pages/candidacies/CandidacyDetailPage.tsx`      |
| org-ui | `/candidacies/:candidacyId/schedule-interview`          | `src/pages/interviews/ScheduleInterviewPage.tsx`     |
| org-ui | `/interviews/:interviewId/feedback`                     | `src/pages/interviews/FeedbackPage.tsx`              |
| org-ui | `/candidacies/:candidacyId/extend-offer`                | `src/pages/offers/ExtendOfferPage.tsx`               |
| org-ui | `/candidacies/:candidacyId/request-references`          | `src/pages/references/RequestReferencesPage.tsx`     |
| org-ui | `/settings/hiring`                                      | `src/pages/settings/HiringSettingsPage.tsx`          |

#### Implementation Notes

- All pages follow the standard page layout from CLAUDE.md: `maxWidth: 1200`, back button first, `<Title level={2}>`, no outer Card.
- `<Spin spinning={loading}>` wraps every network-bound page; submit buttons disable while form has errors.
- All API types imported from `vetchium-specs/...`; no inline types anywhere.
- All `status`, `state`, `label` comparisons use the typed enum unions (no string-literal comparisons).
- Date/time displays use `formatDateTime(value, i18n.language)` / `formatDate(...)`.
- Endorsement cards on the org-side application detail render: handle, display_name, badge for `current_connection_state`, badge for `is_referral`, badge for `is_unsolicited`, "Verified colleague — {shared_domain}, {start}–{end} ({n}y)", and the text.
- Resume upload uses an existing presigned-PUT pattern against the opening's region S3 bucket; the apply handler validates the S3 key belongs to the hub user and was uploaded within 1 hour.
- Network-opportunities tile uses suspense; cached for 60s on the client.

### RBAC

#### New roles

All three locations must be kept in sync. The implementer literally adds these lines to the existing files (do not create new files or migrations):

- `specs/typespec/common/roles.ts` — append to the existing `RoleNames` array.
- `specs/typespec/common/roles.go` — append to the existing `OrgRoles` slice.
- `api-server/db/migrations/regional/00000000000001_initial_schema.sql` — append five lines inside the existing `INSERT INTO roles (role_name, description) VALUES` block, immediately after the last `org:manage_openings` row and before the hub-roles section:

```sql
    ('org:view_applications', 'Can list and view applications and candidacies (read-only)'),
    ('org:manage_applications', 'Can shortlist, reject, and label applications'),
    ('org:manage_candidacies', 'Can schedule/cancel interviews, comment on candidacies, extend offers, request references'),
    ('org:view_hiring_settings', 'Can view org-level hiring configuration (cool-off, defaults) read-only'),
    ('org:manage_hiring_settings', 'Can update org-level hiring configuration'),
```

| Role name                    | Portal | Description                                                                             |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `org:view_applications`      | org    | List/get applications, candidacies, interviews, offers, references                      |
| `org:manage_applications`    | org    | Shortlist, reject, label applications                                                   |
| `org:manage_candidacies`     | org    | Schedule/cancel interviews, add interviewers, comment, extend offer, request references |
| `org:view_hiring_settings`   | org    | Read org-level hiring config                                                            |
| `org:manage_hiring_settings` | org    | Update org-level hiring config                                                          |

Superadmin (`org:superadmin`) bypasses all checks per existing middleware contract.

#### Existing roles reused

- `hub:apply_jobs` — gates `/hub/apply-for-opening`. **No new hub roles.** Endorsing, referring, nominating references, RSVP, commenting are all open to any authenticated hub user.
- `org:manage_openings` — already gates watcher add/remove; reused.

#### Owner-only checks (no role required, enforced in handler)

- `/hub/withdraw-application` — application's applicant must equal authenticated hub user.
- `/hub/write-endorsement` / `/hub/update-endorsement` — endorsement's endorser must equal authenticated hub user; also Connection must be `connected` at write time (not at edit time — edits don't re-check).
- `/hub/hide-endorsement-on-application` / `/hub/show-endorsement-on-application` — application's applicant must equal authenticated hub user.
- `/hub/rsvp-interview`, `/hub/add-candidacy-comment` — candidacy's applicant must equal authenticated hub user.
- `/org/rsvp-interview`, `/org/submit-interview-feedback` — caller must be in `interview_interviewers` for that interview. No alternative role grants permission, **including** `org:superadmin` — feedback authorship is by membership only, not by privilege escalation.

This last point is a deliberate exception to the standard "superadmin bypasses everything" rule and is called out explicitly to prevent silent regression.

### i18n

Add to `en-US` (required), `de-DE`, `ta-IN` for every UI string. New namespaces:

```json
{
	"applications": {
		"title": "My applications",
		"applied": "Applied",
		"shortlisted": "Shortlisted",
		"rejected": "Rejected",
		"withdrawn": "Withdrawn",
		"expired": "Expired",
		"withdraw": "Withdraw",
		"applySuccess": "Application submitted",
		"liveApplicationExists": "You already have a live application at this company.",
		"alreadyApplied": "You have already applied to this opening.",
		"coolOffActive": "You applied to this company recently. You can re-apply after {{date}}.",
		"backToDashboard": "Back to dashboard"
	},
	"endorsements": {
		"title": "Endorsement requests",
		"writeButton": "Write endorsement",
		"decline": "Decline silently",
		"relationshipBadge": "Worked together at {{domain}}, {{start}}–{{end}} ({{years}}y)",
		"noLongerConnected": "No longer connected",
		"submitSuccess": "Endorsement submitted",
		"backToDashboard": "Back to dashboard"
	},
	"referrals": {
		"title": "Referrals",
		"nominate": "Nominate a colleague",
		"acceptAndApply": "Accept and apply",
		"decline": "Decline",
		"backToDashboard": "Back to dashboard"
	},
	"candidacies": {
		"title": "My candidacies",
		"backToDashboard": "Back to dashboard"
	},
	"interviews": {
		"rsvpYes": "Will attend",
		"rsvpNo": "Cannot attend",
		"feedbackSuccess": "Feedback submitted",
		"backToDashboard": "Back to dashboard"
	},
	"offers": {
		"extend": "Extend offer",
		"extendSuccess": "Offer extended",
		"backToDashboard": "Back to dashboard"
	},
	"references": {
		"nominate": "Nominate references",
		"respond": "Submit response",
		"backToDashboard": "Back to dashboard"
	},
	"discovery": {
		"colleaguesCount_one": "1 of your colleagues works here",
		"colleaguesCount_other": "{{count}} of your colleagues work here"
	},
	"hiringSettings": {
		"coolOffDays": "Cool-off period in days",
		"saveSuccess": "Settings saved",
		"backToDashboard": "Back to dashboard"
	}
}
```

### Test Matrix

Tests in `playwright/tests/api/{portal}/{feature}.spec.ts`. All types imported from `specs/typespec/`.

Below is the exhaustive list. Every row is one or more tests. Group by handler.

#### `/hub/apply-for-opening`

| Scenario                                                                               | Expected                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Happy path: valid body, opening `published`, no endorsers                              | 201 + `application_id`                                |
| Happy path with endorsers (all connected)                                              | 201 + endorsement_requests created                    |
| Happy path with `notify_colleagues_at_target=true` and ≥1 connection at target         | 201 + notification fanout asserted                    |
| Cover letter below 100 chars                                                           | 400 validation                                        |
| Cover letter above 5000 chars                                                          | 400 validation                                        |
| Resume upload id does not belong to caller                                             | 400 invalid resume                                    |
| Resume upload id older than 1 hour                                                     | 400 invalid resume                                    |
| Opening is `draft`                                                                     | 422                                                   |
| Opening is `paused`/`closed`/`archived`                                                | 422                                                   |
| Opening org_domain unknown                                                             | 404                                                   |
| Opening_number unknown for that org                                                    | 404                                                   |
| Has live application at same org (any opening)                                         | 409 `live_application_exists`                         |
| Has prior application to **same opening** in any state                                 | 409 `already_applied`                                 |
| Within cool-off window (org `cool_off_days=90`, last shortlist 30 days ago)            | 422 `cool_off_active`                                 |
| Cool-off disabled (`cool_off_days=0`) — can re-apply immediately after prior shortlist | 201                                                   |
| Endorser handle is not a connection                                                    | 400 `not_a_connection`                                |
| Endorser handle is a connection in `they_disconnected` state                           | 400 `not_a_connection`                                |
| 11 endorser handles (over 10 cap)                                                      | 400                                                   |
| Unauthenticated                                                                        | 401                                                   |
| Authenticated without `hub:apply_jobs` role                                            | 403                                                   |
| Authenticated with `hub:apply_jobs` role (positive RBAC)                               | 201                                                   |
| Audit log row written on success                                                       | row present with `event_type='hub.apply_for_opening'` |
| No audit log on 4xx                                                                    | count unchanged                                       |
| Global `applications_index` row created                                                | row present                                           |
| Compensating delete on global write failure                                            | application row absent regionally                     |

#### `/hub/withdraw-application`

| Scenario                          | Expected                   |
| --------------------------------- | -------------------------- |
| Withdraw while `applied`          | 200 + state `withdrawn`    |
| Withdraw while `shortlisted`      | 422 `invalid_state`        |
| Withdraw a stranger's application | 404                        |
| Unauthenticated                   | 401                        |
| Watchers receive a notification   | mailpit assertion          |
| Audit log row                     | `hub.withdraw_application` |

#### `/hub/list-my-applications`

| Scenario                                  | Expected            |
| ----------------------------------------- | ------------------- |
| Returns applications across all 3 regions | 200 + correct items |
| Filter by `state`                         | 200 + filtered      |
| Pagination key works                      | 200 + monotonic     |
| Empty result                              | 200 + empty array   |
| Unauthenticated                           | 401                 |

#### `/hub/request-endorsements`

| Scenario                                  | Expected                   |
| ----------------------------------------- | -------------------------- |
| Add 2 endorsers to existing `applied` app | 200                        |
| Add endorser already requested            | 409 (idempotent or unique) |
| Add non-connection                        | 400                        |
| App in `shortlisted`                      | 422                        |
| App belongs to other user                 | 404                        |

#### `/hub/write-endorsement`

| Scenario                                                                     | Expected                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Respond to pending request — 100 chars                                       | 201                                                        |
| Respond — 99 chars                                                           | 400                                                        |
| Respond — 2001 chars                                                         | 400                                                        |
| Unsolicited endorsement, candidate opted in                                  | 201                                                        |
| Unsolicited endorsement, candidate opted out                                 | 403                                                        |
| Write twice for same (app, endorser)                                         | 409                                                        |
| Write after application moves to `shortlisted` (no pending request)          | 422 (`window_closed`)                                      |
| Endorser is not a connection at all                                          | 403                                                        |
| Audit log row                                                                | `hub.write_endorsement`                                    |
| Endorsement persists after subsequent disconnect, badge surfaced to org view | org GET shows `current_connection_state=they_disconnected` |

#### `/hub/update-endorsement`

| Scenario                         | Expected            |
| -------------------------------- | ------------------- |
| Edit while application `applied` | 200                 |
| Edit after `shortlisted`         | 422 `window_closed` |
| Edit someone else's endorsement  | 404                 |

#### `/hub/decline-endorsement-request`

| Scenario                          | Expected                         |
| --------------------------------- | -------------------------------- |
| Decline pending request           | 200 + state `declined`           |
| Decline already-written           | 422                              |
| Candidate cannot see who declined | GET endorsement list excludes it |

#### `/hub/hide-endorsement-on-application` / show

| Scenario                    | Expected                               |
| --------------------------- | -------------------------------------- |
| Hide while applied          | 200 + org GET excludes it              |
| Hide while shortlisted      | 200 (still allowed)                    |
| Show while applied          | 200                                    |
| Show while shortlisted      | 422 (re-show not allowed post-applied) |
| Hide stranger's endorsement | 404                                    |

#### `/hub/nominate-colleague-for-role` (referral)

| Scenario                                                               | Expected                  |
| ---------------------------------------------------------------------- | ------------------------- |
| Referrer has active stint at hiring org, nominates a connection        | 201                       |
| Referrer has no active stint at hiring org                             | 403                       |
| Nominate self                                                          | 400                       |
| Nominate non-connection                                                | 400                       |
| Duplicate nomination (same referrer, candidate, opening) while pending | 409                       |
| Candidate already has live application at the org                      | 422 `already_in_pipeline` |
| Opening not `published`                                                | 422                       |
| Audit log row                                                          | `hub.nominate_colleague`  |
| Referrer can see candidate `applied=true` after candidate accepts      | binary only, no app state |

#### `/hub/accept-referral` / decline

| Scenario                                                         | Expected                                  |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Accept pending referral, complete apply, statement auto-attached | 201 + endorsement with `is_referral=true` |
| Accept expired referral                                          | 422                                       |
| Decline pending                                                  | 200                                       |
| Stranger's referral                                              | 404                                       |

#### `/hub/list-network-opportunities`

| Scenario                                                           | Expected               |
| ------------------------------------------------------------------ | ---------------------- |
| ≥1 connection has active stint at an org with `published` openings | 200 + at least 1 group |
| No qualifying connections                                          | 200 + empty            |
| Excludes own current employer                                      | not returned           |

#### `/hub/list-colleagues-at-employer`

| Scenario                                             | Expected        |
| ---------------------------------------------------- | --------------- |
| Domain with 3 connections currently working there    | 200 + 3 entries |
| Domain with 0                                        | 200 + empty     |
| Domain with connections in `they_disconnected` state | filtered out    |

#### `/hub/rsvp-interview`

| Scenario                      | Expected |
| ----------------------------- | -------- |
| RSVP yes/no while scheduled   | 200      |
| RSVP after `completed`        | 422      |
| RSVP for stranger's interview | 404      |

#### `/hub/nominate-references` / accept / decline / submit-response

| Scenario                                          | Expected                     |
| ------------------------------------------------- | ---------------------------- |
| Nominate connections only, up to `max_references` | 200                          |
| Nominate non-connection                           | 400                          |
| Nominate more than `max_references`               | 400                          |
| Accept and submit all required answers            | 200                          |
| Submit missing a required question                | 400                          |
| Edit submitted response                           | 422 (no edits)               |
| Decline silently                                  | 200 + candidate not notified |

#### `/org/list-applications` and `/org/get-application`

| Scenario                                                | Expected              |
| ------------------------------------------------------- | --------------------- |
| List with `org:view_applications`                       | 200                   |
| List without role (positive RBAC negative)              | 403                   |
| List with `org:superadmin`                              | 200                   |
| Get application: hidden endorsements excluded           | 200 + excluded        |
| Get application: disconnected endorser shown with badge | 200 + badge field set |
| Get application: candidate's full stints included       | 200                   |
| Cross-org get (org A tries to read org B's application) | 404                   |
| Unauthenticated                                         | 401                   |

#### `/org/shortlist-application`

| Scenario                                                 | Expected                                    |
| -------------------------------------------------------- | ------------------------------------------- |
| Shortlist while `applied` with `org:manage_applications` | 200 + candidacy created                     |
| Shortlist while `shortlisted` (idempotency block)        | 422                                         |
| Shortlist while `rejected`                               | 422                                         |
| Shortlist with `org:view_applications` only              | 403                                         |
| Shortlist with `org:superadmin`                          | 200                                         |
| Audit log + global state mirror updated                  | row present + index row state=`shortlisted` |
| Candidate receives notification                          | mailpit assertion                           |

#### `/org/reject-application`

Similar matrix; also assert state goes to `rejected`; no candidacy created; rejection_reason saved.

#### `/org/label-application`

| Scenario                             | Expected |
| ------------------------------------ | -------- |
| Set Green/Yellow/Red while `applied` | 200      |
| Clear label                          | 200      |
| Set label after `shortlisted`        | 422      |

#### `/org/schedule-interview`

| Scenario                                                        | Expected     |
| --------------------------------------------------------------- | ------------ |
| Schedule with 1 interviewer, valid times                        | 201          |
| Schedule with 6 interviewers                                    | 400          |
| Schedule with 0 interviewers                                    | 400          |
| Interviewer is deactivated org user                             | 400          |
| `ends_at <= starts_at`                                          | 400          |
| Schedule against candidacy in `offered` state                   | 422          |
| Audit log + notifications (candidate + interviewers + watchers) | all asserted |
| RBAC positive (`org:manage_candidacies`)                        | 201          |
| RBAC negative (no role)                                         | 403          |
| Superadmin                                                      | 201          |

#### `/org/update-interview` / cancel / add-interviewer / remove-interviewer

Standard CRUD matrices; additionally:

- Cannot edit/cancel after `completed`.
- Removing the last interviewer is allowed (interview can have 0 between operations, but feedback submission requires ≥1).
- Adding interviewer beyond cap 5 → 400.

#### `/org/submit-interview-feedback`

| Scenario                                               | Expected                        |
| ------------------------------------------------------ | ------------------------------- |
| Interviewer submits valid feedback                     | 200 + interview `completed`     |
| Non-interviewer submits (even `org:superadmin`)        | 403                             |
| Resubmit overwrites prior feedback by same interviewer | 200                             |
| Submit on `cancelled` interview                        | 422                             |
| Missing required fields                                | 400                             |
| Audit log row                                          | `org.submit_interview_feedback` |

#### `/org/extend-offer`

| Scenario                                                                   | Expected                        |
| -------------------------------------------------------------------------- | ------------------------------- |
| Extend while candidacy `interviewing`, 2 scheduled interviews exist        | 200 + both interviews cancelled |
| Extend while candidacy `offered`                                           | 422                             |
| Offer letter S3 key invalid                                                | 400                             |
| Candidate receives notification, watchers notified, system comment created | all asserted                    |
| RBAC matrix                                                                | positive, negative, superadmin  |

#### `/org/request-references` and reference flow end-to-end

Full E2E:

1. Org sends request → assert `reference_requests` + global index rows.
2. Candidate lists incoming → request appears with type `to_nominate`.
3. Candidate nominates 2 connections → assert nominations + global index rows.
4. Each nominee lists incoming → request appears with type `to_respond`.
5. One accepts and submits all questions → state `submitted`.
6. Other declines → state `declined`; org-side list reflects both states.
7. Org fetches responses → sees the accepted one only; declined one shows `declined` without text.
8. Nominate non-connection → 400.
9. Nominate more than `max_references` → 400.

#### `/org/get-hiring-settings` / `/org/update-hiring-settings`

| Scenario                                        | Expected                            |
| ----------------------------------------------- | ----------------------------------- |
| Get without ever setting                        | 200 + defaults (`cool_off_days=90`) |
| Update to 30                                    | 200 + persisted                     |
| Update to 366                                   | 400                                 |
| Update to -1                                    | 400                                 |
| RBAC positive (`org:manage_hiring_settings`)    | 200                                 |
| RBAC negative (`org:view_hiring_settings` only) | 403                                 |
| Superadmin                                      | 200                                 |
| Audit log row                                   | `org.update_hiring_settings`        |

#### Cross-cutting tests

- **Region isolation**: an application created in `ind1` is not visible via direct regional query to `usa1`; `list-my-applications` correctly stitches via global index.
- **Privacy invariant — current employer**: candidate with active stint at `acme.com` applies to `globex.com`. Asserted: no audit log row in `acme.com`'s region targeting that candidate from any hiring event in `globex.com`'s region; no notification routed to anyone at `acme.com`.
- **Privacy invariant — endorser-declined invisible**: candidate sees no entry for a declined request in `list-my-application` endorsement list; org sees nothing either.
- **Connection-count caching**: hub `list-openings` returns colleague count; subsequent reveal via `list-colleagues-at-employer` agrees with count.
- **Cool-off boundary**: with `cool_off_days=30`, shortlist at T → reapply at T+29d 23h 59m blocked; reapply at T+30d allowed.
- **Notification fanout caps**: applying with 25 watchers fans out 25 watcher notifications, capped.

#### Audit log tests (per CLAUDE.md mandate)

For every write endpoint listed above:

- After success: assert row exists with correct `event_type`, `actor_user_id`, `target_user_id`, hashed emails only, expected `event_data`.
- After 4xx: assert audit row count unchanged.
- After 5xx (forced via injected failure): assert audit row absent (proves it lives inside the tx).

#### RBAC tests (per CLAUDE.md mandate)

For every role-protected endpoint (every `/org/*` endpoint in the table above except the interviewer-membership ones):

- **Positive**: non-superadmin user with the exact role → 200/201/204.
- **Negative**: authenticated user with no roles → 403.
- (Implicit: superadmin → 200, covered by happy path.)

For interviewer-membership endpoints (`/org/rsvp-interview`, `/org/submit-interview-feedback`):

- **Positive**: caller is in `interview_interviewers` → 200.
- **Negative non-member non-superadmin** → 403.
- **Negative non-member superadmin** → 403 (deliberate exception).

---

## Full TypeSpec Specifications

This section is the **authoritative** TypeSpec source for every endpoint in this spec. The implementer creates one `.tsp` file per logical group below, with matching `.ts` and `.go` files written by hand following the existing pattern in `org/openings.{ts,go}`. The handler implementations import these types — there is **no inlined type allowed**.

Common types referenced below already exist in `specs/typespec/common/common.tsp` (`Handle`, `OkResponse`, `CreatedResponse`, `NoContentResponse`, `BadRequestResponse`, `NotFoundResponse`, `ConflictResponse`, `UnprocessableEntityResponse`) and in `specs/typespec/hub/connections.tsp` (`ConnectionState`), `specs/typespec/hub/work-emails.tsp` (`PublicEmployerStint`).

### File: `specs/typespec/hub/applications.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "./connections.tsp";
import "./work-emails.tsp";
import "./endorsements.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ApplicationState {
  Applied:     "applied",
  Shortlisted: "shortlisted",
  Rejected:    "rejected",
  Withdrawn:   "withdrawn",
  Expired:     "expired",
}

union ApplicationColorLabel {
  Green:  "green",
  Yellow: "yellow",
  Red:    "red",
}

// Multipart endpoint — modeled here for completeness; the handler does not use json.Decode.
// Field constraints:
//   cover_letter      : 100..5000 chars
//   resume            : file, ≤5MB, PDF or DOCX
//   endorser_handles  : 0..10 items, each must be a Connected connection
//   endorsement_request_note : 0..500 chars
//   notify_colleagues_at_target : "true" | "false" (default "false")
@multipartBody
model ApplyForOpeningRequest {
  org_domain:                  HttpPart<string>;
  opening_number:              HttpPart<int32>;
  cover_letter:                HttpPart<string>;
  resume:                      HttpPart<File>;
  endorser_handles:            HttpPart<string>[];   // each value is a Handle
  endorsement_request_note?:   HttpPart<string>;
  notify_colleagues_at_target?: HttpPart<string>;    // "true" or "false"
}

model ApplyForOpeningResponse {
  application_id: string;
}

// Error body shape returned on the candidate-side "cannot apply" responses.
model CannotApplyError {
  code:                    "live_application_exists" | "already_applied" | "cool_off_active" | "not_a_connection" | "invalid_resume";
  earliest_next_apply_at?: utcDateTime;   // present only when code=cool_off_active
  offending_handles?:      Handle[];      // present only when code=not_a_connection
}

model WithdrawApplicationRequest { application_id: string; }

model HubApplicationSummary {
  application_id:   string;
  org_domain:       string;
  org_name:         string;
  opening_number:   int32;
  opening_title:    string;
  state:            ApplicationState;
  label?:           ApplicationColorLabel;
  endorsement_count: int32;
  applied_at:       utcDateTime;
  state_changed_at: utcDateTime;
}

model HubApplication {
  application_id:        string;
  org_domain:            string;
  org_name:              string;
  opening_number:        int32;
  opening_title:         string;
  state:                 ApplicationState;
  label?:                ApplicationColorLabel;
  ai_score?:             decimal;
  applied_at:            utcDateTime;
  state_changed_at:      utcDateTime;
  cover_letter:          string;
  resume_download_url:   string;            // signed, TTL 5 minutes
  endorsements:          MyEndorsementOnApplication[];
  endorsement_requests:  MyEndorsementRequestSent[];
  notify_colleagues_at_target: boolean;
  candidacy_id?:         string;            // set iff state=shortlisted and candidacy exists
}

model MyEndorsementOnApplication {
  endorsement_id:        string;
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  is_referral:           boolean;
  is_unsolicited:        boolean;
  text:                  string;
  hidden_by_candidate:   boolean;
  written_at:            utcDateTime;
  edited_at?:            utcDateTime;
}

model MyEndorsementRequestSent {
  request_id:            string;
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  state:                 "pending" | "written" | "declined" | "expired";
  requested_at:          utcDateTime;
}

model ListMyApplicationsRequest {
  filter_state?:    ApplicationState[];
  pagination_key?:  string;
  limit?:           int32;       // default 20, max 100
}

model ListMyApplicationsResponse {
  applications:         HubApplicationSummary[];
  next_pagination_key?: string;
}

model GetMyApplicationRequest { application_id: string; }

@route("/hub/apply-for-opening")
@post op applyForOpening(...ApplyForOpeningRequest):
  CreatedResponse<ApplyForOpeningResponse>
  | { @statusCode statusCode: 400; @body body: CannotApplyError | ValidationError[]; }
  | { @statusCode statusCode: 409; @body body: CannotApplyError; }
  | { @statusCode statusCode: 422; @body body: CannotApplyError; }
  | NotFoundResponse;

@route("/hub/withdraw-application")
@post op withdrawApplication(...WithdrawApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/list-my-applications")
@post op listMyApplications(...ListMyApplicationsRequest):
  OkResponse<ListMyApplicationsResponse> | BadRequestResponse;

@route("/hub/get-my-application")
@post op getMyApplication(...GetMyApplicationRequest):
  OkResponse<HubApplication> | NotFoundResponse;
```

### File: `specs/typespec/hub/endorsements.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "./connections.tsp";

using TypeSpec.Http;
namespace Vetchium;

union EndorsementRequestState {
  Pending:  "pending",
  Written:  "written",
  Declined: "declined",
  Expired:  "expired",
}

model RequestEndorsementsRequest {
  application_id:   string;
  endorser_handles: Handle[];     // 1..10
  note?:            string;       // 0..500
}

model EndorsementRequestIncoming {
  request_id:               string;
  application_id:           string;
  candidate_handle:         Handle;
  candidate_display_name:   string;
  org_domain:               string;
  org_name:                 string;
  opening_title:            string;
  shared_domain:            string;
  overlap_start_year:       int32;
  overlap_end_year:         int32;
  note?:                    string;
  state:                    EndorsementRequestState;
  requested_at:             utcDateTime;
  candidate_connection_state: ConnectionState;   // current, may be != "connected" if severed
}

model EndorsementRequestOutgoing {
  request_id:           string;
  application_id:       string;
  endorser_handle:      Handle;
  endorser_display_name: string;
  state:                EndorsementRequestState;
  requested_at:         utcDateTime;
}

model ListEndorsementRequestsIncomingRequest {
  filter_state?:    EndorsementRequestState[];
  pagination_key?:  string;
  limit?:           int32;
}
model ListEndorsementRequestsIncomingResponse {
  requests:             EndorsementRequestIncoming[];
  next_pagination_key?: string;
}

model ListEndorsementRequestsOutgoingRequest {
  application_id:   string;
  pagination_key?:  string;
  limit?:           int32;
}
model ListEndorsementRequestsOutgoingResponse {
  requests:             EndorsementRequestOutgoing[];
  next_pagination_key?: string;
}

model WriteEndorsementRequest {
  // Either request_id (responding to a request) OR (application_id) (unsolicited) must be set, never both.
  request_id?:    string;
  application_id?: string;
  text:           string;     // 100..2000
}

model UpdateEndorsementRequest {
  endorsement_id: string;
  text:           string;     // 100..2000
}

model DeclineEndorsementRequestRequest { request_id: string; }

model HideEndorsementOnApplicationRequest { endorsement_id: string; }
model ShowEndorsementOnApplicationRequest { endorsement_id: string; }

@route("/hub/request-endorsements")
@post op requestEndorsements(...RequestEndorsementsRequest):
  OkResponse<{}>
  | BadRequestResponse           // not_a_connection, count > 10
  | NotFoundResponse              // application not owned / not found
  | ConflictResponse              // duplicate request
  | UnprocessableEntityResponse;  // application not in 'applied'

@route("/hub/list-endorsement-requests-incoming")
@post op listEndorsementRequestsIncoming(...ListEndorsementRequestsIncomingRequest):
  OkResponse<ListEndorsementRequestsIncomingResponse> | BadRequestResponse;

@route("/hub/list-endorsement-requests-outgoing")
@post op listEndorsementRequestsOutgoing(...ListEndorsementRequestsOutgoingRequest):
  OkResponse<ListEndorsementRequestsOutgoingResponse> | NotFoundResponse;

@route("/hub/write-endorsement")
@post op writeEndorsement(...WriteEndorsementRequest):
  CreatedResponse<{ endorsement_id: string }>
  | BadRequestResponse            // exactly one of request_id/application_id required, text length
  | { @statusCode statusCode: 403 } // not connected (unsolicited path) or candidate opted out
  | NotFoundResponse
  | ConflictResponse              // already written for this (application, endorser)
  | UnprocessableEntityResponse;  // application not in 'applied'

@route("/hub/update-endorsement")
@post op updateEndorsement(...UpdateEndorsementRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-endorsement-request")
@post op declineEndorsementRequest(...DeclineEndorsementRequestRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/hide-endorsement-on-application")
@post op hideEndorsement(...HideEndorsementOnApplicationRequest):
  OkResponse<{}> | NotFoundResponse;

@route("/hub/show-endorsement-on-application")
@post op showEndorsement(...ShowEndorsementOnApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/hub/referrals.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ReferralState {
  Pending:         "pending",
  AcceptedApplied: "accepted_applied",
  Declined:        "declined",
  Expired:         "expired",
}

model NominateColleagueRequest {
  candidate_handle:  Handle;
  org_domain:        string;
  opening_number:    int32;
  statement_text:    string;     // 100..2000
}

model NominateColleagueResponse { nomination_id: string; }

model ReferralReceived {
  nomination_id:           string;
  referrer_handle:         Handle;
  referrer_display_name:   string;
  org_domain:              string;
  org_name:                string;
  opening_number:          int32;
  opening_title:           string;
  shared_domain:           string;
  overlap_start_year:      int32;
  overlap_end_year:        int32;
  statement_text:          string;
  state:                   ReferralState;
  created_at:              utcDateTime;
  expires_at:              utcDateTime;
}

model ReferralMade {
  nomination_id:          string;
  candidate_handle:       Handle;
  candidate_display_name: string;
  org_domain:             string;
  opening_number:         int32;
  opening_title:          string;
  state:                  ReferralState;
  candidate_did_apply:    boolean;     // derived from state == 'accepted_applied'
  created_at:             utcDateTime;
}

model ListReferralsRequest { pagination_key?: string; limit?: int32; }
model ListReferralsReceivedResponse { referrals: ReferralReceived[]; next_pagination_key?: string; }
model ListReferralsMadeResponse     { referrals: ReferralMade[];     next_pagination_key?: string; }

model AcceptReferralRequest  { nomination_id: string; }
model AcceptReferralResponse {
  // Returns prefill values for the apply form; the candidate completes the multipart submit themselves.
  org_domain:       string;
  opening_number:   int32;
  prefill_statement_for_endorsement: string;   // referrer's statement, attached as referral endorsement on submit
}

model DeclineReferralRequest { nomination_id: string; }

@route("/hub/nominate-colleague-for-role")
@post op nominateColleague(...NominateColleagueRequest):
  CreatedResponse<NominateColleagueResponse>
  | BadRequestResponse            // not a connection, self-nomination, validation
  | { @statusCode statusCode: 403 } // referrer has no active stint at hiring org
  | NotFoundResponse              // opening or candidate not found
  | ConflictResponse              // duplicate pending nomination
  | UnprocessableEntityResponse;  // already_in_pipeline, opening not published

@route("/hub/list-referrals-received")
@post op listReferralsReceived(...ListReferralsRequest):
  OkResponse<ListReferralsReceivedResponse>;

@route("/hub/list-referrals-made")
@post op listReferralsMade(...ListReferralsRequest):
  OkResponse<ListReferralsMadeResponse>;

@route("/hub/accept-referral")
@post op acceptReferral(...AcceptReferralRequest):
  OkResponse<AcceptReferralResponse> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-referral")
@post op declineReferral(...DeclineReferralRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/hub/candidacies.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union CandidacyState {
  Interviewing:              "interviewing",
  Offered:                   "offered",
  OfferAccepted:             "offer_accepted",
  OfferDeclined:             "offer_declined",
  CandidateUnsuitable:       "candidate_unsuitable",
  CandidateNotResponding:    "candidate_not_responding",
  EmployerDefunct:           "employer_defunct",
}

union InterviewType {
  InPerson: "in_person",
  Video:    "video",
  TakeHome: "take_home",
  Other:    "other",
}

union InterviewState {
  Scheduled: "scheduled",
  Completed: "completed",
  Cancelled: "cancelled",
}

union InterviewRSVP {
  Yes: "yes",
  No:  "no",
}

model HubCandidacySummary {
  candidacy_id:   string;
  application_id: string;
  org_domain:     string;
  org_name:       string;
  opening_title:  string;
  state:          CandidacyState;
  created_at:     utcDateTime;
  state_changed_at: utcDateTime;
  latest_activity_at: utcDateTime;
}

model HubCandidacy {
  candidacy_id:   string;
  application_id: string;
  org_domain:     string;
  org_name:       string;
  opening_number: int32;
  opening_title:  string;
  state:          CandidacyState;
  created_at:     utcDateTime;
  state_changed_at: utcDateTime;
  interviews:     HubInterview[];
  comments:       CandidacyComment[];
  offer?:         HubOfferView;
}

model HubInterview {
  interview_id:    string;
  interview_type:  InterviewType;
  starts_at:       utcDateTime;
  ends_at:         utcDateTime;
  description?:    string;
  state:           InterviewState;
  candidate_rsvp?: InterviewRSVP;
  interviewer_rsvp_summary: { total: int32; yes: int32; no: int32; pending: int32; };
}

model CandidacyComment {
  comment_id:      string;
  author_kind:     "org_user" | "hub_user" | "system";
  author_handle?:  Handle;            // present when author_kind = hub_user
  body:            string;
  created_at:      utcDateTime;
}

model HubOfferView {
  extended_at: utcDateTime;
  salary_currency?: string;
  salary_amount?:   decimal;
  start_date?:      plainDate;
  notes?:           string;
  // resume offer_letter not exposed via this view; candidate sees only metadata
}

model ListMyCandidaciesRequest {
  filter_state?: CandidacyState[];
  pagination_key?: string;
  limit?: int32;
}
model ListMyCandidaciesResponse {
  candidacies: HubCandidacySummary[];
  next_pagination_key?: string;
}

model GetMyCandidacyRequest { candidacy_id: string; }

model AddCandidacyCommentRequest {
  candidacy_id: string;
  body:         string;     // 1..4000
}

model RSVPInterviewRequest {
  interview_id: string;
  rsvp:         InterviewRSVP;
}

@route("/hub/list-my-candidacies")
@post op listMyCandidacies(...ListMyCandidaciesRequest): OkResponse<ListMyCandidaciesResponse>;

@route("/hub/get-my-candidacy")
@post op getMyCandidacy(...GetMyCandidacyRequest): OkResponse<HubCandidacy> | NotFoundResponse;

@route("/hub/add-candidacy-comment")
@post op addCandidacyCommentHub(...AddCandidacyCommentRequest):
  CreatedResponse<{ comment_id: string }> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/rsvp-interview")
@post op rsvpInterviewHub(...RSVPInterviewRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/hub/references.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ReferenceNominationState {
  Nominated: "nominated",
  Accepted:  "accepted",
  Declined:  "declined",
  Submitted: "submitted",
  Expired:   "expired",
}

union ReferenceInboxRequestKind {
  ToNominate: "to_nominate",
  ToRespond:  "to_respond",
}

model ReferenceQuestion {
  question_id: string;            // stable across edits, e.g. "q1"
  text:        string;            // 10..500
  min_chars:   int32;             // 0..2000
  max_chars:   int32;             // min_chars..4000
  required:    boolean;
}

model HubReferenceRequestSummary {
  // unified view for the inbox
  kind:                  ReferenceInboxRequestKind;
  request_id:            string;
  nomination_id?:        string;   // present when kind = to_respond
  org_domain:            string;
  org_name:              string;
  opening_title:         string;
  candidate_handle?:     Handle;   // present when kind = to_respond
  max_references?:       int32;    // present when kind = to_nominate
  questions:             ReferenceQuestion[];
  response_deadline:     plainDate;
  state?:                ReferenceNominationState;   // present when kind = to_respond
  created_at:            utcDateTime;
}

model ListReferenceRequestsIncomingRequest {
  filter_kind?:    ReferenceInboxRequestKind[];
  filter_state?:   ReferenceNominationState[];
  pagination_key?: string;
  limit?: int32;
}
model ListReferenceRequestsIncomingResponse {
  requests:            HubReferenceRequestSummary[];
  next_pagination_key?: string;
}

model NominateReferencesRequest {
  request_id:       string;
  nominee_handles:  Handle[];      // 1..max_references
}

model AcceptReferenceNominationRequest  { nomination_id: string; }
model DeclineReferenceNominationRequest { nomination_id: string; }

model SubmitReferenceResponseRequest {
  nomination_id: string;
  answers: { question_id: string; response_text: string; }[];
}

@route("/hub/list-reference-requests-incoming")
@post op listReferenceRequestsIncoming(...ListReferenceRequestsIncomingRequest):
  OkResponse<ListReferenceRequestsIncomingResponse>;

@route("/hub/nominate-references")
@post op nominateReferences(...NominateReferencesRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/accept-reference-nomination")
@post op acceptReferenceNomination(...AcceptReferenceNominationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-reference-nomination")
@post op declineReferenceNomination(...DeclineReferenceNominationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/submit-reference-response")
@post op submitReferenceResponse(...SubmitReferenceResponseRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/hub/hiring-discovery.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

// Lightweight opening summary for hub-side browse.
model HubOpeningCard {
  org_domain:       string;
  org_name:         string;
  opening_number:   int32;
  title:            string;
  primary_city?:    string;
  employment_type:  EmploymentType;
  work_location_type: WorkLocationType;
  first_published_at: utcDateTime;
  colleague_count_here: int32;     // 0 if viewer unauthenticated
}

model HubListOpeningsRequest {
  filter_query?:           string;
  filter_employment_type?: EmploymentType[];
  filter_work_location_type?: WorkLocationType[];
  filter_country?:         string;
  filter_min_yoe?:         int32;
  filter_tag_ids?:         string[];
  filter_only_with_colleagues?: boolean;
  pagination_key?:         string;
  limit?:                  int32;
}
model HubListOpeningsResponse { openings: HubOpeningCard[]; next_pagination_key?: string; }

model HubGetOpeningRequest { org_domain: string; opening_number: int32; }

model HubOpeningDetail extends Opening {
  // viewer-aware fields, computed per request
  colleague_count_here:    int32;
  viewer_can_refer:        boolean;
  viewer_has_applied:      boolean;
}

model ListColleaguesAtEmployerRequest { org_domain: string; pagination_key?: string; limit?: int32; }
model ColleagueAtEmployer {
  handle:                Handle;
  display_name:          string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  current_employer_domain: string;     // which of the org's domains they're currently at
  current_stint_started_at: utcDateTime;
}
model ListColleaguesAtEmployerResponse { colleagues: ColleagueAtEmployer[]; next_pagination_key?: string; }

model NetworkOpportunity {
  org_domain:        string;
  org_name:          string;
  colleague_count:   int32;
  most_recent_colleague_started_at: utcDateTime;
  openings:          HubOpeningCard[];   // ≤3
}
model ListNetworkOpportunitiesResponse { opportunities: NetworkOpportunity[]; }

@route("/hub/list-openings")
@post op hubListOpenings(...HubListOpeningsRequest): OkResponse<HubListOpeningsResponse>;

@route("/hub/get-opening")
@post op hubGetOpening(...HubGetOpeningRequest): OkResponse<HubOpeningDetail> | NotFoundResponse;

@route("/hub/list-colleagues-at-employer")
@post op listColleaguesAtEmployer(...ListColleaguesAtEmployerRequest):
  OkResponse<ListColleaguesAtEmployerResponse> | NotFoundResponse;

@route("/hub/list-network-opportunities")
@post op listNetworkOpportunities(): OkResponse<ListNetworkOpportunitiesResponse>;
```

### File: `specs/typespec/hub/apply-preferences.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model HubApplyPreferences {
  notify_connections_on_apply:    boolean;
  allow_unsolicited_endorsements: boolean;
}
model SetNotifyConnectionsOnApplyRequest    { notify_connections_on_apply: boolean; }
model SetAllowUnsolicitedEndorsementsRequest { allow_unsolicited_endorsements: boolean; }

@route("/hub/get-apply-preferences")    @post getPrefs(): OkResponse<HubApplyPreferences>;
@route("/hub/set-notify-connections-on-apply")    @post setNotify(...SetNotifyConnectionsOnApplyRequest): OkResponse<{}>;
@route("/hub/set-allow-unsolicited-endorsements") @post setAllowUnsolicited(...SetAllowUnsolicitedEndorsementsRequest): OkResponse<{}>;
```

### File: `specs/typespec/org/applications.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/work-emails.tsp";
import "../hub/connections.tsp";
import "../hub/applications.tsp";   // ApplicationState, ApplicationColorLabel

using TypeSpec.Http;
namespace Vetchium;

model ListApplicationsRequest {
  opening_id:                string;
  filter_state?:             ApplicationState[];
  filter_label?:             ApplicationColorLabel[];
  filter_has_endorsements?:  boolean;
  filter_has_referral?:      boolean;
  pagination_key?:           string;
  limit?:                    int32;
}
model OrgApplicationSummary {
  application_id:    string;
  candidate_handle:  Handle;
  candidate_display_name: string;
  yoe_total:         int32;        // computed from candidate stints
  endorsement_count: int32;
  has_referral:      boolean;
  ai_score?:         decimal;
  state:             ApplicationState;
  label?:            ApplicationColorLabel;
  applied_at:        utcDateTime;
}
model ListApplicationsResponse { applications: OrgApplicationSummary[]; next_pagination_key?: string; }

model ApplicationIdRequest { application_id: string; }

model OrgVisibleEndorsement {
  endorsement_id:               string;
  endorser_handle:              Handle;
  endorser_display_name:        string;
  shared_domain:                string;
  overlap_start_year:           int32;
  overlap_end_year:             int32;
  current_connection_state:     ConnectionState;
  is_referral:                  boolean;
  is_unsolicited:               boolean;
  endorser_is_current_employee: boolean;     // active stint at hiring org
  text:                         string;
  written_at:                   utcDateTime;
  edited_at?:                   utcDateTime;
}

model OrgApplication {
  application_id:        string;
  opening_id:            string;
  candidate_handle:      Handle;
  candidate_display_name: string;
  candidate_short_bio?:  string;
  candidate_employer_stints: PublicEmployerStint[];
  cover_letter:          string;
  resume_download_url:   string;    // signed, TTL 5 min, in opening's region S3
  ai_score?:             decimal;
  state:                 ApplicationState;
  label?:                ApplicationColorLabel;
  applied_at:            utcDateTime;
  state_changed_at:      utcDateTime;
  endorsements:          OrgVisibleEndorsement[];   // hidden-by-candidate excluded
  notify_colleagues_used: boolean;
}

model ShortlistApplicationRequest { application_id: string; }
model RejectApplicationRequest    { application_id: string; rejection_reason?: string; /* 0..2000, internal */ }
model LabelApplicationRequest     { application_id: string; label?: ApplicationColorLabel; /* unset clears */ }

@route("/org/list-applications") @post listOrgApplications(...ListApplicationsRequest):
  OkResponse<ListApplicationsResponse> | BadRequestResponse;

@route("/org/get-application") @post getOrgApplication(...ApplicationIdRequest):
  OkResponse<OrgApplication> | NotFoundResponse;

@route("/org/shortlist-application") @post shortlistApplication(...ShortlistApplicationRequest):
  OkResponse<{ candidacy_id: string }> | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/reject-application") @post rejectApplication(...RejectApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/label-application") @post labelApplication(...LabelApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/org/candidacies.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/candidacies.tsp";   // CandidacyState, etc.

using TypeSpec.Http;
namespace Vetchium;

model ListCandidaciesRequest {
  filter_opening_id?:  string;
  filter_state?:       CandidacyState[];
  pagination_key?:     string;
  limit?:              int32;
}
model OrgCandidacySummary {
  candidacy_id:        string;
  application_id:      string;
  opening_id:          string;
  candidate_handle:    Handle;
  candidate_display_name: string;
  state:               CandidacyState;
  scheduled_interview_count: int32;
  created_at:          utcDateTime;
  state_changed_at:    utcDateTime;
}
model ListCandidaciesResponse { candidacies: OrgCandidacySummary[]; next_pagination_key?: string; }

model CandidacyIdRequest { candidacy_id: string; }

model OrgCandidacy {
  candidacy_id:        string;
  application_id:      string;
  opening_id:          string;
  opening_title:       string;
  candidate_handle:    Handle;
  candidate_display_name: string;
  state:               CandidacyState;
  created_at:          utcDateTime;
  state_changed_at:    utcDateTime;
  interviews:          OrgInterviewSummary[];
  comments:            CandidacyComment[];
  offer?:              OrgOfferView;
}

model OrgInterviewSummary {
  interview_id:   string;
  interview_type: InterviewType;
  starts_at:      utcDateTime;
  ends_at:        utcDateTime;
  state:          InterviewState;
  interviewer_count: int32;
  candidate_rsvp?: InterviewRSVP;
  feedback_submitted_count: int32;
}

model OrgOfferView {
  extended_by_org_user_id: string;
  extended_at: utcDateTime;
  salary_currency?: string;
  salary_amount?: decimal;
  start_date?: plainDate;
  notes?: string;
  offer_letter_download_url: string;
}

model OrgAddCandidacyCommentRequest { candidacy_id: string; body: string; }

@route("/org/list-candidacies") @post orgListCandidacies(...ListCandidaciesRequest):
  OkResponse<ListCandidaciesResponse> | BadRequestResponse;

@route("/org/get-candidacy") @post orgGetCandidacy(...CandidacyIdRequest):
  OkResponse<OrgCandidacy> | NotFoundResponse;

@route("/org/add-candidacy-comment") @post orgAddCandidacyComment(...OrgAddCandidacyCommentRequest):
  CreatedResponse<{ comment_id: string }> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/org/interviews.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/candidacies.tsp";

using TypeSpec.Http;
namespace Vetchium;

union FeedbackDecision {
  StrongYes: "strong_yes",
  Yes:       "yes",
  Neutral:   "neutral",
  No:        "no",
  StrongNo:  "strong_no",
}

model ScheduleInterviewRequest {
  candidacy_id:            string;
  interview_type:          InterviewType;
  starts_at:               utcDateTime;
  ends_at:                 utcDateTime;
  description?:            string;       // 0..2000
  interviewer_email_addresses: string[]; // 1..5, must be active org users at the org
}
model ScheduleInterviewResponse { interview_id: string; }

model UpdateInterviewRequest {
  interview_id:  string;
  starts_at?:    utcDateTime;
  ends_at?:      utcDateTime;
  description?:  string;
}

model InterviewIdRequest { interview_id: string; }

model AddInterviewerRequest    { interview_id: string; org_user_email_address: string; }
model RemoveInterviewerRequest { interview_id: string; org_user_id: string; }

model SetInterviewerRSVPRequest { interview_id: string; rsvp: InterviewRSVP; }

model SubmitInterviewFeedbackRequest {
  interview_id:       string;
  decision:           FeedbackDecision;
  positives:          string;     // 1..4000
  negatives:          string;     // 1..4000
  overall_assessment: string;     // 1..4000
  candidate_feedback?: string;    // 0..2000
}

model InterviewerEntry {
  org_user_id:           string;
  org_user_email_address: string;
  display_name:          string;
  rsvp?:                 InterviewRSVP;
  feedback_submitted:    boolean;
}

model OrgInterview {
  interview_id:   string;
  candidacy_id:   string;
  interview_type: InterviewType;
  starts_at:      utcDateTime;
  ends_at:        utcDateTime;
  description?:   string;
  state:          InterviewState;
  candidate_rsvp?: InterviewRSVP;
  interviewers:   InterviewerEntry[];
  // Feedback section: visible only to org users (never candidate).
  // For each interviewer who has submitted, full feedback is included.
  feedback: {
    org_user_id:        string;
    decision:           FeedbackDecision;
    positives:          string;
    negatives:          string;
    overall_assessment: string;
    candidate_feedback?: string;
    submitted_at:       utcDateTime;
  }[];
}

model ListInterviewsRequest {
  filter_candidacy_id?: string;
  filter_state?:        InterviewState[];
  filter_starts_at_from?: utcDateTime;
  filter_starts_at_to?:   utcDateTime;
  pagination_key?:      string;
  limit?:               int32;
}
model ListInterviewsResponse { interviews: OrgInterviewSummary[]; next_pagination_key?: string; }

@route("/org/schedule-interview") @post scheduleInterview(...ScheduleInterviewRequest):
  CreatedResponse<ScheduleInterviewResponse> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/update-interview")   @post updateInterview(...UpdateInterviewRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/cancel-interview")   @post cancelInterview(...InterviewIdRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/add-interviewer")    @post addInterviewer(...AddInterviewerRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/remove-interviewer") @post removeInterviewer(...RemoveInterviewerRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/rsvp-interview")     @post orgRsvpInterview(...SetInterviewerRSVPRequest):
  OkResponse<{}> | { @statusCode statusCode: 403 } | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/submit-interview-feedback") @post submitInterviewFeedback(...SubmitInterviewFeedbackRequest):
  OkResponse<{}> | BadRequestResponse | { @statusCode statusCode: 403 } | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/list-interviews")    @post orgListInterviews(...ListInterviewsRequest):
  OkResponse<ListInterviewsResponse> | BadRequestResponse;
@route("/org/get-interview")      @post orgGetInterview(...InterviewIdRequest):
  OkResponse<OrgInterview> | NotFoundResponse;
```

### File: `specs/typespec/org/offers.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

// Multipart endpoint — the offer letter is uploaded with the request (max 10MB PDF).
@multipartBody
model ExtendOfferRequest {
  candidacy_id:       HttpPart<string>;
  offer_letter:       HttpPart<File>;
  salary_currency?:   HttpPart<string>;
  salary_amount?:     HttpPart<decimal>;
  start_date?:        HttpPart<plainDate>;
  notes?:             HttpPart<string>;
}

@route("/org/extend-offer") @post extendOffer(...ExtendOfferRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
```

### File: `specs/typespec/org/references.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/references.tsp";

using TypeSpec.Http;
namespace Vetchium;

model RequestReferencesRequest {
  candidacy_id:      string;
  max_references:    int32;            // 1..5
  response_deadline: plainDate;        // must be > today
  questions:         ReferenceQuestion[];   // 1..10
}

model RequestReferencesResponse { request_id: string; }

model RequestIdRequest { request_id: string; }

model OrgReferenceNomination {
  nomination_id:         string;
  nominee_handle:        Handle;
  nominee_display_name:  string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  state:                 ReferenceNominationState;
  nominated_at:          utcDateTime;
  submitted_at?:         utcDateTime;
}
model ListReferenceNominationsResponse { nominations: OrgReferenceNomination[]; }

model OrgReferenceResponse {
  nomination_id:   string;
  nominee_handle:  Handle;
  nominee_display_name: string;
  shared_domain:   string;
  overlap_start_year: int32;
  overlap_end_year:   int32;
  answers: { question_id: string; question_text: string; response_text: string; }[];
  submitted_at: utcDateTime;
}
model ListReferenceResponsesResponse { responses: OrgReferenceResponse[]; declined_nominations: OrgReferenceNomination[]; }

@route("/org/request-references") @post orgRequestReferences(...RequestReferencesRequest):
  CreatedResponse<RequestReferencesResponse> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/list-reference-nominations") @post orgListReferenceNominations(...RequestIdRequest):
  OkResponse<ListReferenceNominationsResponse> | NotFoundResponse;

@route("/org/list-reference-responses") @post orgListReferenceResponses(...RequestIdRequest):
  OkResponse<ListReferenceResponsesResponse> | NotFoundResponse;
```

### File: `specs/typespec/org/hiring-settings.tsp`

```typespec
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model OrgHiringSettings {
  cool_off_days: int32;       // 0..365
  allow_unsolicited_endorsements_default: boolean;
}
model UpdateOrgHiringSettingsRequest {
  cool_off_days: int32;
  allow_unsolicited_endorsements_default: boolean;
}

@route("/org/get-hiring-settings")    @post getHiringSettings():
  OkResponse<OrgHiringSettings>;
@route("/org/update-hiring-settings") @post updateHiringSettings(...UpdateOrgHiringSettingsRequest):
  OkResponse<{}> | BadRequestResponse;
```

### Watcher endpoints (in existing `specs/typespec/org/openings.tsp` — additions)

```typespec
model AddWatcherRequest    { opening_id: string; org_user_email_address: string; }
model RemoveWatcherRequest { opening_id: string; org_user_id: string; }

@route("/org/add-watcher")    @post addWatcher(...AddWatcherRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/remove-watcher") @post removeWatcher(...RemoveWatcherRequest):
  OkResponse<{}> | NotFoundResponse;
```

---

Vetchium does not have a separate "in-app notification" subsystem. All notifications are emails delivered via the existing queue: `INSERT INTO emails (...)` inside the primary regional transaction; the regional worker picks the row up and sends. This spec only adds new rows; it does not change the queue or worker.

### New `email_template_type` enum values

The `email_template_type` enum (regional DB, in `specs/typespec/.../initial_schema.sql`) gains these values. Add via `ALTER TYPE email_template_type ADD VALUE` at the bottom of the existing enum block in the initial schema file. Names follow `{portal}_{event}` convention:

| New value                                 | Triggered by                                            | Sent to                                |
| ----------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `hub_endorsement_request`                 | `/hub/apply-for-opening` or `/hub/request-endorsements` | each endorser (hub email address)      |
| `hub_endorsement_written`                 | `/hub/write-endorsement` (request resolved)             | the candidate                          |
| `hub_referral_received`                   | `/hub/nominate-colleague-for-role`                      | the candidate                          |
| `hub_reference_request_received`          | `/org/request-references`                               | the candidate                          |
| `hub_reference_nomination_received`       | `/hub/nominate-references`                              | each nominee                           |
| `hub_reference_nomination_accepted`       | `/hub/accept-reference-nomination`                      | the candidate                          |
| `hub_application_shortlisted`             | `/org/shortlist-application`                            | the candidate                          |
| `hub_application_rejected`                | `/org/reject-application`                               | the candidate                          |
| `hub_interview_scheduled`                 | `/org/schedule-interview`                               | the candidate                          |
| `hub_interview_updated`                   | `/org/update-interview`                                 | the candidate                          |
| `hub_interview_cancelled`                 | `/org/cancel-interview` or auto-cancel on offer extend  | the candidate                          |
| `hub_offer_extended`                      | `/org/extend-offer`                                     | the candidate                          |
| `hub_colleague_applied_alert`             | `/hub/apply-for-opening` (with opt-in)                  | each connected colleague at target org |
| `org_new_application`                     | `/hub/apply-for-opening`                                | each opening watcher                   |
| `org_application_withdrawn`               | `/hub/withdraw-application`                             | each opening watcher                   |
| `org_interview_scheduled_for_interviewer` | `/org/schedule-interview` / `add-interviewer`           | each interviewer                       |
| `org_interview_updated_for_interviewer`   | `/org/update-interview`                                 | each interviewer                       |
| `org_interview_cancelled_for_interviewer` | `/org/cancel-interview`                                 | each interviewer                       |
| `org_interviewer_removed`                 | `/org/remove-interviewer`                               | the removed interviewer                |
| `org_offer_extended_for_watcher`          | `/org/extend-offer`                                     | each opening watcher                   |

### Email body conventions

For every type above, body is constructed in the handler using `fmt.Sprintf` against a template literal embedded in the handler (matches the existing pattern in `internal/email/`). No template engine is introduced. Subject and body keys for each type:

```
hub_endorsement_request:
  subject: "{endorser_display_name}, your former colleague {candidate_display_name} asked you to endorse them"
  text_body: "Hi {endorser_display_name},
              {candidate_display_name} ({candidate_handle}) just applied for {opening_title} at {org_name}
              and asked you for an endorsement.
              You worked together at {shared_domain} from {start_year} to {end_year}.
              {optional candidate note}
              Open Vetchium to write the endorsement: {hub_url}/endorsement-requests/{request_id}/write
              You can decline silently — no notification is sent to {candidate_handle}."

hub_application_shortlisted:
  subject: "You've been shortlisted for {opening_title} at {org_name}"
  text_body: "Your application is now under interview consideration.
              Open your candidacy: {hub_url}/my-candidacies/{candidacy_id}"

...

org_new_application:
  subject: "New application: {candidate_handle} for {opening_title}"
  text_body: "{candidate_handle} just applied. {endorsement_count} endorsements attached.
              Open: {org_url}/openings/{opening_id}/applications/{application_id}"
```

Full set of subject/body templates is implemented in `api-server/handlers/{hub,org}/email_templates.go` (new file). Each template is a top-level `const` so it can be reviewed and unit-tested independently. Tests assert the rendered output verbatim.

### Email enqueue pattern (boilerplate the implementer should copy)

```go
// Inside the same WithRegionalTx that creates the primary row:
emailBody := fmt.Sprintf(emailTemplates.HubEndorsementRequestBody, endorser.DisplayName, candidate.DisplayName, /* ... */)
if err := qtx.InsertEmail(ctx, regionaldb.InsertEmailParams{
    EmailType:     regionaldb.EmailTemplateTypeHubEndorsementRequest,
    EmailTo:       endorser.EmailAddress,
    EmailSubject:  fmt.Sprintf(emailTemplates.HubEndorsementRequestSubject, /* ... */),
    EmailTextBody: emailBody,
    EmailHtmlBody: emailBody, // plain text duplicated into html — existing pattern
}); err != nil {
    return err
}
```

If multiple recipients (e.g., watchers, multiple interviewers), use a bulk insert helper `InsertEmailsBulk` (new sqlc query, single `INSERT ... VALUES (...), (...), ...`). Do **not** loop with individual inserts inside a transaction.

### Cross-region notification routing

For `hub_colleague_applied_alert`: the candidate's connection list lives in the candidate's home region (where their `hub_connections` rows are). The opening lives in the opening's region. The notification email is sent from the opening's region because that's where the application row is and where the enqueueing transaction runs. Email destination is the colleague's email address (already in regional `hub_users` of opening's region only if the colleague's home region IS the opening's region).

This means: to fan out notifications to colleagues whose home region != opening's region, the apply handler needs to perform a **read** against each region's `hub_users` table to fetch email addresses. To stay within "one round-trip per logical DB" the implementation uses:

1. Global lookup: `SELECT hub_user_global_id, home_region FROM applications_index_connections` — actually simpler: use the existing global `hub_users` routing table to map `hub_user_global_id` → `home_region` + `email_hash` (cannot get plaintext email from global). Then group connections by `home_region`.
2. For each region (max 3) one regional query: `SELECT hub_user_global_id, full_name, email_address FROM hub_users WHERE hub_user_global_id = ANY($1)`.
3. Enqueue email rows in the **opening's region** `emails` table (the email queue belongs to the region the action originated in — the worker in that region delivers them).

This is acceptable because the apply handler already touches global DB (for opening lookup + applications_index write); the cross-region reads are bounded and infrequent (only when `notify_colleagues_at_target=true`).

---

## Algorithm Resolutions

### "Primary domain" of an org

Use `org_domains.is_primary = TRUE` from the global DB. Exactly one such row exists per org (enforced by partial unique index in the existing schema). This is the domain shown to candidates on the opening listing and detail pages.

### "Colleague at this company" — which domains count?

A connection P1 counts as "at company X" if P1 has any `work_email_stints` row with `status='active'` and `domain` matching **any** `org_domains.domain` whose `org_id` = X's org_id. The query joins `hub_connections` × `work_email_stints` × `org_domains` filtering by `org_id`. This handles orgs that own multiple verified domains.

### Network-opportunities ranking

Given a viewer hub user U:

1. Collect U's `connected` connections (regional query, U's home region).
2. For each connection, find domains with `work_email_stints.status='active'`.
3. Group by `org_id` (one global query against `org_domains` to map domain → org_id).
4. Exclude orgs where U themselves has an `active` stint (U's own current employer).
5. For each remaining org, query that org's region for up to 3 `published` openings ordered by `first_published_at DESC` (most recently published first).
6. Return up to **20 orgs**, ordered by:
   - **Primary**: count of viewer's connections currently at that org (DESC) — more colleagues = warmer
   - **Secondary**: most recent connection start_at among those colleagues (DESC) — recently moved colleague signals current relevance
   - **Tertiary**: org name ASC (tie-breaker)

The cap of 20 orgs and 3 openings per org bounds the response payload to ≤60 openings. Cached on the client for 60s; recomputed on every fresh load.

### Opening's region resolution

For any inbound hub-side request that references an opening, the resolution is:

1. Look up `org_domains` (global DB) by `domain` → `org_id`.
2. Look up `orgs` (global DB) by `org_id` → `home_region`.
3. Use `s.RegionalPoolFor(home_region)` to access the opening's region.

Both lookups can be merged into a single global query joining the two tables.

### Endorsement "relationship context" snapshot

At endorsement-write time, snapshot:

- `shared_domain` — the verified domain at which both the endorser and the candidate had a stint (the choice of which domain when both worked together at multiple is: the domain with the longest overlap; ties broken by most recent).
- `overlap_start_year` — `MAX(endorser.start_year, candidate.start_year)`.
- `overlap_end_year` — `MIN(endorser.end_year, candidate.end_year)`. If either has `is_current=true` and stint at the chosen domain, use the current year.

These three fields are written into the `endorsements` row and never recomputed. They survive disconnection / stint changes.

---

## Open Questions Carried Forward

- **Q1 (from connection-enhanced-hiring.md)**: endorsement lifecycle on falling out — RESOLVED: endorsement persists after disconnect, badge surfaced; candidate can hide on own application.
- **Q2**: endorsements across applications — RESOLVED: application-specific only; no reuse, no standing profile endorsements in this scope.
- **Q3**: colleague count performance — RESOLVED: count computed in `list-openings` via single CTE that joins viewer's connections × active stints at opening's primary domain; names lazy-loaded via separate call.
- **Q4**: endorsements after disconnection — RESOLVED above.
- **Q5**: referral bonus tracking — out of scope; the `referral_nominations` row records that a referral led to a hire (when `accepted_applied` and resulting candidacy state reaches a hire-equivalent terminal), available to org via a future analytics endpoint.
- **Q6**: connection depth self-declaration — out of scope for v1; revisit after observing real endorsement quality.

## Implementation Tranches

This spec is too large to land as a single PR. Implementation proceeds in 4 tranches with a strict order: each tranche **only depends on the previous tranches and code already merged**. Each tranche ships as its own PR with its own tests, behind no feature flag (matches project POC philosophy in MEMORY).

Within each tranche, the order of work is fixed: (1) TypeSpec → (2) DB schema → (3) sqlc queries → (4) Go handlers → (5) audit log + email enqueue wiring → (6) frontend pages → (7) Playwright tests. Do not start step N+1 until step N compiles or runs.

### Tranche T1 — Foundation: applications + candidacies + hiring settings

**Scope (12 endpoints):**

- `POST /hub/apply-for-opening` (multipart)
- `POST /hub/withdraw-application`
- `POST /hub/list-my-applications`
- `POST /hub/get-my-application`
- `POST /hub/list-my-candidacies`
- `POST /hub/get-my-candidacy`
- `POST /hub/add-candidacy-comment`
- `POST /org/list-applications`
- `POST /org/get-application`
- `POST /org/shortlist-application`
- `POST /org/reject-application`
- `POST /org/label-application`
- `POST /org/list-candidacies`
- `POST /org/get-candidacy`
- `POST /org/add-candidacy-comment`
- `POST /org/get-hiring-settings`
- `POST /org/update-hiring-settings`
- `POST /hub/list-openings`
- `POST /hub/get-opening`
- `POST /hub/get-apply-preferences`
- `POST /hub/set-notify-connections-on-apply`
- `POST /hub/set-allow-unsolicited-endorsements`

**TypeSpec files created:** `hub/applications.tsp`, `hub/candidacies.tsp`, `hub/hiring-discovery.tsp`, `hub/apply-preferences.tsp`, `org/applications.tsp`, `org/candidacies.tsp`, `org/hiring-settings.tsp` (+ matching `.ts` + `.go`).

**Tables created (regional):** `org_hiring_settings`, `applications`, `candidacies`, `candidacy_comments`, `hub_apply_preferences`. Plus enum additions for `email_template_type`: `hub_application_shortlisted`, `hub_application_rejected`, `org_new_application`, `org_application_withdrawn`. Tables created (global): `applications_index`.

**Roles added:** `org:view_applications`, `org:manage_applications`, `org:manage_candidacies`, `org:view_hiring_settings`, `org:manage_hiring_settings`. (All three locations: `roles.ts`, `roles.go`, regional initial schema `INSERT INTO roles`.)

**Handler files created:**

```
api-server/handlers/hub/applications.go
api-server/handlers/hub/candidacies.go
api-server/handlers/hub/preferences.go
api-server/handlers/hub/openings.go             (new — hub-side browse)
api-server/handlers/hub/email_templates.go      (new — template constants)
api-server/handlers/org/applications.go
api-server/handlers/org/candidacies.go
api-server/handlers/org/hiring_settings.go
api-server/handlers/org/email_templates.go
```

**Frontend pages (hub-ui):**

```
src/pages/openings/OpeningsListPage.tsx
src/pages/openings/OpeningDetailPage.tsx
src/pages/openings/ApplyForOpeningPage.tsx
src/pages/applications/MyApplicationsPage.tsx
src/pages/applications/MyApplicationDetailPage.tsx
src/pages/candidacies/MyCandidaciesPage.tsx
src/pages/candidacies/MyCandidacyDetailPage.tsx
src/pages/settings/ApplyPreferencesPage.tsx
```

**Frontend pages (org-ui):**

```
src/pages/applications/ApplicationsListPage.tsx
src/pages/applications/ApplicationDetailPage.tsx
src/pages/candidacies/CandidaciesListPage.tsx
src/pages/candidacies/CandidacyDetailPage.tsx
src/pages/settings/HiringSettingsPage.tsx
```

**Playwright tests created:**

```
playwright/tests/api/hub/applications/apply.spec.ts            (single happy path + 15 negative)
playwright/tests/api/hub/applications/withdraw.spec.ts
playwright/tests/api/hub/applications/list-my.spec.ts
playwright/tests/api/hub/applications/get-my.spec.ts
playwright/tests/api/hub/candidacies/list-my.spec.ts
playwright/tests/api/hub/candidacies/get-my.spec.ts
playwright/tests/api/hub/candidacies/comment.spec.ts
playwright/tests/api/hub/openings/list.spec.ts                 (incl. colleague count)
playwright/tests/api/hub/openings/get.spec.ts
playwright/tests/api/hub/preferences/set.spec.ts
playwright/tests/api/org/applications/list.spec.ts             (incl. RBAC pos/neg)
playwright/tests/api/org/applications/get.spec.ts              (incl. RBAC pos/neg)
playwright/tests/api/org/applications/shortlist.spec.ts        (incl. RBAC pos/neg, superadmin)
playwright/tests/api/org/applications/reject.spec.ts           (incl. RBAC pos/neg)
playwright/tests/api/org/applications/label.spec.ts            (incl. RBAC pos/neg)
playwright/tests/api/org/candidacies/list.spec.ts
playwright/tests/api/org/candidacies/get.spec.ts
playwright/tests/api/org/candidacies/comment.spec.ts           (incl. RBAC pos/neg)
playwright/tests/api/org/hiring-settings/get.spec.ts           (incl. RBAC pos/neg)
playwright/tests/api/org/hiring-settings/update.spec.ts        (incl. RBAC pos/neg)
playwright/tests/api/cross-cutting/region-isolation.spec.ts    (apps in ind1 invisible from usa1 except via global index)
playwright/tests/api/cross-cutting/privacy-current-employer.spec.ts
```

**Acceptance for T1 sign-off:** all listed Playwright tests pass; `goimports`, `bun run lint`, and `tsp compile` pass; coverage of every audit-log scenario (positive + 4xx absence) confirmed.

### Tranche T2 — Interviews + offers

**Scope (10 endpoints):**

- `POST /org/schedule-interview`
- `POST /org/update-interview`
- `POST /org/cancel-interview`
- `POST /org/add-interviewer`
- `POST /org/remove-interviewer`
- `POST /org/list-interviews`
- `POST /org/get-interview`
- `POST /org/rsvp-interview`
- `POST /org/submit-interview-feedback`
- `POST /org/extend-offer` (multipart)
- `POST /hub/rsvp-interview`
- `POST /org/add-watcher`, `POST /org/remove-watcher` (if not already implemented for openings)

**TypeSpec files created:** `org/interviews.tsp`, `org/offers.tsp` (+ matching `.ts` + `.go`). Extension of `org/openings.tsp` for watcher endpoints if needed.

**Tables created (regional):** `interviews`, `interview_interviewers`, `interview_feedback`, `offers`. Enum additions: `hub_interview_scheduled`, `hub_interview_updated`, `hub_interview_cancelled`, `hub_offer_extended`, `org_interview_scheduled_for_interviewer`, `org_interview_updated_for_interviewer`, `org_interview_cancelled_for_interviewer`, `org_interviewer_removed`, `org_offer_extended_for_watcher`.

**Roles added:** none (all reuse `org:manage_candidacies` from T1; interviewer-membership checks are in-handler).

**Handler files created:** `api-server/handlers/org/interviews.go`, `api-server/handlers/org/offers.go`, `api-server/handlers/hub/interviews.go`.

**Frontend pages (hub-ui):** none new — the existing `MyCandidacyDetailPage.tsx` from T1 grows interview/offer sections.

**Frontend pages (org-ui):** `ScheduleInterviewPage.tsx`, `FeedbackPage.tsx`, `ExtendOfferPage.tsx`.

**Tests:** full matrix from `Test Matrix` section above for interviews + offers, including the **superadmin-cannot-submit-feedback** invariant.

### Tranche T3 — Endorsements + referrals

**Scope (12 endpoints):**

- `POST /hub/request-endorsements`
- `POST /hub/list-endorsement-requests-incoming`
- `POST /hub/list-endorsement-requests-outgoing`
- `POST /hub/write-endorsement`
- `POST /hub/update-endorsement`
- `POST /hub/decline-endorsement-request`
- `POST /hub/hide-endorsement-on-application`
- `POST /hub/show-endorsement-on-application`
- `POST /hub/nominate-colleague-for-role`
- `POST /hub/list-referrals-received`
- `POST /hub/list-referrals-made`
- `POST /hub/accept-referral`
- `POST /hub/decline-referral`

**TypeSpec files created:** `hub/endorsements.tsp`, `hub/referrals.tsp`.

**Tables created (regional):** `endorsement_requests`, `endorsements`, `referral_nominations`. Tables (global): `endorsement_requests_index`, `referral_nominations_index`. Enum additions: `hub_endorsement_request`, `hub_endorsement_written`, `hub_referral_received`.

**Roles added:** none (all owner-only / connection-based gates in-handler).

**Handler files created:** `api-server/handlers/hub/endorsements.go`, `api-server/handlers/hub/referrals.go`.

**Backward-edit to T1 code:**

- `apply-for-opening` handler grows the endorsement-request-creation step (was a no-op in T1, now creates rows in `endorsement_requests`).
- `OrgApplication` model (T1) grows the `endorsements` field (was empty in T1, now populated from `endorsements` table).
- `HubApplication` model (T1) grows `endorsements` and `endorsement_requests` (were empty in T1).
- T1's tests are updated to assert the empty arrays before T3 lands and the populated arrays after.

**Frontend pages (hub-ui):** `EndorsementInboxPage.tsx`, `WriteEndorsementPage.tsx`, `ReferralInboxPage.tsx`, `NominateColleaguePage.tsx`. Plus extensions to T1's `ApplyForOpeningPage.tsx` (endorser MultiSelect) and `MyApplicationDetailPage.tsx` (endorsements section, hide/show buttons).

**Frontend pages (org-ui):** extends T1's `ApplicationDetailPage.tsx` with the endorsements section.

**Tests:** full matrix from `Test Matrix` section above for endorsements and referrals.

### Tranche T4 — Discovery + structured references

**Scope (11 endpoints):**

- `POST /hub/list-colleagues-at-employer`
- `POST /hub/list-network-opportunities`
- `POST /hub/list-reference-requests-incoming`
- `POST /hub/nominate-references`
- `POST /hub/accept-reference-nomination`
- `POST /hub/decline-reference-nomination`
- `POST /hub/submit-reference-response`
- `POST /org/request-references`
- `POST /org/list-reference-nominations`
- `POST /org/list-reference-responses`
- (Plus the `notify_colleagues_at_target` opt-in fanout in the existing T1 apply handler — turns from no-op to active.)

**TypeSpec files created:** `hub/references.tsp`, `org/references.tsp`. Extends `hub/hiring-discovery.tsp` (colleague-list endpoint already declared but its handler is implemented here).

**Tables created (regional):** `reference_requests`, `reference_nominations`, `reference_responses`. Tables (global): `reference_nominations_index`. Enum additions: `hub_reference_request_received`, `hub_reference_nomination_received`, `hub_reference_nomination_accepted`, `hub_colleague_applied_alert`.

**Roles added:** none.

**Handler files created:** `api-server/handlers/hub/references.go`, `api-server/handlers/hub/discovery.go`, `api-server/handlers/org/references.go`.

**Backward-edit:** the apply-for-opening handler in T1 was stubbed to ignore `notify_colleagues_at_target=true`; in T4 it becomes a real fanout (insert N rows in `emails` of type `hub_colleague_applied_alert`).

**Frontend pages (hub-ui):** `ColleaguesAtEmployerPage.tsx` (modal), `ReferenceInboxPage.tsx`, `RespondReferencePage.tsx`, dashboard tile `NetworkOpportunitiesCard.tsx`.

**Frontend pages (org-ui):** `RequestReferencesPage.tsx`, extends `CandidacyDetailPage.tsx` with references section.

**Tests:** full reference end-to-end (org → candidate nominates → nominees respond → org reads), discovery tests, and the cross-cutting `notify_colleagues_at_target` fan-out test.

### Dependency graph between tranches

```
T1  ─►  T2 (interviews/offers; needs candidacies)
T1  ─►  T3 (endorsements; needs applications + endorsement_requests created during apply)
T1  ─►  T4 (references; needs candidacies)
T3  ─►  T4 (for the apply-handler's notify-colleagues fan-out; T4 reuses the discovery infrastructure)
T2 and T3 can be developed in parallel after T1.
```

### Per-tranche definition of done

A tranche is done when, in addition to its own tests:

1. `cd specs/typespec && tsp compile .` succeeds with zero errors.
2. `cd api-server && sqlc generate && go build ./...` succeeds.
3. `cd hub-ui && bun run lint && bun run build`, same for `org-ui`.
4. `cd playwright && npm test` (full suite) passes — not just this tranche's tests.
5. Docker compose stack `docker-compose-ci.json` runs healthy.
6. Audit-log presence/absence assertions hold for every write endpoint in the tranche.
7. RBAC positive + negative tests pass for every protected endpoint in the tranche.

---

## Verification checklist (proves the spec is internally consistent)

This section is the result of a second-pass review. It cross-checks that every requirement traces to a backend element, every state is reachable and exitable, and every persona surface is covered.

**State machines, each verified exitable and traceable**

- Application: `applied → {shortlisted, rejected, withdrawn, expired}`. Reachable from `apply-for-opening`; exits via shortlist (org), reject (org), withdraw (hub), expire (system; not active in v1 but column ready).
- Candidacy: `interviewing → {offered, candidate_unsuitable, candidate_not_responding, employer_defunct}`; from `offered → {offer_accepted, offer_declined}`. v1 implements only `interviewing → offered`; the other transitions are defined as states with no action endpoints, matching `hiring-flow.md`.
- Interview: `scheduled → {completed, cancelled}`. Reachable via `schedule-interview`; exits via `submit-interview-feedback` (→completed) or `cancel-interview` / `extend-offer` (→cancelled).
- Endorsement request: `pending → {written, declined, expired}`. Note: no automatic expiry timer in v1 — `expired` is reserved for a future sweep job.
- Referral nomination: `pending → {accepted_applied, declined, expired}`. Expiry at 30 days (default, not configurable in v1).
- Reference nomination: `nominated → {accepted, declined, expired}`; from `accepted → {submitted, expired}`. Expiry tied to request's `response_deadline`.

**RBAC matrix (one row per protected endpoint, confirmed)**

| Endpoint                                      | View role                      | Write role                       | Bypass           |
| --------------------------------------------- | ------------------------------ | -------------------------------- | ---------------- |
| `/org/list-applications`                      | `org:view_applications`        | —                                | `org:superadmin` |
| `/org/get-application`                        | `org:view_applications`        | —                                | `org:superadmin` |
| `/org/shortlist-application`                  | —                              | `org:manage_applications`        | `org:superadmin` |
| `/org/reject-application`                     | —                              | `org:manage_applications`        | `org:superadmin` |
| `/org/label-application`                      | —                              | `org:manage_applications`        | `org:superadmin` |
| `/org/list-candidacies`                       | `org:view_applications`        | —                                | `org:superadmin` |
| `/org/get-candidacy`                          | `org:view_applications`        | —                                | `org:superadmin` |
| `/org/add-candidacy-comment`                  | —                              | `org:manage_candidacies`         | `org:superadmin` |
| `/org/schedule-interview` & siblings          | —                              | `org:manage_candidacies`         | `org:superadmin` |
| `/org/rsvp-interview`                         | (interviewer membership)       | (interviewer membership)         | **NO bypass**    |
| `/org/submit-interview-feedback`              | (interviewer membership)       | (interviewer membership)         | **NO bypass**    |
| `/org/extend-offer`                           | —                              | `org:manage_candidacies`         | `org:superadmin` |
| `/org/request-references`                     | —                              | `org:manage_candidacies`         | `org:superadmin` |
| `/org/list-reference-{nominations,responses}` | `org:view_applications`        | —                                | `org:superadmin` |
| `/org/get-hiring-settings`                    | `org:view_hiring_settings`     | —                                | `org:superadmin` |
| `/org/update-hiring-settings`                 | —                              | `org:manage_hiring_settings`     | `org:superadmin` |
| `/org/add-watcher` / `/org/remove-watcher`    | —                              | `org:manage_openings` (existing) | `org:superadmin` |
| `/hub/apply-for-opening`                      | —                              | `hub:apply_jobs`                 | none             |
| `/hub/initiate-resume-upload`                 | —                              | `hub:apply_jobs`                 | none             |
| All other `/hub/*` endpoints listed           | owner-only enforced in handler | owner-only enforced in handler   | none             |

**Privacy invariants, each backed by a specific test**

| Invariant                                                                           | Test                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Candidate's current employer never learns of the candidate's applications elsewhere | Cross-cutting test "Privacy invariant — current employer"                                              |
| Org cannot enumerate candidate's connections                                        | No endpoint returns this; verified by API surface review                                               |
| Endorser-declined endorsements are invisible to candidate AND org                   | `decline-endorsement-request` test                                                                     |
| Org cannot read endorsements hidden by candidate                                    | `hide-endorsement-on-application` test                                                                 |
| Endorser cannot see other endorsers on the same application                         | Hub `get-my-application` exposes own endorsements only; org-side endpoints not accessible to endorsers |
| Reference responses are invisible to the candidate                                  | Hub has no endpoint to fetch reference responses on own candidacy                                      |
| Referrer sees binary applied-or-not, not application state                          | `list-referrals-made` response shape                                                                   |

**Data placement (ADR-001 §1.4 + §7 alignment)**

- All hiring rows in opening's region. ✓
- Global index tables only for hub-user-centric lookups across regions. ✓
- Compensating transactions for cross-DB writes. ✓
- No cross-region joins; only bulk lookups by primary key. ✓
- All list endpoints keyset-paginated. ✓
- One round-trip per logical DB per handler (assertion repeated in handler reviews). ✓

**Persona-surface completeness (every acceptance criterion has an endpoint)**

| Persona           | Surface area covered?                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate         | Discovery, apply, withdraw, list/get applications and candidacies, RSVP, comment, hide/show endorsements, nominate references, accept referrals, set preferences |
| Endorser          | List requests, write/update/decline, plus unsolicited-with-opt-in                                                                                                |
| Referrer          | List employer openings, nominate, list nominations made                                                                                                          |
| Reference         | List incoming nominations, accept/decline, submit response                                                                                                       |
| Recruiter/HM/Team | List/get applications + candidacies, shortlist/reject/label, comment, interview scheduling stack, extend offer, request references                               |
| Interviewer       | RSVP, submit feedback (membership-gated)                                                                                                                         |
| Watcher           | Notifications only; managed via existing openings handlers                                                                                                       |
| Admin             | (No new admin surface in this spec)                                                                                                                              |

**Confirmed: no ambiguous behaviors remain.** All "what happens if…" branches traced above are answered either in the acceptance criteria, the concurrency notes, the SQL constraints, or the explicit out-of-scope list.

---

## Things explicitly out of scope (carried forward)

- AI scoring engine (field is exposed but populated by a stub returning NULL).
- Candidate ranking by network size.
- AI-generated or template endorsements.
- Recruiter outreach through the colleague network without candidate consent.
- Candidacy terminal-state action endpoints other than offer-extension (offer_accepted/declined/etc. defined as states; action endpoints in a follow-up spec).
- Bonus/incentive tracking for referrals.
- Standing profile endorsements (separate model).
