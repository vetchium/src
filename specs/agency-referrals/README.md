## Stage 1: Requirements

Status: APPROVED
Authors: @
Dependencies: Marketplace v2 (`staffing` capability, listings, subscriptions), Job Openings, Applications

### Overview

This feature replaces the current colleague-nomination Referrals (a Hub user referring a
connected former colleague) with an **agency-based referral model** built on the existing
marketplace. A staffing-services Org publishes a marketplace listing carrying the `staffing`
capability; a hiring Org subscribes to it (both already supported). The hiring Org may then
**assign** one or more of its actively-subscribed staffing providers as **official agencies on
a specific published opening**. Users of an assigned agency Org can **refer a HubUser into that
opening** — with **no colleague / stint / connection prerequisite**. The referred HubUser sees
the referral in their inbox and either **applies through the agency** (acceptance is implicit in
applying) or **declines**.

**Attribution is candidate-consented, not first-come.** Multiple assigned agencies may refer
the **same** candidate to the **same** opening — each referral is a timestamped, pending claim.
The candidate decides which one (if any) to use **at apply time**: they pick exactly one
agency, or apply directly. Only the chosen agency is attributed. Making attribution depend on
the candidate's pick — rather than on who referred first — removes the incentive for an agency
to mass-refer every candidate to lock out competitors (a mass referral that the candidate never
picks earns nothing). The resulting application carries an immutable **attribution record**
(chosen agency or "direct") and displays a **"Represented by {agency}"** badge to the hiring
team, who can also **filter applications by agency**.

**Leakage handling (candidate sourced by an agency but applies directly).** Direct application
is always allowed; the platform stays neutral and does not adjudicate off-platform sourcing.
But if pending referrals exist for that opening and the candidate chooses "direct," they must
affirm _"no agency referred me to this role"_ (logged with timestamps), and every agency that
referred them is notified. This turns silent leakage into a recorded, deliberate statement and
gives the agency a timestamped record to enforce its own off-platform agreement. To let an Org
avoid spam entirely, an opening can optionally be set to **agency-only**: direct applications
are blocked and the only way to apply is via an assigned agency's referral.

The hub-ui opening page surfaces the **official agencies recruiting for the role** (and, for
agency-only openings, that direct application is not accepted). Portals affected: **Org**
(consumer assigns agencies + sets application mode + reviews/filters applications; agency
refers) and **Hub** (candidate sees referrals, selects agency or direct at apply time, declines,
opening page badge).

Assumptions (made to avoid blocking; revise if wrong):

- Agency assignment and referral both require the opening to be **published**. An
  agency may not be assigned to an opening owned by its **own** org.
- An agency assignment is valid only while the consumer→provider staffing subscription is
  **active**; cancelling the subscription blocks new referrals but does not delete past ones.
- The agency refers a candidate by **HubUser handle** (the future AI candidate-pool sourcing is
  explicitly out of scope for this spec). The handle must resolve to a Hub user.
- Attribution is **locked at application** on the candidate's selection + referral record; the
  consumer org cannot unilaterally null it (it is the paying party). Disputes are an
  out-of-platform process using the audit trail as evidence — no in-app dispute UI in this spec.
- Vetchium takes no fee and processes no placement payment (per the marketplace billing model);
  this feature produces the **attribution record** the agency invoices against off-platform.
- The existing, never-populated `applications.is_referral` / `applications.referral_id` columns
  and the org TypeSpec fields `has_referral` / `filter_has_referral` / `is_referral` are
  **repurposed**, not duplicated: `referral_id` → the chosen referral / agency attribution,
  `filter_has_referral` → `filter_agency`. No second parallel "referral" concept is introduced.
  Endorsements are otherwise unchanged.
- Referral **expiry is lazy** (computed from `expires_at` at read/action time, 30-day window as
  today) — no background expiry worker is in scope.

Out of scope (future phases): agency knowledge base of HubUsers, AI-assisted candidate
selection, priority/guaranteed review for agency-referred applications, and any in-app
attribution-dispute workflow.

### Acceptance Criteria

**Agency assignment (consumer Org)**

- [ ] A consumer Org user with the right role can assign a staffing provider it has an **active
      subscription** to as an agency on one of its **published** openings.
- [ ] Assigning a provider with no active staffing subscription is rejected (422/403).
- [ ] More than one agency can be assigned to the same opening.
- [ ] A consumer Org user can list and remove agencies assigned to an opening.
- [ ] Removing an agency stops new referrals from it but leaves already-submitted referrals
      intact.

**Application mode (consumer Org)**

- [ ] An opening can be set to `open` (direct + agency applications) or `agency_only` (direct
      applications blocked) at create time and via update.
- [ ] An `agency_only` opening with zero assigned agencies surfaces a warning to the Org (no one
      can apply).

**Referral creation (agency Org)**

- [ ] A user of an assigned agency Org can refer a HubUser (by handle) into an opening the
      agency is assigned to, with an optional statement — **no colleague/stint/connection
      check**.
- [ ] Referring into an opening the agency is **not** assigned to is rejected (403).
- [ ] **Multiple agencies may refer the same candidate to the same opening.** A second referral
      from a different agency is allowed (not 409). A duplicate **pending** referral from the
      **same** agency for the same candidate+opening is rejected (409). After the candidate has
      **declined** or the referral **expired**, the same agency may refer again (uniqueness is
      enforced only over the active/pending state).
