# Agency Referrals

Durable design reference for the agency-based referral model. Distilled from the implemented
feature spec; source of truth is the code (`api-server/handlers/org/agency_*.go`,
`handlers/hub/referrals.go`, `api-schema/org/agency-referrals.tsp`, `api-schema/hub/referrals.tsp`,
`bgjobs/expire_agency_referrals.go`) and `playwright/tests/api/hiring/{referrals,agency-*}.spec.ts`.
Builds on Marketplace v2 (the `staffing` capability, listings, subscriptions).

## Model

A referral source is a **staffing agency Org**, not a Hub colleague. The flow chains three
existing marketplace primitives plus an assignment:

1. A staffing-services Org publishes a marketplace listing carrying the `staffing` capability.
2. A hiring Org subscribes to it (both already supported by Marketplace v2).
3. The hiring Org **assigns** one or more of its _actively-subscribed_ staffing providers as
   official agencies on a specific **published** opening (`opening_agency_assignments`).
4. A user of an assigned agency **refers a HubUser into that opening** —
   **no colleague / stint / connection prerequisite** (the key difference from the old
   colleague-nomination model this replaced). Optional `statement_text` ≤ 2000 chars.
5. The referred HubUser sees the referral in their inbox and either **applies through the agency**
   (acceptance is implicit in applying) or **declines**.

## Candidate-consented attribution (the core decision)

Attribution is **candidate-consented, not first-come.**

- Multiple assigned agencies may refer the **same** candidate to the **same** opening — each
  referral is a timestamped, pending claim.
- The candidate chooses at **apply time** (`apply_via`): exactly one agency, or `direct` (with
  `direct_affirmed_no_agency`). Only the chosen agency is attributed; the resulting application
  carries an **immutable attribution record** (`referring_agency_org_id` / `referring_agency_domain`).
- The other pending referrals for that (opening, candidate) become `not_selected`.

**Rationale:** making attribution depend on the candidate's pick rather than on who referred
first removes the incentive for an agency to mass-refer every candidate to lock out competitors —
a mass referral the candidate never picks earns nothing.

## State machine — `agency_referrals.state`

`pending → accepted_applied | declined | expired | not_selected`

- `accepted_applied`: candidate applied through this agency.
- `declined`: candidate declined the referral.
- `not_selected`: candidate chose a different agency (or applied direct) for the same opening.
- `expired`: swept from `pending` past `expires_at` by the regional worker
  (`WorkerExpireAgencyReferrals` / `expire_agency_referrals.go`), which writes an
  `org.expire_referral` audit entry and mirrors the state into the global referral index.

## Cross-region notes

Per ADR-001, referrals and their notifications follow the relevant entities' regions. Agency
notifications are enqueued **best-effort, post-commit, in the agency's region** (the application
itself is written in the opening's region). See [ADR-001](../adr/adr-001-multi-region-data-access.md).
