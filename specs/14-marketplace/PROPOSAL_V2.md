# Vetchium Marketplace V2 Proposal

Status: Proposal
Author: Codex
Date: 2026-03-31

## Why The Current Design Feels Wrong

The current marketplace design is built around `marketplace_provider` plus `service_listings`.
That works for a narrow "directory of providers" feature, but it is not a clean fit for the
broader product you described:

- Vetchium is capability-centric, not listing-centric.
- Orgs can both **provide** and **consume** capabilities.
- The commercial flow matters even when the current price is discounted to zero.
- Contract signing and billing readiness must exist in the model, even if the POC waives payment.
- The current org routes mix buyer and provider concerns under the same `/marketplace` space.
- The current admin UI merges provider approval and listing moderation into one area.

The core issue is that the system currently treats "capability approval", "public catalog content",
and "consumption/commercial activation" as one feature. They should be separate but connected
workflows.

## Recommended Product Model

Treat Marketplace as 4 related subdomains:

1. Capability Catalog
2. Provider Onboarding
3. Provider Offers
4. Consumer Subscriptions

Those map to distinct objects:

### 1. Capability Definition

Admin-managed catalog entry for a capability.

Examples:

- `talent_sourcing`
- `background_verification`
- `kitchen_management`
- `physical_security`

Suggested fields:

- `capability_slug`
- `display_name`
- `description`
- `provider_enabled`
- `consumer_enabled`
- `requires_provider_approval`
- `requires_offer_review`
- `requires_contract`
- `requires_payment`
- `billing_period_unit`
- `default_provider_price`
- `default_consumer_price`
- `status`

Internal persistence may additionally store a hidden capability row identifier and alias history,
but those should not be exposed in routes or API contracts.

### 2. Provider Enrollment

An org's request and approval to provide a capability.

This is the replacement for the current overloaded `org_capabilities` marketplace behavior.
It represents the relationship between:

- Org
- Capability
- Vetchium Admin

Suggested states:

- `not_applied`
- `pending_review`
- `approved`
- `rejected`
- `suspended`
- `expired`

Suggested fields:

- `org_domain`
- `capability_slug`
- `status`
- `application_note`
- `review_note`
- `approved_at`
- `expires_at`
- `pricing_policy`
- `billing_status`
- `discount_percent`
- `discount_reason`

Internal persistence can still use hidden row identifiers and org foreign keys, but the portal and
API contract should treat the enrollment as identified by `org_domain + capability_slug`.

Recommended `pricing_policy` shape:

- `billing_period_unit`
- `billing_period_count`
- `list_price`
- `currency`
- `discount_type`
- `discount_value`
- `effective_price`

### 3. Provider Offer

The public commercial/profile artifact that buyers discover.

This is what the current `ServiceListing` is trying to be, but the capability itself should be the
top-level concept and the offer should sit underneath it.

Recommended rule for V1:

- One active offer per org per capability.

That keeps the UI much simpler and matches the mental model:

- "We provide Talent Sourcing"
- "We provide Background Verification"

If later you need multiple packages per capability, add `offer_packages` under a single offer
instead of allowing many sibling listings immediately.

Suggested states:

- `draft`
- `pending_review`
- `active`
- `rejected`
- `suspended`
- `archived`

Suggested fields:

- `org_domain`
- `capability_slug`
- `offer_slug`
- `headline`
- `summary`
- `description`
- `regions_served`
- `pricing_summary`
- `contact_mode`
- `service_attributes`
- `state`

For V1, if there is only one active offer per org per capability, the canonical external identity
can simply be `org_domain + capability_slug`. `offer_slug` should still exist so the model can grow
to multiple offers or packages later without a redesign.

Internal persistence can keep hidden foreign keys for enrollment and org linkage.

Recommended `service_attributes` shape:

- capability-specific structured fields defined per capability
- no untyped catch-all JSON blob in the external contract

Examples:

- `talent_sourcing_attributes`
- `background_verification_attributes`
- `kitchen_management_attributes`

### 4. Consumer Subscription

Represents an org consuming a capability from a provider offer.

This is the missing part in the current design.

Suggested states:

- `draft`
- `requested`
- `provider_review`
- `admin_review`
- `awaiting_contract`
- `awaiting_payment`
- `active`
- `rejected`
- `cancelled`
- `expired`

Suggested fields:

- `consumer_org_domain`
- `provider_org_domain`
- `capability_slug`
- `offer_slug`
- `relationship_slug`
- `status`
- `request_note`
- `commercial_terms_json`
- `contract_status`
- `payment_status`
- `starts_at`
- `expires_at`

