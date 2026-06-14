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
  (cross-region `EnqueueEmail` in each agency's region), mirroring `notifyColleaguesOfApplication`.

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

TypeSpec definitions in `specs/typespec/{portal}/{feature}.tsp` with matching `.ts` and `.go` files. These are the source of truth — all request/response types must be defined here and imported everywhere else.

```typespec
// specs/typespec/org/feature.tsp

model CreateFooRequest {
  name: string;
  description?: string;
}

model FooResponse {
  id: string;
  name: string;
  created_at: utcDateTime;
}

@route("/org/create-foo")
op createFoo(...CreateFooRequest): CreatedResponse<FooResponse> | BadRequestResponse;

@route("/org/list-foos")
op listFoo(...ListFooRequest): OkResponse<FooListResponse> | BadRequestResponse;
```

### Database Schema

Changes to `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql`. No new migration files — edit the initial schema directly.

#### Tables / Columns

```sql
-- Regional DB
CREATE TABLE foos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### SQL Queries

New query files in `api-server/db/{global,regional}/queries/`. Annotate with sqlc directives.

```sql
-- name: CreateFoo :one
INSERT INTO foos (org_id, name) VALUES ($1, $2) RETURNING *;

-- name: ListFoos :many
SELECT * FROM foos
WHERE org_id = $1
  AND ($2::uuid IS NULL OR id < $2)
ORDER BY id DESC
LIMIT $3;
```

### Backend

#### Endpoints

| Method | Path              | Handler file          | Auth middleware | Role required    |
| ------ | ----------------- | --------------------- | --------------- | ---------------- |
| POST   | `/org/create-foo` | `handlers/org/foo.go` | `OrgAuth`       | `org:manage_foo` |
| POST   | `/org/list-foos`  | `handlers/org/foo.go` | `OrgAuth`       | `org:view_foo`   |

#### Handler Notes

- Decode → validate → tx → respond
- All writes use `s.WithRegionalTx` / `s.WithGlobalTx`
- Audit log write MUST be inside the same transaction as the primary write

#### Audit Log Events

| event_type       | DB table                | actor_user_id | target_user_id | event_data keys  |
| ---------------- | ----------------------- | ------------- | -------------- | ---------------- |
| `org.create_foo` | `audit_logs` (regional) | org user      | —              | `foo_id`, `name` |

### Frontend

#### New Routes

| Portal | Route path | Page component              |
| ------ | ---------- | --------------------------- |
| org-ui | `/foo`     | `src/pages/FooListPage.tsx` |

#### Implementation Notes

- Standard page layout: maxWidth 1200, back button first, Title level=2, no outer Card
- Wrap network calls with `<Spin spinning={loading}>` to prevent double-submission
- Disable submit while form has validation errors

### RBAC

#### New roles (if any)

All three locations must be kept in sync:

- `specs/typespec/common/roles.ts`
- `specs/typespec/common/roles.go`
- `api-server/db/migrations/.../00000000000001_initial_schema.sql` (INSERT into `roles`)

| Role name        | Portal | Description               |
| ---------------- | ------ | ------------------------- |
| `org:view_foo`   | org    | Read-only access to foos  |
| `org:manage_foo` | org    | Create, edit, delete foos |

#### Existing roles reused

List any existing roles this feature checks against.

### i18n

Minimum: provide `en-US` values. Add matching keys to `de-DE` and `ta-IN`.

```json
{
	"fooList": {
		"title": "Foos",
		"addFoo": "Add Foo",
		"backToDashboard": "Back to Dashboard",
		"name": "Name",
		"status": "Status",
		"createdAt": "Created At",
		"createSuccess": "Foo created successfully",
		"deleteSuccess": "Foo deleted successfully"
	}
}
```

### Test Matrix

Tests in `playwright/tests/api/{portal}/foo.spec.ts`. All types imported from `specs/typespec/`.

| Scenario                     | Request                              | Expected status                 |
| ---------------------------- | ------------------------------------ | ------------------------------- |
| Success — create             | valid body                           | 201 + resource in response      |
| Success — list               | valid pagination                     | 200 + items array               |
| Missing required field       | `name` omitted                       | 400                             |
| Invalid field value          | `name: ""`                           | 400                             |
| Unauthenticated              | no / invalid token                   | 401                             |
| Wrong role (RBAC negative)   | authenticated, no roles              | 403                             |
| Correct role (RBAC positive) | non-superadmin with `org:manage_foo` | 201                             |
| Not found                    | unknown ID                           | 404                             |
| Invalid state                | e.g. already deleted                 | 422                             |
| Audit log written            | after success case                   | entry with correct `event_type` |
| No audit log on failure      | after 4xx                            | count unchanged                 |