- [ ] Referring a non-existent handle returns 404; a non-published opening returns 422.
- [ ] An agency user can list the referrals their agency has made, with current state
      (pending / accepted-selected / accepted-other-agency / declined / expired).
- [ ] An agency is **notified** when a candidate it referred applies — whether via this agency,
      another agency, or directly. Notifications are best-effort and post-commit (they never
      block or roll back the apply transaction).

**Candidate flow (Hub)**

- [ ] The referred HubUser sees, per opening, **all** agencies that referred them, each with
      agency name, opening, and statement.
- [ ] At apply time the candidate **picks exactly one** referring agency, or applies directly.
- [ ] If the candidate applies **directly** to an `open` opening while pending referrals exist,
      they must affirm "no agency referred me to this role"; the affirmation is logged and the
      referring agencies are notified.
- [ ] On an `agency_only` opening, a direct application is **rejected** (422) — the candidate
      must apply via an assigned agency.
- [ ] Declining a referral is silent (agency sees the state change; no candidate identity leak
      beyond what the referral already exposed).
- [ ] Referrals expire after a fixed window if not acted on (30 days, lazy — see assumptions).
- [ ] A pending referral becomes **un-actionable** once its opening leaves `published`
      (paused/closed/expired/archived): the candidate cannot apply via it (apply already requires
      a published opening), but the record is preserved and shown as such.
- [ ] The hub-ui opening detail page lists the **official recruiting agencies** for that opening
      and, for `agency_only` openings, states that direct application is not accepted.

**Attribution & hiring-team visibility (consumer Org)**

- [ ] Every application carries an immutable attribution record: the chosen agency, or "direct".
- [ ] An agency-attributed application shows a **"Represented by {agency}"** badge to the hiring
      team.
- [ ] The Org applications list can be **filtered by referring agency** (and by "direct").
- [ ] Attribution is locked at application; no endpoint lets the consumer Org rewrite it.

**RBAC & audit**

- [ ] New org roles (added to `roles.ts`, `roles.go`, and `initial_schema.sql`):
      consumer-side `org:manage_opening_agencies` / `org:view_opening_agencies`; agency-side
      `org:refer_candidates` / `org:view_agency_referrals`. Application-mode is set via the
      existing opening create/update endpoints under `org:manage_openings`.
- [ ] Every write endpoint enforces its role on the backend (403 for authenticated-no-role) and
      writes an audit log entry inside the same transaction.
- [ ] `org:superadmin` bypasses role checks on both consumer and agency sides.

**Teardown of old feature** (exact surface — confirmed against code)

- [ ] Remove handlers `api-server/handlers/hub/referrals.go` (all 5 functions) and the 5 routes
      at `hub-routes.go:100-104`.
- [ ] Remove TypeSpec `specs/typespec/hub/referrals.{tsp,ts,go}` (NominateColleague\*,
      ReferralReceived, ReferralMade, AcceptReferral\*).
- [ ] Replace tables `referral_nominations` (regional) + `referral_nominations_index` (global)
      with the new schema below; remove their old queries (`CreateReferral`, `GetReferralByID`,
      `ListReferralsByIDs`, `ResolveReferralDeclined`, `CheckReferrerHasActiveStintAtDomain`,
      `GetSharedWorkDomain`, and the old global index queries).
- [ ] hub-ui: delete `pages/referrals/NominatePage.tsx`; repurpose `ReferralInboxPage.tsx`;
      update `App.tsx` routes, `i18n.ts`, and `locales/{en-US,de-DE,ta-IN}/referrals.json`.
- [ ] Tests: rewrite `playwright/tests/api/hiring/referrals.spec.ts`, replace referral methods in
      `playwright/lib/hub-api-client.ts`, fix referral assertions in `lifecycle.spec.ts`.
- [ ] **Do NOT touch** the separate References feature (name collision): `reference_*` tables,
      `handlers/{hub,org}/references.go`, `specs/typespec/{hub,org}/references.*`,
      `db/regional/queries/reference_*.sql`.
- [ ] `accept-referral` is removed; acceptance is implicit in `apply-for-opening` via the chosen
      agency. The candidate inbox keeps `list-referrals-received` + `decline-referral`, repurposed
      so the referral's source is an **agency Org**, not a hub user. The apply page must build its
      form without the old prefill returned by `AcceptReferral` (opening detail already provides
      title/region; the referral statement is carried in the inbox response).

### User-Facing Screens

**Screen: Opening Agencies (consumer Org)**

Portal: org-ui | Route: `/openings/:openingNumber` (Agencies tab/section on the opening detail page)

```html
<section>
	<h3>Recruiting Agencies</h3>
	<table>
		<Column title="Agency" />
		<Column title="Assigned At" />
		<Column title="Referrals Made" />
		<Column title="Actions">Remove</Column>
	</table>
	<button>Assign Agency</button>
</section>
```

**Screen: Assign Agency (consumer Org)**

Triggered by: "Assign Agency" button on the opening detail page

```html
<form>
	<label>Agency (your active staffing subscriptions)</label>
	<select id="provider_org_domain" required>
		<!-- options populated from active staffing-capability subscriptions -->
	</select>
	<button type="submit">Assign</button>
</form>
```