Internal persistence can keep hidden subscription, org, and offer identifiers, but the external
contract should use a natural composite reference:

- `consumer_org_domain + provider_org_domain + capability_slug`

If you later support multiple concurrent or historical subscriptions for the same buyer, provider,
and capability combination, add `relationship_slug` as the final disambiguator.

Recommended `relationship_slug` rules:

- optional in V1
- generated by the system, not manually typed by users
- slugified from a business label when available, otherwise generated from a time bucket
- examples:
  - `annual-2026`
  - `pilot-apr-2026`
  - `renewal-2027`

If V1 allows only one live subscription per `consumer_org_domain + provider_org_domain +
capability_slug`, then `relationship_slug` should be omitted until the second-subscription use case
actually exists.

## Design Principles

### Make Capability The Top-Level Navigation Unit

Users should think:

- "What capability do I want to provide?"
- "What capability do I want to buy?"

Not:

- "Which listings page do I go to?"

### Separate Approval Layers

There are 3 independent approval decisions:

1. Can this org provide this capability?
2. Is this provider offer safe and publishable?
3. Can this consumer subscription go active?

These should not share a single state machine.

### Use Stable IDs Everywhere

Do not expose internal UUIDs in portal URLs or external API contracts.

Use two identity layers:

- Internal:
  UUIDs for storage, joins, routing, and data integrity
- External:
  slugs, domains, handles, and human-readable public references

Recommended external identifiers:

- capability:
  `capability_slug` such as `talent-sourcing`
- org:
  `org_domain` such as `acme.com`
- provider offer:
  `offer_slug`, scoped under org + capability
- future hub user:
  `hub_handle`
- subscription/request:
  `consumer_org_domain + provider_org_domain + capability_slug`
  with optional `relationship_slug` when one tuple is not enough

Recommended `offer_slug` rules:

- optional in V1 if there is only one offer per org per capability
- if present, generated by the system from the offer headline, then editable by the provider
- must be unique within `org_domain + capability_slug`
- examples:
  - `default`
  - `executive-search`
  - `high-volume-hiring`

Use internally:

- hidden row identifiers and foreign keys
- UUIDs for enrollment, offer, and subscription records

Expose externally:

- `capability_slug`
- `org_domain`
- `offer_slug`
- `hub_handle`
- `consumer_org_domain`
- `provider_org_domain`
- `relationship_slug`

Internal IDs should not change. External identifiers may change in limited cases, so the platform
should support alias resolution and canonical redirects.

### Canonicalization And Renames

Because org domains and future hub handles can change, the platform should treat public
identifiers as aliases backed by internal UUIDs.

Recommended behavior:

- store current canonical `org_domain` / `hub_handle`
- maintain alias history for renamed domains or handles
- resolve old aliases server-side to the same internal UUID
- return the current canonical value in API responses
- redirect old UI routes to the canonical route when needed

For composite public references, alias resolution should happen per segment:

- old consumer org domain resolves to current consumer org
- old provider org domain resolves to current provider org
- capability slug resolves through capability alias history if renamed
- the response returns canonical current values for all segments

## Operational Rules

### Open Enrollment vs Approval-Gated Enrollment

`requires_provider_approval` must have two explicit behaviors:

- if `true`:
  provider enrollment goes `not_applied -> pending_review -> approved/rejected`
- if `false`:
  provider enrollment goes `not_applied -> approved` immediately on apply

Recommended behavior:

- still create an enrollment record
- set `approved_at` at creation time
- apply pricing policy immediately
- write an audit event showing that approval was automatic because the capability allows open
  enrollment

### Self-Subscription

An org must not subscribe to its own offer.

Recommended behavior:

- UI should hide the org's own offers from buyer flows when possible
- API must still enforce the rule server-side
- request attempt returns HTTP 403

### Provider View Of Incoming Subscriptions

This needs an explicit cross-region design because subscriptions live with the consumer org.

Recommended design:

- source of truth for `consumer_subscriptions` remains the consumer org's regional DB
- each subscription write also creates or updates a lightweight global routing/index row
- the global index contains:
  - consumer org identity
  - provider org identity
  - capability slug
  - relationship slug if any
  - subscription status
  - consumer home region
  - provider home region
  - timestamps needed for queue ordering

Provider activity flow:

1. Provider opens `/marketplace/provide/:capability_slug/activity`
2. API queries the global index for subscriptions where:
   - `provider_org = current org`
   - `capability_slug = requested capability`
