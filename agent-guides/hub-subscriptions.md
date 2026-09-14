# Hub Subscriptions

Applies to Hub plans, subscriptions, billing periods, plan-gated features,
prices, and payment integration. Nothing here defines Org plans. Compose it
with the backend, database, TypeSpec, UI, and Playwright guides for the layers
being changed.

## Plans and offerings

- Plan OIDs and ranks are stable contract constants with matching TypeSpec, Go,
  and TypeScript representations, and seeded database rows. Ranks are unique;
  a higher-ranked plan includes every lower-ranked plan's capabilities.
- `hub-free-tier` is the signup default, downgrade target, and mandatory tenant
  offering. A tenant may offer only a subset of other known plans.
- Backend tenant configuration is authoritative for offered plans and rejects
  unknown plans, a missing free tier, and changes to an unoffered plan.
- `hub-ui` receives its offered plans in runtime configuration. It is a static
  nginx container, so it cannot compare its list with the backend at startup.
  Keep every checked-in backend and portal configuration synchronized; the
  repository consistency test enforces this.
- The portal owns simulated-payment display prices, keyed by home tenant, plan,
  and interval. Currency follows the home tenant, not residence; annual price
  is eleven monthly payments; listed prices include tax. Hide a paid plan when
  either interval lacks a price. Format amounts in the interface locale.
- Show an unknown current plan by its raw OID and disable every change action
  for it. An older portal must not guess how to change a newer plan.
- No API lists offerings or display prices while simulation is in use. Do not
  accidentally make portal runtime configuration authoritative for a backend
  decision.

## Subscription state and changes

- Every Hub user has exactly one subscription, stored on the Hub user row. The
  signup transaction creates it on `hub-free-tier`.
- A paid subscription records its plan, monthly or annual interval, anchor,
  current UTC period, cancellation or scheduled change, and source. Free-tier
  rows have no interval or period.
- An upgrade is a higher rank or the same plan changing monthly to annual. It
  applies immediately, clears a pending downgrade, and starts a new period.
  Simulation does not prorate it.
- A downgrade is a lower rank, cancellation to free, or the same plan changing
  annual to monthly. Schedule it for period end and retain current access until
  then. Selecting the current plan and interval clears a scheduled change.
- Compute every boundary from the paid series' anchor day and time in UTC. If
  the target month lacks that day, use its final day without moving the anchor:
  January 31 progresses through February's final day and then March 31; a
  February 29 annual anchor uses February 28 outside leap years.
- `backend/internal/hub/billing.Advance` is the single period-end rule. The
  worker persists due transitions. Set-plan persists a due transition inside
  its transaction before deciding the requested change. The read endpoint
  computes the same transition in memory and performs no write.
- Lock the Hub user row before a set-plan decision. Worker batches use
  `SKIP LOCKED`, so requests wait for a claimed row while workers skip a row a
  request already holds and retry it in a later batch.
- Audit every persisted transition in the state-change transaction. Hub API
  period advancement uses the system subscription-renewal actor and request
  idempotency key; worker advancement uses the worker subscription-renewal
  actor. A read-only in-memory advancement produces no audit event.

## Plan-gated features

- Name a gated feature's minimum plan in code and derive acceptable plan OIDs
  from contract ranks.
- Keep the decision atomic with the feature write by including
  `hub_plan_oid = ANY(...)` in the writing statement. Never authorize with a
  preceding read that a concurrent downgrade can invalidate.
- The committed plan may lag a due scheduled change until a worker or set-plan
  request persists it. A feature that cannot accept that lag must apply due
  transitions first in its own transaction.
- Refuse insufficient plans with the dedicated `403` plan-required problem and
  required plan OID. The portal may hide a feature or offer an upgrade, but the
  backend always enforces the requirement.
- Decide per feature what a downgrade does to content created while paid. Do
  not infer one global retention rule.

## Real payment integration

Payments are currently simulated in every environment, including production,
with no feature flag. A paid plan can therefore be selected without a charge.
Before integrating real payments:

- Choose processor and credentials per tenant and allow the design to add more
  processors later.
- The server maps tenant, plan, and interval to a processor price object. Never
  accept an amount or currency from the browser, and keep portal display prices
  consistent with server-owned charge configuration.
- Verify webhook authenticity before changing subscription state. Map the
  processor's full retry and terminal lifecycle onto local state; do not
  downgrade at the first failed charge.
- Preserve the listed tax-inclusive amount in processor tax configuration.
- Prefer a hosted checkout redirect unless the `hub-ui` Content Security Policy
  is deliberately expanded for embedded scripts.
- Verify current processor, merchant-account, currency, country, and recurring
  payment capabilities from primary documentation during implementation; do
  not rely on old provider snapshots.

A future tenant migration carries the plan and admits the user only if the
destination offers it. Billing-agreement transfer, unused paid time, proration,
failure grace periods, plan withdrawal, and post-downgrade content behavior are
unresolved in [`../docs/todo.md`](../docs/todo.md); obtain product direction
instead of inventing those policies.