**Screen: Application mode (consumer Org)** — field on the create/edit opening form

```html
<fieldset>
	<legend>Who can apply?</legend>
	<label
		><input type="radio" name="application_mode" value="open" checked /> Anyone
		(direct applications + agency referrals)</label
	>
	<label
		><input type="radio" name="application_mode" value="agency_only" /> Agencies
		only (direct applications blocked)</label
	>
	<!-- if agency_only and no agencies assigned: inline warning "No agency assigned — nobody can apply yet." -->
</fieldset>
```

**Screen: Refer Candidate (agency Org)**

Portal: org-ui | Route: `/referrals/new` (or an action on an assigned-opening list)

```html
<form>
	<label>Opening (openings your agency is assigned to)</label>
	<select id="opening" required></select>

	<label>Candidate handle (required)</label>
	<input type="text" id="candidate_handle" required />

	<label>Statement (optional, max 2000 chars)</label>
	<textarea id="statement_text" maxlength="2000"></textarea>

	<button type="submit">Refer</button>
</form>
```

**Screen: Applications list — agency filter (consumer Org)**

Portal: org-ui | Route: `/openings/:openingNumber` (applications section)

```html
<label>Source</label>
<select id="filter_agency">
	<option value="">All</option>
	<option value="direct">Direct</option>
	<!-- one option per agency assigned to this opening -->
</select>
<table>
	<Column title="Candidate" />
	<Column title="Source">Represented by {agency} | Direct</Column>
	<Column title="Status" />
	<Column title="Applied At" />
</table>
```

**Screen: Referrals Made (agency Org)**

Portal: org-ui | Route: `/referrals`

```html
<table>
	<Column title="Candidate" />
	<Column title="Opening" />
	<Column title="State" />
	<Column title="Referred At" />
</table>
```

**Screen: Referral Inbox (Hub candidate)** — repurposed existing page

Portal: hub-ui | Route: `/referrals`

Rows are grouped by opening, since multiple agencies may have referred the candidate to the
same opening.

```html
<table>
	<Column title="Company / Opening" />
	<Column title="Referred by">Agency A, Agency B</Column>
	<Column title="Statement" />
	<Column title="State" />
	<Column title="Actions">Apply (choose agency) | Decline</Column>
</table>
```

**Screen: Apply-time agency selection (Hub candidate)**

Portal: hub-ui | Route: `/org/:orgDomain/openings/:openingNumber/apply`

Shown when the candidate has one or more pending referrals for this opening.

```html
<fieldset>
	<legend>How are you applying?</legend>
	<!-- one radio per agency that referred this candidate to this opening -->
	<label
		><input type="radio" name="apply_via" value="agency:{domain}" /> Via Agency
		A</label
	>
	<label
		><input type="radio" name="apply_via" value="agency:{domain}" /> Via Agency
		B</label
	>
	<!-- 'direct' hidden when opening is agency_only -->
	<label
		><input type="radio" name="apply_via" value="direct" /> Directly (no
		agency)</label
	>

	<!-- shown only if 'direct' selected while referrals are pending -->
	<label
		><input type="checkbox" id="no_agency_affirmation" /> I confirm no agency
		referred me to this role.</label
	>
</fieldset>
```

**Screen: Opening detail — agency badge (Hub)**

Portal: hub-ui | Route: `/org/:orgDomain/openings/:openingNumber`

```html
<section>
	<p>Official recruiting agencies for this role:</p>
	<ul>
		<li>Agency A</li>
		<li>Agency B</li>
	</ul>
	<!-- if opening is agency_only -->
	<p>
		Direct applications are not accepted for this role — apply via one of the
		agencies above.
	</p>
</section>
```

### Data Placement & Cross-Region

The agency Org, the consumer Org (opening owner), and the candidate HubUser may each live in
**different home regions**. Placement follows ADR-001 and the CLAUDE.md rules (one round-trip
per logical DB; global-first then regional with compensation).