3. API groups matches by consumer region
4. API fans out reads to the relevant consumer regional DBs
5. API hydrates the detailed subscription cards and returns them to the provider

This keeps writes local to the consumer while making provider-side activity queries practical.

### One Live Subscription Rule

Recommended V1 simplification:

- allow only one non-cancelled, non-expired subscription per:
  `consumer_org_domain + provider_org_domain + capability_slug`

That means:

- no `relationship_slug` needed in normal V1 routes or APIs
- `relationship_slug` only becomes necessary when you intentionally support multiple parallel or
  historical relationships under the same tuple

### Treat Billing And Contracting As First-Class Optional Gates

Even if the POC price is fully discounted, the workflow should still record:

- base price
- discount
- effective price
- contract requirement
- payment requirement
- activation gate completion

That avoids redesign later.

## Recommended Portal Information Architecture

## Org Portal

The org portal should split Marketplace into 3 clear jobs:

1. Explore capabilities
2. Provide capabilities
3. Manage purchases

### Recommended Org UI Routes

#### Shared Marketplace shell

- `/marketplace`
- `/marketplace/capabilities`
- `/marketplace/capabilities/:capability_slug`

`/marketplace` should be a launcher page with 3 cards:

- Explore Capabilities
- Provide Capabilities
- Purchases

#### Buyer journey

- `/marketplace/capabilities`
- `/marketplace/capabilities/:capability_slug`
- `/marketplace/capabilities/:capability_slug/providers`
- `/marketplace/capabilities/:capability_slug/providers/:org_domain`
- `/marketplace/providers/:org_domain/:capability_slug`
- `/marketplace/purchases`
- `/marketplace/purchases/:consumer_org_domain/from/:provider_org_domain/:capability_slug`

Flow:

1. Browse capability
2. See approved providers for that capability
3. Open a provider offer
4. Request to consume
5. Track contract/payment/activation under Purchases

#### Provider journey

- `/marketplace/provide`
- `/marketplace/provide/:capability_slug`
- `/marketplace/provide/:capability_slug/apply`
- `/marketplace/provide/:capability_slug/offer`
- `/marketplace/provide/:capability_slug/offer/edit`
- `/marketplace/provide/:capability_slug/activity`

Flow:

1. Choose capability to provide
2. See provider enrollment status
3. Apply if not approved
4. Create or update the offer
5. Track incoming consumer requests/activity

This is much cleaner than:

- `/marketplace`
- `/marketplace/provider`
- `/marketplace/service-listings`

because it keeps the route tree aligned to the user's actual task.

## Admin Portal

The admin portal should not have one big Marketplace page with tabs for "capabilities" and
"service listings". That grouping is implementation-shaped, not workflow-shaped.

Admin jobs are:

1. Manage capability catalog
2. Review provider applications
3. Moderate provider offers
4. Oversee consumer subscriptions
5. Manage billing/renewals/exceptions

### Recommended Admin UI Routes

- `/marketplace`
- `/marketplace/catalog`
- `/marketplace/catalog/:capability_slug`
- `/marketplace/providers/applications`
- `/marketplace/providers/applications/:org_domain/:capability_slug`
- `/marketplace/providers`
- `/marketplace/providers/:org_domain/:capability_slug`
- `/marketplace/offers`
- `/marketplace/offers/:org_domain/:capability_slug`
- `/marketplace/subscriptions`
- `/marketplace/subscriptions/:consumer_org_domain/from/:provider_org_domain/:capability_slug`
- `/marketplace/billing`

Recommended page intent:

- `/marketplace`
  Dashboard with counts for pending provider applications, offers awaiting review, subscriptions
  awaiting activation, renewals due, payment exceptions.

- `/marketplace/catalog`
  Capability definitions and configuration.

- `/marketplace/providers/applications`
  Provider approval queue only.

- `/marketplace/providers`
  Approved/suspended/expired provider enrollments.

- `/marketplace/offers`
  Offer moderation queue and catalog health.

- `/marketplace/subscriptions`
  Consumer-side lifecycle tracking, contract gates, billing gates, activation state.

- `/marketplace/billing`
  Provider listing fees, consumer subscription billing, waived invoices, renewal exceptions.

## Hub Portal

No Marketplace routes in Hub for V1.

Recommendation:

- Reserve the concept, but do not expose it until a capability is directly consumable by Hub users.
- When that day comes, mirror the org buyer-side pattern:
  `/marketplace`, `/marketplace/capabilities`, `/marketplace/purchases`

## API Design

## Recommendation On Style

