# Hub subscription plans

Designed, not implemented. The decisions below were made on 2026-09-12; what
remains undecided is listed under [Open questions](#open-questions).

## Scope

Monthly and annual subscription plans for Hub users. Payments are simulated:
users move between plans without calling any payment processor. The Org portal
will have its own plans and subscriptions under a separate design; nothing here
applies to it.

## Plans

- A plan has a stable ID interpreted identically in every tenant. The first
  plans are `hub-free-tier` and `hub-silver-tier`. These should be considered
  the plan OIDs.
- Plans are hierarchical. Each has a unique rank, and a higher rank includes
  everything a lower rank allows.

  | Plan              | Rank     |
  | ----------------- | -------- |
  | `hub-free-tier`   | 1000     |
  | `hub-silver-tier` | 2000     |

- Plan IDs and ranks are code constants in the TypeSpec contract, a closed
  vocabulary in the Hub namespace with `.tsp`, `.go`, and `.ts` companions.
  They are also seeded database rows as a OID.
- Each Hub locale translates a display name per plan ID. A plan ID the portal
  does not recognize is shown as its raw ID.
- A tenant offers a subset of plans, and a plan may be offered by only some
  tenants. `hub-free-tier` must be offered by every tenant, because it is the
  default plan and the downgrade target.

## Availability and prices

### Offered plans

There are two lists, owned separately:

- **Backend.** Each tenant's `config.json` lists its offered plans
  (proposed key `hubAPIServer.offeredPlans`). Loading refuses an unknown plan
  ID or a list without `hub-free-tier`. The backend is authoritative: it
  refuses a change to a plan the tenant does not offer.
- **Hub UI.** Each `hub-ui` container receives its tenant ID and offered plans
  through runtime configuration, the same path `VETCHIUM_DEFAULT_LANGUAGE`
  takes today (proposed `VETCHIUM_TENANT_ID` and `VETCHIUM_HUB_PLANS`).
  `runtime-config.sh` rejects malformed values and unknown plan IDs.

Nothing can compare the two at startup, because `hub-ui` is a static nginx
container. Deployment changes them together in `docker-compose.json`,
`docker-compose-ci.json`, and `deploy/`. When they disagree, the portal either
offers a plan the backend refuses, and presents that refusal, or hides a plan
the backend would accept.

### Prices

Prices are hardcoded in `hub-ui`, keyed by tenant ID, plan, and billing
interval. The currency follows the account's home tenant, not the user's
resident country: an India resident hosted on `sgp` pays in SGD. Annual price
is eleven months of the monthly price.

| Tenant | Currency | `hub-silver-tier` monthly | `hub-silver-tier` annual |
| ------ | -------- | ------------------------- | ------------------------ |
| `usa1` | USD      | 10                        | 110                      |
| `deu`  | EUR      | 10                        | 110                      |
| `sgp`  | SGD      | 10                        | 110                      |
| `ind1` | INR      | 1000                      | 11000                    |

- Prices include tax. The listed amount is what the user pays in every tenant;
  VAT, GST, and sales tax are absorbed.
- `hub-free-tier` has no price.
- The portal hides a paid plan it has no price for in its tenant, such as on a
  newly added tenant.
- Changing a price or currency is a portal release. It needs no database
  migration.
- Amounts are formatted with `Intl.NumberFormat` in the interface locale and
  the tenant's currency.

## Subscription record

Every Hub user has exactly one current subscription, created as
`hub-free-tier` in the same transaction that completes signup. It holds:

- plan ID;
- billing interval, `month` or `year`, absent for `hub-free-tier`;
- current period start and end as UTC instants, absent for `hub-free-tier`;
- whether it cancels at period end;
- a scheduled change: the plan and interval taking effect at period end;
- source, which is `simulated` for now.

Payment records are not stored until a processor is integrated. Those records
include who paid, when, the amount, the currency, and processor references.
The processor will be the system of record for transactions; the tenant
database keeps only which user is on which plan and, later, payment records.

## Changing plans

- **Upgrade** applies immediately and starts a new period. An upgrade is a
  higher rank, or the same plan moving from monthly to annual. Nothing is
  prorated while payments are simulated.
- **Downgrade** is scheduled for period end, and the user keeps the current
  plan until then. A downgrade is a lower rank, including cancellation to
  `hub-free-tier`, or the same plan moving from annual to monthly.
- Choosing the current plan and interval again before period end clears a
  scheduled downgrade or cancellation.
- An upgrade while a downgrade is scheduled clears the scheduled change and
  applies immediately.
- At period end, a worker applies any scheduled change. Otherwise the simulated
  renewal always succeeds and the next period starts.
- Simulated payments never fail. Once a processor is integrated, a user is
  downgraded to `hub-free-tier` when the processor ends the subscription after
  its retries, not at the first failed charge. For example, Stripe moves
  `past_due` to `unpaid` or `canceled`, and Razorpay moves `pending` to
  `halted`. The grace period is decided with the integration.

Every change, whether by the user or by the worker, writes its audit events in
the same transaction, with the Hub user or the worker as actor. The user's plan
change goes through the idempotency ledger. The worker's transitions use state
predicates, so a user change racing a period-end transition cannot apply twice.

## Simulated payments

Simulation is enabled in every environment, production included, until a
payment integration exists. There is no setting for it.

This means anyone who can sign up in production can take a paid plan without
paying. Production Hub signup is open today: the `deploy/` configs omit
`hubAPIServer.signup`, which defaults to enabled.

When the first integration lands, whether a tenant uses a processor or
simulation becomes per-tenant configuration. Development and CI keep
simulation, with no processor calls.

## API

Authenticated Hub endpoints, named in TypeSpec at implementation:

- **Read the current subscription:** plan, interval, current period,
  cancel-at-period-end, and scheduled change.
- **Set plan:** takes a plan ID and interval and is idempotent. It refuses
  invalid combinations, such as an interval with `hub-free-tier`, with a
  validation problem, and a plan this tenant does not offer with its own
  problem type.

No endpoint lists offered plans or prices; the portal takes them from its
runtime configuration and code.

## Enforcement

- Each gated feature names a minimum plan in code. Ranks come from the contract
  constants, so Go and TypeScript compare them the same way.
- A gated write keeps the decision atomic. The handler computes the plan IDs at
  or above the required rank and passes them into the writing statement as a
  predicate (`plan_id = ANY(...)`). A concurrent downgrade therefore cannot
  land between the check and the write.
- A refusal is a `403` problem with its own type under
  `typespec/problem/hub/`, carrying the required plan ID. It is distinct from
  authentication and permission problems, so the portal can offer an upgrade.
- The check and the problem type are built now and covered by unit tests,
  before any endpoint uses them. This is a deliberate exception to
  `agent-guides/backend.md`'s rule against speculative problems. No endpoint
  declares the problem until the first gated feature, and Playwright covers it
  then.
- The portal decides per feature whether to hide a locked feature or show it
  with an upgrade prompt. An attempted locked operation suggests upgrading. The
  backend refuses regardless of what the portal shows.
- What happens to content created under a paid feature after a downgrade is
  decided with each feature.

## Hub portal

- A plan page for signed-in users shows the offered plans with translated
  names, monthly and annual prices, and the current subscription with any
  scheduled change. Paid plans carry the highlighted bullet "The paid plans
  will support the development of the Vetchium FOSS project."
- After sign-in, the home page invites the user to choose a plan and fill in
  basic profile information, and asks them to consider a paid plan.
- Terms and Conditions is one public `/terms` page, the same for every tenant.
  It has a payments section of generic placeholder text, is translated for
  every Hub locale (`en-US`, `de-DE`, `ta`), and is linked from signup.
  Acceptance is not recorded; it will be captured at checkout once real
  payments exist.

## Payment integration requirements in future

- Processors and payment methods vary by tenant: For example, Razorpay in India,
  Stripe in Singapore, UPI and cards in India, Klarna in Europe, PayPal in the
  USA, cryptocurrency in Singapore. Launch may use one processor for every
  tenant. A processor is chosen by source code plus per-tenant configuration
  such as the redirect URL after plan selection. The design must admit more
  processors later.
- The server never takes an amount from the browser. It maps tenant, plan, and
  interval to the processor's price object from configuration. The portal's
  hardcoded prices must match those objects.
- Processor webhooks are verified before they change subscription state.
- Provider lifecycles to map onto the subscription record:
  - Stripe: `incomplete`, `active`, `past_due`, `unpaid`, `canceled`, and
    `cancel_at_period_end`. Moving from monthly to yearly moves the billing
    date to the day of the switch, and price changes create prorations.
  - Razorpay: `created`, `authenticated`, `active`, `pending`, `halted`,
    `cancelled`, and `completed`.
- Decide proration and the failed-payment grace period.
- Prices include tax, so processor tax settings must keep the charged amount
  equal to the listed price.
- The `hub-ui` Content-Security-Policy (`script-src 'self'; connect-src
  'self'`) blocks embedded checkout scripts. Use a hosted checkout redirect or
  change the policy deliberately.
- Razorpay lists Subscriptions as available in India, Malaysia, Singapore, and
  the United States, and UPI is INR-only. Confirm that recurring EUR, USD, and
  SGD charges work through one merchant account before using Razorpay for
  every tenant.

## Tenant migration

Undecided; it is designed together with user migration in
[hub-signup-design.md](hub-signup-design.md). Some points below:

- the plan migrates with the user;
- if the destination tenant cannot take the plan, the profile does not
  migrate, so the destination offering the plan becomes an admission check
  beside the email-domain allowlist;
- a one-time migration charge may apply, to help the user decide.

Still to decide: what happens to unused paid time and to the billing agreement,
given that the currency and processor can both change between tenants.

## Open questions

- Unused paid time and the billing agreement on tenant migration.
- Proration and failed-payment grace period, with the first integration.
- A plan withdrawn from a tenant while users hold it.
- Content created under a paid feature after a downgrade, per feature.