| Record                    | Home (authoritative)                                                                                | Global index                                                                                                         | Why                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Opening↔agency assignment | **Opening's region** (regional table keyed by `opening_id` + `agency_org_id` + `agency_org_domain`) | **Global** index keyed by `agency_org_id` → opening refs                                                             | Consumer lists in own region; the agency (other region) must list "openings my agency is assigned to" in one global read |
| Referral                  | **Opening's region** (regional; replaces `referral_nominations`)                                    | **Global** index keyed by **both** `candidate_hub_user_global_id` (inbox) and `agency_org_id` (agency's "made" list) | Candidate and agency are both potentially in other regions; mirrors today's `referral_nominations_index`                 |
| Attribution               | **Column on `applications`** (opening's region), set inside the apply tx                            | none                                                                                                                 | "Filter applications by agency" is then a single regional join; attribution is immutable with the application            |

Round-trip budgets:

- `refer-candidate`: **1 global read** (validate active staffing subscription + provider region +
  that this agency is assigned to the opening, via the subscription + assignment indexes) + **1
  regional write** (referral row + global referral-index row + audit, global-first then regional
  with compensation).
- `assign-opening-agency`: **1 global read** (active staffing subscription + provider region) +
  writes to opening's regional assignment table and the global assignment index.
- `apply-for-opening` (extended): stays on the existing single-region application write path;
  attribution is set in the same regional tx; agency notifications are best-effort post-commit
  (cross-region `EnqueueEmail` in each agency's region).

### API Surface

| Endpoint                                                 | Portal | Who calls it        | What it does                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /org/assign-opening-agency`                        | org    | Consumer Org user   | Assigns an actively-subscribed staffing provider to a published opening                                                                                                                                                                            |
| `POST /org/remove-opening-agency`                        | org    | Consumer Org user   | Removes an assigned agency from an opening                                                                                                                                                                                                         |
| `POST /org/list-opening-agencies`                        | org    | Consumer Org user   | Lists agencies assigned to an opening                                                                                                                                                                                                              |
| `POST /org/refer-candidate`                              | org    | Agency Org user     | Refers a HubUser (by handle) into an opening the agency is assigned to                                                                                                                                                                             |
| `POST /org/list-agency-referrals`                        | org    | Agency Org user     | Paginated list of referrals the agency has made, with current state                                                                                                                                                                                |
| `POST /hub/list-referrals-received`                      | hub    | HubUser (candidate) | Paginated inbox of referrals received (repurposed: source is an agency)                                                                                                                                                                            |
| `POST /hub/decline-referral`                             | hub    | HubUser (candidate) | Declines a pending referral (silent)                                                                                                                                                                                                               |
| `GET  /hub/opening-agencies/{...}`                       | hub    | HubUser             | Lists official recruiting agencies + application mode for an opening (opening detail)                                                                                                                                                              |
| _existing_ `POST /hub/apply-for-opening` (multipart)     | hub    | HubUser (candidate) | Extended: adds `apply_via` form field (chosen agency domain or "direct") + direct-affirmation form field; sets the application's attribution record; enforces `agency_only`. Already `multipart/form-data` — new params are form fields, not JSON. |
| _existing_ `POST /org/list-applications`                 | org    | Consumer Org user   | Extended: `filter_agency` (agency domain or "direct"); response includes attribution per application                                                                                                                                               |
| _existing_ `POST /org/create-opening` / `update-opening` | org    | Consumer Org user   | Extended: `application_mode` field (`open` \| `agency_only`)                                                                                                                                                                                       |
| `POST /hub/accept-referral`                              | hub    | —                   | **REMOVED** — acceptance is now implicit in `apply` with `apply_via` selection                                                                                                                                                                     |
| `POST /hub/nominate-colleague-for-role`                  | hub    | —                   | **REMOVED** (old colleague-nomination path)                                                                                                                                                                                                        |
| `POST /hub/list-referrals-made`                          | hub    | —                   | **REMOVED** (replaced by `/org/list-agency-referrals`)                                                                                                                                                                                             |

---

## Stage 2: Implementation Plan

> **Do not fill this section until Stage 1 status is APPROVED.**

Status: DRAFT
Authors: @

### API Contract

New TypeSpec files: `specs/typespec/org/agency-referrals.tsp` (+ `.ts`/`.go`) and a rewritten
`specs/typespec/hub/referrals.tsp` (+ `.ts`/`.go`). Existing files extended:
`specs/typespec/org/applications.tsp`, `specs/typespec/org/openings.tsp` (or wherever
create/update-opening lives), and the hub opening-detail + apply types. All JSON fields
snake_case; all list endpoints keyset-paginated.

```typespec
// specs/typespec/org/agency-referrals.tsp  (consumer + agency sides)

enum ApplicationMode { open, agency_only }
enum AgencyReferralState { pending, accepted_applied, declined, expired, not_selected }

// ---- Consumer: assign / list / remove agencies on an opening ----
model AssignOpeningAgencyRequest { opening_id: string; agency_org_domain: string; }
model RemoveOpeningAgencyRequest { opening_id: string; agency_org_domain: string; }
model ListOpeningAgenciesRequest { opening_id: string; }
model OpeningAgency {
  agency_org_domain: string;
  agency_org_name: string;
  assigned_at: utcDateTime;
  referrals_made: int32;
}
model ListOpeningAgenciesResponse { agencies: OpeningAgency[]; }

// ---- Agency: list openings I'm assigned to (populates refer dropdown) ----
model ListAssignedOpeningsRequest { pagination_key?: string; limit?: int32; }
model AssignedOpening {
  opening_id: string;
  consumer_org_domain: string;
  opening_number: int32;
  title: string;            // snapshot kept in the global assignment index
  assigned_at: utcDateTime;
}
model ListAssignedOpeningsResponse {
  openings: AssignedOpening[];
  next_pagination_key?: string;
}

// ---- Agency: refer a candidate ----
model ReferCandidateRequest {
  opening_id: string;       // from ListAssignedOpenings
  candidate_handle: Handle;
  statement_text?: string;  // max 2000
}
model ReferCandidateResponse { referral_id: string; }

// ---- Agency: referrals my agency has made ----
model ListAgencyReferralsRequest { pagination_key?: string; limit?: int32; }
model AgencyReferral {
  referral_id: string;
  candidate_handle: Handle;
  consumer_org_domain: string;
  opening_number: int32;
  opening_title: string;
  state: AgencyReferralState;
  created_at: utcDateTime;
}
model ListAgencyReferralsResponse {
  referrals: AgencyReferral[];
  next_pagination_key?: string;
}

@route("/org/assign-opening-agency") @post
op assignOpeningAgency(...AssignOpeningAgencyRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/remove-opening-agency") @post
op removeOpeningAgency(...RemoveOpeningAgencyRequest): OkResponse<{}> | NotFoundResponse;
@route("/org/list-opening-agencies") @post
op listOpeningAgencies(...ListOpeningAgenciesRequest):
  OkResponse<ListOpeningAgenciesResponse> | BadRequestResponse;
@route("/org/list-assigned-openings") @post
op listAssignedOpenings(...ListAssignedOpeningsRequest):
  OkResponse<ListAssignedOpeningsResponse> | BadRequestResponse;
@route("/org/refer-candidate") @post
op referCandidate(...ReferCandidateRequest):
  CreatedResponse<ReferCandidateResponse> | BadRequestResponse | NotFoundResponse
  | ForbiddenResponse | ConflictResponse | UnprocessableEntityResponse;
@route("/org/list-agency-referrals") @post
op listAgencyReferrals(...ListAgencyReferralsRequest):
  OkResponse<ListAgencyReferralsResponse> | BadRequestResponse;
```

```typespec
// specs/typespec/hub/referrals.tsp  (REWRITE — source is now an agency)

model ListReferralsReceivedRequest { pagination_key?: string; limit?: int32; }
model ReferralReceived {
  referral_id: string;
  agency_org_domain: string;
  agency_org_name: string;
  consumer_org_domain: string;
  opening_number: int32;
  opening_title: string;
  statement_text?: string;
  state: AgencyReferralState;
  created_at: utcDateTime;
  expires_at: utcDateTime;
}
model ListReferralsReceivedResponse {
  referrals: ReferralReceived[];   // grouped by opening in the UI
  next_pagination_key?: string;
}
model DeclineReferralRequest { referral_id: string; }

@route("/hub/list-referrals-received") @post
op listReferralsReceived(...ListReferralsReceivedRequest):
  OkResponse<ListReferralsReceivedResponse> | BadRequestResponse;
@route("/hub/decline-referral") @post
op declineReferral(...DeclineReferralRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
```

Extensions to existing types:

- `org/applications.tsp`: `ListApplicationsRequest` — drop `filter_has_referral`, add
  `filter_agency?: string` (an agency domain, or the literal `"direct"`).
  `OrgApplicationSummary` — drop `has_referral`, add `referring_agency_domain?: string`
  (absent ⇒ direct). `OrgApplication` (detail) — add `referring_agency_domain?: string`.
- create-opening / update-opening request + `Opening` model: add `application_mode:
ApplicationMode` (default `open`).
- Hub opening-detail response (the endpoint backing `/org/:orgDomain/openings/:openingNumber`):
  add `application_mode: ApplicationMode` and `recruiting_agencies: { agency_org_domain:
string; agency_org_name: string; }[]`. (Replaces the Stage-1 `GET /hub/opening-agencies`
  idea — folding into the existing detail read avoids a params-in-GET convention violation and
  a second round-trip.)
- `apply-for-opening` is `multipart/form-data`; add form fields `apply_via` (`"direct"` or an
  agency domain) and `direct_no_agency_affirmation` (`"true"`/`"false"`). No JSON model change.

### Database Schema

Edit `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql` directly.

#### Tables / Columns

```sql
-- ===== Regional DB (opening's region) =====

-- openings: add application mode
ALTER TABLE openings ADD COLUMN application_mode TEXT NOT NULL DEFAULT 'open'
  CHECK (application_mode IN ('open','agency_only'));   -- (edit the CREATE TABLE in place)

-- applications: attribution (replaces the dead endorsements.is_referral linkage)
ALTER TABLE applications
  ADD COLUMN referring_agency_org_id     UUID,          -- NULL = direct
  ADD COLUMN referring_agency_domain     TEXT,
  ADD COLUMN direct_affirmed_no_agency   BOOLEAN NOT NULL DEFAULT FALSE; -- (edit CREATE in place)

-- DROP the vestigial, never-populated columns on endorsements
--   endorsements.is_referral, endorsements.referral_id

-- Opening ↔ agency assignment (consumer opening's region)
CREATE TABLE opening_agency_assignments (
    opening_id              UUID NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
    org_id                  UUID NOT NULL,            -- consumer org (opening owner)
    agency_org_id           UUID NOT NULL,            -- staffing provider org
    agency_org_domain       TEXT NOT NULL,
    assigned_by_org_user_id UUID NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (opening_id, agency_org_id)
);

-- Agency referrals (REPLACES referral_nominations)
CREATE TABLE agency_referrals (
    referral_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opening_id                   UUID NOT NULL,
    org_id                       UUID NOT NULL,        -- consumer org
    agency_org_id                UUID NOT NULL,
    agency_org_domain            TEXT NOT NULL,
    referred_by_org_user_id      UUID NOT NULL,        -- agency user
    candidate_hub_user_global_id UUID NOT NULL,
    candidate_handle_snapshot    TEXT NOT NULL,
    statement_text               TEXT CHECK (statement_text IS NULL OR length(statement_text) <= 2000),
    state                        TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending','accepted_applied','declined','expired','not_selected')),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at                  TIMESTAMPTZ,
    expires_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
-- one PENDING referral per (opening, candidate, agency); re-refer allowed after decline/expire
CREATE UNIQUE INDEX agency_referrals_one_pending
    ON agency_referrals (opening_id, candidate_hub_user_global_id, agency_org_id)
    WHERE state = 'pending';
CREATE INDEX idx_agency_referrals_opening_candidate
    ON agency_referrals (opening_id, candidate_hub_user_global_id);

-- DROP TABLE referral_nominations;  (+ its goose-down line)

-- ===== Global DB =====

-- Agency referral index (candidate inbox + agency "made" list, cross-region)
CREATE TABLE agency_referrals_index (
    referral_id                  UUID PRIMARY KEY,
    candidate_hub_user_global_id UUID NOT NULL,
    agency_org_id                UUID NOT NULL,
    region                       TEXT NOT NULL,        -- opening's region
    opening_id                   UUID NOT NULL,
    state                        TEXT NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL
);
CREATE INDEX agency_referrals_by_candidate
    ON agency_referrals_index (candidate_hub_user_global_id, created_at DESC, referral_id DESC);
CREATE INDEX agency_referrals_by_agency
    ON agency_referrals_index (agency_org_id, created_at DESC, referral_id DESC);

-- Opening↔agency assignment index (agency lists "openings my agency is assigned to")
CREATE TABLE opening_agency_assignment_index (
    opening_id          UUID NOT NULL,
    agency_org_id       UUID NOT NULL,
    region              TEXT NOT NULL,                -- opening's region
    consumer_org_id     UUID NOT NULL,
    consumer_org_domain TEXT NOT NULL,
    opening_number      INT  NOT NULL,
    title_snapshot      TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (opening_id, agency_org_id)
);
CREATE INDEX opening_agency_assignment_by_agency
    ON opening_agency_assignment_index (agency_org_id, created_at DESC, opening_id DESC);

-- DROP TABLE referral_nominations_index;  (+ indexes + goose-down lines)
```

#### SQL Queries

New/edited query files in `api-server/db/{global,regional}/queries/`. Remove the old referral
queries (`CreateReferral`, `GetReferralByID`, `ListReferralsByIDs`, `ResolveReferralDeclined`,
`CheckReferrerHasActiveStintAtDomain`, `GetSharedWorkDomain`, and the old global-index queries).

```sql
-- name: ValidateStaffingSubscription :one  (GLOBAL — assign-time, one round-trip)
-- consumer has an active subscription to a listing carrying 'staffing' from this provider
SELECT s.provider_region
FROM marketplace_subscription_index s
JOIN marketplace_listing_catalog c ON c.listing_id = s.listing_id
WHERE s.consumer_org_id = @consumer_org_id
  AND s.provider_org_id = @provider_org_id
  AND s.status = 'active'
  AND c.capability_ids @> ARRAY['staffing']
LIMIT 1;

-- name: GetAssignmentForReferral :one  (GLOBAL — refer-time, one round-trip)
-- agency is assigned to this opening AND the staffing subscription is still active
SELECT a.region, a.consumer_org_id, a.consumer_org_domain, a.opening_number
FROM opening_agency_assignment_index a
JOIN marketplace_subscription_index s
  ON s.consumer_org_id = a.consumer_org_id AND s.provider_org_id = a.agency_org_id
JOIN marketplace_listing_catalog c ON c.listing_id = s.listing_id
WHERE a.opening_id = @opening_id AND a.agency_org_id = @agency_org_id
  AND s.status = 'active' AND c.capability_ids @> ARRAY['staffing']
LIMIT 1;

-- name: ListReferralIndexByCandidate :many  (GLOBAL, keyset)  [+ ...ByAgency variant]
SELECT * FROM agency_referrals_index
WHERE candidate_hub_user_global_id = @candidate_id
  AND (@cursor_created_at::timestamptz IS NULL
       OR (created_at, referral_id) < (@cursor_created_at, @cursor_referral_id))
ORDER BY created_at DESC, referral_id DESC
LIMIT @lim;

-- name: ListAssignedOpeningsIndex :many  (GLOBAL, keyset by agency)
SELECT * FROM opening_agency_assignment_index
WHERE agency_org_id = @agency_org_id
  AND (@cursor_created_at::timestamptz IS NULL
       OR (created_at, opening_id) < (@cursor_created_at, @cursor_opening_id))
ORDER BY created_at DESC, opening_id DESC
LIMIT @lim;

-- Regional: CreateOpeningAgencyAssignment / DeleteOpeningAgencyAssignment /
--   ListOpeningAgencies (+ per-agency referral counts) / CreateAgencyReferral /
--   ListPendingReferralsForCandidateOpening / AcceptReferralForApply (UPDATE … state
--   accepted_applied) / MarkOtherReferralsNotSelected / DeclineReferralIfPending /
--   ListAgencyReferralsByIDs / GetOpeningRecruitingAgencies (for hub detail) /
--   ListApplications (+ filter_agency).
-- Global: InsertAssignmentIndex / DeleteAssignmentIndex / InsertReferralIndex /
--   UpdateReferralIndexState / GetReferralIndexEntry.
```

### Backend

#### Endpoints

| Method | Path                           | Handler file                       | Auth middleware | Role required                 |
| ------ | ------------------------------ | ---------------------------------- | --------------- | ----------------------------- |
| POST   | `/org/assign-opening-agency`   | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:manage_opening_agencies` |
| POST   | `/org/remove-opening-agency`   | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:manage_opening_agencies` |
| POST   | `/org/list-opening-agencies`   | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:view_opening_agencies`   |
| POST   | `/org/list-assigned-openings`  | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:view_agency_referrals`   |
| POST   | `/org/refer-candidate`         | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:refer_candidates`        |
| POST   | `/org/list-agency-referrals`   | `handlers/org/agency_referrals.go` | `OrgAuth`       | `org:view_agency_referrals`   |
| POST   | `/hub/list-referrals-received` | `handlers/hub/referrals.go`        | `HubAuth`       | (none)                        |
| POST   | `/hub/decline-referral`        | `handlers/hub/referrals.go`        | `HubAuth`       | (none)                        |
| POST   | `/hub/apply-for-opening`       | `handlers/hub/apply.go` (extend)   | `HubAuth`       | `hub:apply_jobs`              |
| POST   | `/org/list-applications`       | `handlers/org/applications.go`     | `OrgAuth`       | `org:view_applications`       |
| POST   | `/org/create-opening`/`update` | `handlers/org/openings.go`         | `OrgAuth`       | `org:manage_openings`         |

#### Handler Notes

- **assign-opening-agency**: opening must be `published` and owned by caller's org; agency ≠
  own org. One global read `ValidateStaffingSubscription` → provider region. Write regional
  `opening_agency_assignments` + audit, then global `InsertAssignmentIndex` (global-first
  order: global index insert then regional? — follow existing pattern: regional write in the
  opening's region via `WithRegionalTxFor`, then compensating global index insert with
  `CONSISTENCY_ALERT` on failure, mirroring apply.go's `InsertApplicationIndex`).
- **refer-candidate**: agency = caller's org. One global read `GetAssignmentForReferral`
  (validates assignment + active staffing subscription, returns opening region) → 403 if no
  row. Resolve candidate handle → hub_user_global_id (global). Regional tx in opening's region:
  insert `agency_referrals` (unique-pending violation → 409) + audit; then global
  `InsertReferralIndex`.
- **apply-for-opening (extend)**: after resolving opening (already returns region; add
  `application_mode` to that query). If `agency_only` and `apply_via=direct` → 422. If
  `apply_via=<agency>`: require a matching pending referral (else 422); in the existing apply
  tx set `referring_agency_org_id/domain`, mark that referral `accepted_applied`, mark other
  pending referrals for (opening,candidate) `not_selected`. If `apply_via=direct` on an `open`
  opening with pending referrals: require `direct_no_agency_affirmation=true` (else 400), set
  `direct_affirmed_no_agency`, mark pending referrals `not_selected`. Update global referral
  index states (compensating). Post-commit, best-effort: notify each referring agency
  (`EnqueueEmail` in the agency's region).
- **list-referrals-received / list-agency-referrals**: keyset over the global index, then one
  bulk regional fetch per region (`ListAgencyReferralsByIDs` / details) — no N+1.
- **list-applications (extend)**: add `filter_agency` → `referring_agency_domain = $x`, or
  `referring_agency_org_id IS NULL` when `"direct"`.
- **decline-referral**: resolve region via global index, regional tx flips `pending`→`declined`
  (else 422) + audit, then update global index state.

#### Audit Log Events

| event_type                  | DB table (region)        | actor_user_id     | event_data keys                                    |
| --------------------------- | ------------------------ | ----------------- | -------------------------------------------------- |
| `org.assign_opening_agency` | `audit_logs` (opening's) | consumer org user | `opening_id`, `agency_org_id`                      |
| `org.remove_opening_agency` | `audit_logs` (opening's) | consumer org user | `opening_id`, `agency_org_id`                      |
| `org.refer_candidate`       | `audit_logs` (opening's) | agency org user   | `referral_id`, `opening_id`, `cand_hash`           |
| `hub.decline_referral`      | `audit_logs` (opening's) | hub user          | `referral_id`                                      |
| `hub.apply_for_opening`     | `audit_logs` (opening's) | hub user          | extend with `apply_via`, `referring_agency_org_id` |

(`cand_hash` = SHA-256 of candidate email; never raw email.)

### Frontend

#### New Routes

| Portal | Route path       | Page component                                                           |
| ------ | ---------------- | ------------------------------------------------------------------------ |
| org-ui | `/referrals`     | `src/pages/referrals/AgencyReferralsPage.tsx` (referrals my agency made) |
| org-ui | `/referrals/new` | `src/pages/referrals/ReferCandidatePage.tsx`                             |
| hub-ui | `/referrals`     | `src/pages/referrals/ReferralInboxPage.tsx` (repurposed)                 |

Edited pages (no new route): org-ui opening detail (Agencies section + Assign modal +
applications source filter + "Represented by" badge), org-ui create/edit opening form
(`application_mode` radio), hub-ui apply page (agency selection + affirmation), hub-ui opening
detail (recruiting-agencies badge). Delete `hub-ui/src/pages/referrals/NominatePage.tsx`.

#### Implementation Notes

- Standard page layout (maxWidth 1200, back button, Title level=2, no outer Card).
- All request/response types imported from `vetchium-specs/*` — read the `.ts` before each
  fetch. Use the `ApplicationMode` / `AgencyReferralState` enum types, never string literals.
- `<Spin spinning>` on network calls; disable submit on validation errors.
- Agency dropdowns on org pages come from `list-assigned-openings`; assign-modal agency list
  from the existing active staffing `list-subscriptions`.

### RBAC

#### New roles

Keep in sync: `specs/typespec/common/roles.ts`, `specs/typespec/common/roles.go`,
`api-server/db/migrations/regional/00000000000001_initial_schema.sql` (INSERT into `roles`).

| Role name                     | Portal | Description                                           |
| ----------------------------- | ------ | ----------------------------------------------------- |
| `org:view_opening_agencies`   | org    | View agencies assigned to an opening (consumer side)  |
| `org:manage_opening_agencies` | org    | Assign/remove agencies on an opening (consumer side)  |
| `org:refer_candidates`        | org    | Refer candidates into assigned openings (agency side) |
| `org:view_agency_referrals`   | org    | List assigned openings + the agency's referrals       |

#### Existing roles reused

`org:manage_openings` (application_mode on create/update), `org:view_applications`
(filter_agency), `hub:apply_jobs` (apply), `org:superadmin` (bypass).

### i18n

en-US keys (matching de-DE + ta-IN required). Namespaces: org `agencyReferrals`, hub `referrals`
(rewrite).

```json
{
	"agencyReferrals": {
		"openingAgenciesTitle": "Recruiting Agencies",
		"assignAgency": "Assign Agency",
		"agencyColumn": "Agency",
		"assignedAt": "Assigned At",
		"referralsMade": "Referrals Made",
		"remove": "Remove",
		"selectAgency": "Agency (your active staffing subscriptions)",
		"referTitle": "Refer a Candidate",
		"opening": "Opening",
		"candidateHandle": "Candidate handle",
		"statement": "Statement",
		"refer": "Refer",
		"applicationMode": "Who can apply?",
		"modeOpen": "Anyone (direct applications + agency referrals)",
		"modeAgencyOnly": "Agencies only (direct applications blocked)",
		"noAgencyWarning": "No agency assigned — nobody can apply yet.",
		"representedBy": "Represented by {{agency}}",
		"sourceDirect": "Direct",
		"filterSource": "Source",
		"assignSuccess": "Agency assigned",
		"referSuccess": "Candidate referred"
	},
	"referrals": {
		"inboxTitle": "Referrals",
		"companyOpening": "Company / Opening",
		"referredBy": "Referred by",
		"statement": "Statement",
		"state": "State",
		"applyChooseAgency": "Apply (choose agency)",
		"decline": "Decline",
		"applyVia": "How are you applying?",
		"viaAgency": "Via {{agency}}",
		"directly": "Directly (no agency)",
		"noAgencyAffirm": "I confirm no agency referred me to this role.",
		"agencyOnlyNotice": "Direct applications are not accepted for this role — apply via one of the agencies above.",
		"declineSuccess": "Referral declined"
	}
}
```

### Test Matrix

API tests under `playwright/tests/api/hiring/` (rewrite `referrals.spec.ts`; new
`agency-referrals.spec.ts`; extend `applications.spec.ts`, `hub-apply.spec.ts`). Replace referral
methods in `playwright/lib/hub-api-client.ts`; add agency methods to `org-api-client.ts`. All
types from `specs/typespec/`. Helpers: `createTestMarketplaceListingDirect`,
subscription/assignment DB helpers (new), `createTestOrgUserDirect` with shared org.

| Scenario                                                               | Expected                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Assign agency with active staffing subscription                        | 200 + assignment + audit                                                   |
| Assign agency with no/cancelled subscription                           | 422                                                                        |
| Assign agency to own org / non-published opening                       | 422                                                                        |
| Assign — no role (RBAC neg) / with `org:manage_opening_agencies` (pos) | 403 / 200                                                                  |
| Refer candidate into assigned opening                                  | 201 + referral + index + audit                                             |
| Refer into opening agency is NOT assigned to                           | 403                                                                        |
| Second agency refers same candidate+opening                            | 201 (allowed)                                                              |
| Same agency duplicate pending referral                                 | 409                                                                        |
| Re-refer same candidate after decline/expire                           | 201                                                                        |
| Refer unknown handle / non-published opening                           | 404 / 422                                                                  |
| Refer — no role (RBAC neg) / with `org:refer_candidates` (pos)         | 403 / 201                                                                  |
| Candidate lists received referrals (keyset)                            | 200 + grouped, real fields                                                 |
| Apply via referring agency                                             | 201; attribution set; referral → accepted_applied; siblings → not_selected |
| Apply via agency that didn't refer                                     | 422                                                                        |
| Apply direct on `open` with pending referrals, affirmation missing     | 400                                                                        |
| Apply direct on `open` with affirmation                                | 201; referrals → not_selected; agencies notified                           |
| Apply direct on `agency_only` opening                                  | 422                                                                        |
| list-applications `filter_agency=<domain>` and `=direct`               | 200 + filtered; badge field set                                            |
| Decline pending referral / decline non-pending                         | 200 + audit / 422                                                          |
| Unauthenticated on each write                                          | 401                                                                        |
| No audit log entry created on any 4xx                                  | count unchanged                                                            |
| Hub opening detail exposes `application_mode` + `recruiting_agencies`  | 200 + populated                                                            |