I recommend a resource-oriented API design, even if the transport remains mostly `POST` for
platform consistency.

Per Vetchium convention in `CLAUDE.md`, the APIs should not use path parameters for business
identifiers. Route paths should stay noun-oriented, and all lookup parameters should be passed in
the JSON request body.

That means grouping endpoints by nouns:

- `capabilities`
- `provider-enrollments`
- `provider-offers`
- `consumer-subscriptions`
- `billing`

Instead of action-heavy names like:

- `approve-marketplace-provider-capability`
- `submit-marketplace-service-listing`

If you want to stay consistent with the rest of Vetchium, keep `POST` but use cleaner paths like:

- `POST /admin/marketplace/provider-enrollments/approve`

instead of:

- `POST /admin/approve-marketplace-provider-capability`

## Proposed Org API Families

All org-facing marketplace APIs should accept and return public references, not internal UUIDs.

Recommended request/response identifier rules:

- capabilities:
  use `capability_slug`
- provider enrollment:
  use `org_domain + capability_slug`
- provider offer:
  use `org_domain + capability_slug`, and `offer_slug` if multiple offers are enabled
- consumer subscription:
  use `consumer_org_domain + provider_org_domain + capability_slug`
  and add `relationship_slug` only if multiple subscriptions are intentionally supported later

UI routes may embed these values as path parameters for readability, but API calls should always
send them in the request body.

### Capability catalog

- `POST /org/marketplace/capabilities/list`
- `POST /org/marketplace/capabilities/get`

Example request:

```json
{ "capability_slug": "talent-sourcing" }
```

### Provider enrollments

- `POST /org/marketplace/provider-enrollments/list`
- `POST /org/marketplace/provider-enrollments/get`
- `POST /org/marketplace/provider-enrollments/apply`
- `POST /org/marketplace/provider-enrollments/reapply`

Example request:

```json
{
  "org_domain": "acme.com",
  "capability_slug": "talent-sourcing"
}
```

### Provider offers

- `POST /org/marketplace/provider-offers/list`
- `POST /org/marketplace/provider-offers/get`
- `POST /org/marketplace/provider-offers/create`
- `POST /org/marketplace/provider-offers/update`
- `POST /org/marketplace/provider-offers/submit`
- `POST /org/marketplace/provider-offers/archive`

Optional if you want provider-controlled visibility:

- `POST /org/marketplace/provider-offers/pause`
- `POST /org/marketplace/provider-offers/resume`

Example request:

```json
{
  "org_domain": "acme.com",
  "capability_slug": "talent-sourcing",
  "offer_slug": "default"
}
```

### Buyer discovery

- `POST /org/marketplace/providers/list`
- `POST /org/marketplace/providers/get-offer`

Example request:

```json
{
  "capability_slug": "talent-sourcing",
  "org_domain": "acme.com"
}
```

### Consumer subscriptions

- `POST /org/marketplace/consumer-subscriptions/list`
- `POST /org/marketplace/consumer-subscriptions/get`
- `POST /org/marketplace/consumer-subscriptions/request`
- `POST /org/marketplace/consumer-subscriptions/cancel`

If contract/payment become interactive in-org:

- `POST /org/marketplace/consumer-subscriptions/upload-contract`
- `POST /org/marketplace/consumer-subscriptions/confirm-payment`

Example request:

```json
{
  "consumer_org_domain": "globex.com",
  "provider_org_domain": "acme.com",
  "capability_slug": "talent-sourcing"
}
```

## Proposed Admin API Families

Admin APIs should follow the same rule: public references in contracts, UUIDs only internally.

Recommended admin-side lookup rules:

- provider application review:
  `org_domain + capability_slug`
- provider offer moderation:
  `org_domain + capability_slug (+ offer_slug when needed)`
- subscription operations:
  `consumer_org_domain + provider_org_domain + capability_slug`
  and later `+ relationship_slug` only if the product adds multi-relationship support

### Capability catalog

- `POST /admin/marketplace/capabilities/list`
- `POST /admin/marketplace/capabilities/get`
- `POST /admin/marketplace/capabilities/create`
- `POST /admin/marketplace/capabilities/update`
- `POST /admin/marketplace/capabilities/enable`
- `POST /admin/marketplace/capabilities/disable`

### Provider enrollments

- `POST /admin/marketplace/provider-enrollments/list`
- `POST /admin/marketplace/provider-enrollments/get`
- `POST /admin/marketplace/provider-enrollments/approve`
- `POST /admin/marketplace/provider-enrollments/reject`
- `POST /admin/marketplace/provider-enrollments/suspend`
- `POST /admin/marketplace/provider-enrollments/renew`
- `POST /admin/marketplace/provider-enrollments/reinstate`

### Provider offers

- `POST /admin/marketplace/provider-offers/list`
- `POST /admin/marketplace/provider-offers/get`
- `POST /admin/marketplace/provider-offers/approve`
- `POST /admin/marketplace/provider-offers/reject`
- `POST /admin/marketplace/provider-offers/suspend`
- `POST /admin/marketplace/provider-offers/reinstate`

### Consumer subscriptions

- `POST /admin/marketplace/consumer-subscriptions/list`
- `POST /admin/marketplace/consumer-subscriptions/get`
- `POST /admin/marketplace/consumer-subscriptions/approve`
- `POST /admin/marketplace/consumer-subscriptions/reject`
- `POST /admin/marketplace/consumer-subscriptions/activate`
- `POST /admin/marketplace/consumer-subscriptions/cancel`
- `POST /admin/marketplace/consumer-subscriptions/expire`

### Billing and contract tracking

- `POST /admin/marketplace/billing/list`
- `POST /admin/marketplace/billing/get`
- `POST /admin/marketplace/billing/waive`
- `POST /admin/marketplace/billing/record-payment`
- `POST /admin/marketplace/contracts/mark-signed`
- `POST /admin/marketplace/contracts/mark-waived`

## Canonical Workflow

## Provider Side

1. Admin creates capability definition.
2. Org opens `/marketplace/provide/:capability_slug`.
3. Org submits provider enrollment.
4. Admin reviews enrollment and approves commercial terms.
5. Org creates provider offer.
6. Admin reviews offer.
7. Offer becomes discoverable.

## Consumer Side

1. Buyer opens `/marketplace/capabilities/:capability_slug/providers`.
2. Buyer selects provider offer.
3. Buyer submits consumption request.
4. Provider and/or admin reviews request.
5. Contract gate is completed if required.
6. Payment gate is completed or waived.
7. Subscription becomes `active`.

## What To Keep vs Replace

### Keep

- The existing roles:
  - `org:manage_marketplace`
  - `admin:manage_marketplace`
- Keyset pagination
- Audit logging discipline
- Regional ownership for org-scoped records

### Replace

- Replace `ServiceListing` as the main concept with `ProviderOffer`
- Replace exposed internal identifiers with public references based on slugs, domains, and public refs
- Replace the current org route tree under `/marketplace/provider` and
  `/marketplace/service-listings`
- Replace the single admin marketplace page with workflow-based pages
- Replace the current "provider capability only" mental model with dual-sided
  marketplace modeling: provider + consumer

## Suggested Data Ownership

- `capability_definitions`
  Global DB

- `provider_enrollments`
  Regional DB of provider org

- `provider_offers`
  Regional DB of provider org

- `consumer_subscriptions`
  Regional DB of consumer org, with denormalized provider references and a global routing record

- `marketplace_billing_records`
  Global DB if invoicing is centrally operated by Vetchium

This split keeps org-private operational state close to the org while leaving shared catalog and
central billing where they belong.

## Why This Route Hierarchy Is Better

For org users, the key improvement is that routes reflect intention:

- Explore
- Provide
- Purchase

For admin users, the key improvement is that routes reflect operational queues:

- Catalog
- Provider applications
- Offer moderation
- Subscription activation
- Billing

That makes navigation self-explanatory and makes future capabilities fit naturally without adding
another pile of special-case pages.

It also makes routes and payloads match how people naturally talk about the marketplace:

- capability slug first
- org domain second
- no UUID leakage into URLs or API bodies

## Migration Recommendation

I would not try to incrementally rename the current marketplace feature and call it done.

Recommended approach:

1. Freeze the current marketplace surface.
2. Write a fresh TypeSpec contract for Marketplace V2 around the 4 core resource families.
3. Redesign the org and admin UI route tree first.
4. Map any reusable backend moderation logic into the new provider-offer workflow.
5. Introduce consumer-subscription flow as a first-class feature from day 1, even if payment is waived.

If you want the smallest useful first release, build in this order:

1. Capability catalog
2. Provider enrollment approval
3. Provider offer publication
4. Consumer subscription request
5. Contract/payment gating

## Strong Opinion

If you keep the current design direction, the product will continue to feel like "an approved
directory of listings". If you adopt the design above, it becomes a real capability marketplace
that can support provider approval, buyer activation, contract handling, and commercial expansion
without another conceptual rewrite.
