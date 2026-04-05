# Vetchium Marketplace Spec

Status: Proposal
Author: Codex
Date: 2026-04-01

---

## 1. Overview

The Vetchium Marketplace is a capability marketplace that connects Orgs that provide
professional services with Orgs that need to consume them. It is not a transactional
payment platform. Vetchium connects providers and buyers; the commercial relationship
is formalized through the subscription workflow, but the actual service delivery happens
off-platform.

### What the marketplace enables

- An Org can offer a service capability to other Orgs (provider role).
- An Org can discover and subscribe to capabilities offered by other Orgs (buyer role).
- An Org may simultaneously hold both roles for the same or different capabilities.
- An Org cannot subscribe to its own offer.

### The four bounded subdomains

Marketplace is modelled as four independent subdomains with their own state machines:

| Subdomain             | What it represents                                                    | Governed by |
| --------------------- | --------------------------------------------------------------------- | ----------- |
| Capability Catalog    | Admin-defined types of service that can be offered on the marketplace | Admin only  |
| Provider Enrollment   | An org's authorization to provide a specific capability               | Org + Admin |
| Provider Offer        | The discoverable commercial record buyers can see                     | Org + Admin |
| Consumer Subscription | An org's request to consume a provider's offer                        | Org + Admin |

These are independent relationships. Approving an enrollment does not automatically create
an offer. Approving an offer does not automatically create a subscription. Each step requires
an explicit action.

---

## 2. Design Principles

### Capability is the top-level navigation unit

Users think in terms of capabilities, not listings pages:

- "What capabilities can I provide?"
- "What capabilities do I need to buy?"

The UI and API are organized around capability slugs.

### Three independent approval layers

There are three distinct approval decisions, each with its own state machine:

1. Can this org provide this capability? (enrollment approval)
2. Is this provider's offer safe and publishable? (offer review)
3. Can this consumer subscription go active? (subscription approval)

These are never merged into a single approval queue.

### Internal UUIDs, external natural keys

Every marketplace record uses two identity layers:

| Layer                | Used for                                           | Mutable?               |
| -------------------- | -------------------------------------------------- | ---------------------- |
| Internal UUID        | DB primary keys, foreign keys, joins, routing      | Never                  |
| External natural key | UI routes, API body parameters, user communication | Can rename via aliases |

Internal UUIDs are never exposed in UI routes or API contracts.

### Stable external identifiers

| Entity                                | External identity                                             |
| ------------------------------------- | ------------------------------------------------------------- |
| Capability                            | `capability_slug` (e.g. `talent-sourcing`)                    |
| Org                                   | `org_domain` (e.g. `acme.com`)                                |
| Provider enrollment (org-side)        | `capability_slug` (org is known from auth)                    |
| Provider enrollment (admin-side)      | `org_domain + capability_slug`                                |
| Provider offer (org-side)             | `capability_slug`                                             |
| Provider offer (buyer/admin-side)     | `provider_org_domain + capability_slug`                       |
| Consumer subscription (consumer-side) | `provider_org_domain + capability_slug`                       |
| Consumer subscription (provider-side) | `consumer_org_domain + capability_slug`                       |
| Consumer subscription (admin-side)    | `consumer_org_domain + provider_org_domain + capability_slug` |

V1 allows exactly one offer per `(provider_org, capability_slug)` and exactly one
subscription per `(consumer_org, provider_org, capability_slug)`. No external offer ID
or relationship slug is needed in V1.

### Alias resolution

Org domains and capability slugs can change. The system maintains alias tables in the
global DB. Incoming UI route parameters and API body parameters are resolved through
aliases before any business logic runs. Responses always return the current canonical
values. This decouples readable external identifiers from internal UUIDs.

---

## 3. Data Architecture

| Table                                 | DB                                | Rationale                                                               |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `marketplace_capabilities`            | Global                            | Admin-owned capability catalog; must be readable from all regions       |
| `marketplace_capability_slug_aliases` | Global                            | Capability rename resolution                                            |
| `marketplace_org_domain_aliases`      | Global                            | Org domain rename resolution                                            |
| `marketplace_offer_catalog`           | Global                            | Buyer discovery mirror; lets buyers in any region see all active offers |
| `marketplace_subscription_routing`    | Global                            | Lets providers query incoming subscriptions across consumer regions     |
| `marketplace_billing_records`         | Global                            | Vetchium billing records for centralized invoicing                      |
| `marketplace_enrollments`             | Regional (provider's home region) | Provider operational state; stays close to the provider                 |
| `marketplace_offers`                  | Regional (provider's home region) | Provider operational state                                              |
| `marketplace_subscriptions`           | Regional (consumer's home region) | Consumer operational state; stays close to the consumer                 |

### Why subscriptions stay with the consumer

Subscriptions contain the consumer's request state and activation lifecycle. Keeping them
in the consumer's regional DB avoids cross-region writes on every consumer action. Provider
visibility of incoming subscriptions is solved through the global routing table, not by
moving source of truth to the provider's region.

### Global offer catalog mirror

`marketplace_offer_catalog` stores the list-view subset of every buyer-visible offer. It
contains enough fields to render a browse result card and route a detail fetch to the correct
provider region. It does not store the full markdown description.

When an offer becomes buyer-visible or stops being buyer-visible:

1. Write the source-of-truth `marketplace_offers` row in the provider regional DB.
2. Upsert the corresponding `marketplace_offer_catalog` row in the global DB as a
   compensating write.
3. If the global write fails, log `CONSISTENCY_ALERT`.
4. A reconciliation worker repairs mismatches.

### Global subscription routing table

Every subscription write upserts a row in `marketplace_subscription_routing`.

When a provider queries their incoming subscription inbox:

1. API queries the routing table in the global DB for rows where `provider_org = current org`.
2. API groups matches by consumer region.
3. API fans out reads to the relevant consumer regional DBs.
4. API hydrates the detailed subscription records and returns them.

If the routing upsert fails, log `CONSISTENCY_ALERT` and repair through reconciliation.

---

## 4. Capability Catalog

Admin-managed. Stored in the global DB.

### 4.1 Fields

| Field                   | Type            | Constraints                                                  |
| ----------------------- | --------------- | ------------------------------------------------------------ |
| `capability_slug`       | string          | Unique. Lowercase alphanumeric + hyphens. 3–50 chars.        |
| `display_name`          | string          | 1–100 chars.                                                 |
| `description`           | string          | Markdown. Max 5000 chars.                                    |
| `provider_enabled`      | bool            | Whether orgs may apply to provide.                           |
| `consumer_enabled`      | bool            | Whether orgs may request subscriptions.                      |
| `enrollment_approval`   | enum            | `open` \| `manual`                                           |
| `offer_review`          | enum            | `auto` \| `manual`                                           |
| `subscription_approval` | enum            | `direct` \| `provider` \| `admin` \| `provider_and_admin`    |
| `contract_required`     | bool            | Whether contract confirmation is required before activation. |
| `payment_required`      | bool            | Whether payment recording is required before activation.     |
| `pricing_hint`          | string nullable | Max 200 chars.                                               |
| `status`                | enum            | `draft` \| `active` \| `disabled`                            |

### 4.2 Status Semantics

- `draft`: Admin-only. Not visible to org users. Used while configuring a new capability.
- `active`: Orgs may apply, publish offers, and request subscriptions subject to the gate
  fields.
- `disabled`: No new marketplace actions for this capability. Existing approved relationships
  continue.

### 4.3 Enrollment Approval Modes

- `open`: When an org applies, enrollment is approved immediately. No admin action required.
  The enrollment row is created with `status = approved` and `approved_at = now()`.
- `manual`: Enrollment goes to `pending_review` and waits for an admin to approve or reject.

### 4.4 Offer Review Modes

- `auto`: When a provider submits an offer, it becomes `active` immediately.
- `manual`: Offer goes to `pending_review` and waits for admin approval.

### 4.5 Subscription Approval Modes

- `direct`: No review gates. Subscription becomes active after contract/payment gates if any.
- `provider`: Provider must approve before contract/payment gates.
- `admin`: Admin must approve before contract/payment gates.
- `provider_and_admin`: Both provider and admin must approve, in that order.

### 4.6 Cascade on Disable

When a capability is disabled:

- Active offers for the capability are set to `suspended`.
- Approved enrollments are left unchanged.
- Active subscriptions are left unchanged.
- No new enrollment applications, offer submissions, or subscription requests are accepted.

---

## 5. Provider Enrollment

An org's authorization to provide a capability.

V1 rule: exactly one enrollment row per `(org, capability_slug)`.

Stored in the provider's regional DB.

### 5.1 Fields

| Field               | Type                 | Constraints                                              |
| ------------------- | -------------------- | -------------------------------------------------------- |
| `id`                | UUID                 | Internal only                                            |
| `org_id`            | UUID                 | Internal FK                                              |
| `capability_slug`   | string               | Canonical slug                                           |
| `status`            | enum                 | See below                                                |
| `application_note`  | string nullable      | Max 2000 chars                                           |
| `review_note`       | string nullable      | Max 2000 chars                                           |
| `approved_at`       | timestamptz nullable | Set when approved                                        |
| `expires_at`        | timestamptz nullable | Null means no expiry                                     |
| `billing_reference` | string nullable      | External billing system reference                        |
| `billing_status`    | enum                 | `not_applicable` \| `pending` \| `active` \| `suspended` |
| `created_at`        | timestamptz          |                                                          |
| `updated_at`        | timestamptz          |                                                          |

### 5.2 States

- `pending_review`
- `approved`
- `rejected`
- `suspended`
- `expired`

`not_applied` is the absence of a record.

### 5.3 Transition Table

| From             | To               | Actor  | Trigger                                       | Notes                                              |
| ---------------- | ---------------- | ------ | --------------------------------------------- | -------------------------------------------------- |
| none             | `approved`       | System | `apply` when `enrollment_approval = open`     | Creates the row already approved                   |
| none             | `pending_review` | Org    | `apply` when `enrollment_approval = manual`   | Creates the row awaiting review                    |
| `pending_review` | `approved`       | Admin  | `approve`                                     | Sets `approved_at`, optional `expires_at`          |
| `pending_review` | `rejected`       | Admin  | `reject`                                      | `review_note` required                             |
| `approved`       | `approved`       | Admin  | `renew`                                       | Updates `expires_at`, optional `billing_reference` |
| `expired`        | `approved`       | Admin  | `renew`                                       | Reactivates without requiring reapplication        |
| `approved`       | `suspended`      | Admin  | `suspend`                                     | Cascades to offers                                 |
| `suspended`      | `approved`       | Admin  | `reinstate`                                   | Does not auto-reinstate suspended offers           |
| `approved`       | `expired`        | System | expiry worker                                 | When `NOW() >= expires_at`                         |
| `rejected`       | `pending_review` | Org    | `reapply`                                     | Manual capabilities                                |
| `rejected`       | `approved`       | System | `reapply` when `enrollment_approval = open`   | Open capabilities                                  |
| `expired`        | `pending_review` | Org    | `reapply` when `enrollment_approval = manual` |                                                    |
| `expired`        | `approved`       | System | `reapply` when `enrollment_approval = open`   |                                                    |

Invalid transitions return HTTP 422.

Applying for a capability where `provider_enabled = false` returns HTTP 422.

### 5.4 Cascade on Suspension or Expiry

When an enrollment transitions to `suspended` or `expired`:

- Active offers become `suspended`.
- Pending-review offers become `suspended`.
- Discovery mirror rows are updated.
- Active subscriptions are left unchanged until their own expiry.
- No new subscription requests can be made against the provider's offer.

---

## 6. Provider Offer

The discoverable commercial artifact buyers see.

V1 rule: exactly one offer row per `(provider_org, capability_slug)`.

Stored in the provider's regional DB. Mirrored into the global offer catalog for discovery.

### 6.1 Fields

| Field             | Type            | Constraints                                     |
| ----------------- | --------------- | ----------------------------------------------- |
| `id`              | UUID            | Internal only                                   |
| `enrollment_id`   | UUID            | Internal FK                                     |
| `org_id`          | UUID            | Internal FK                                     |
| `capability_slug` | string          | Canonical slug                                  |
| `headline`        | string          | Max 100 chars                                   |
| `summary`         | string          | Max 500 chars                                   |
| `description`     | string          | Markdown. Max 10000 chars                       |
| `regions_served`  | string[]        | Non-empty. Region codes or `all`                |
| `pricing_hint`    | string nullable | Max 200 chars                                   |
| `contact_mode`    | enum            | `platform_message` \| `external_url` \| `email` |
| `contact_value`   | string          | Validated according to mode                     |
| `status`          | enum            | See below                                       |
| `review_note`     | string nullable | Admin moderation note                           |
| `created_at`      | timestamptz     |                                                 |
| `updated_at`      | timestamptz     |                                                 |

### 6.2 States

- `draft`
- `pending_review`
- `active`
- `rejected`
- `suspended`
- `archived`

### 6.3 Transition Table

| From             | To               | Actor  | Trigger                               | Notes                               |
| ---------------- | ---------------- | ------ | ------------------------------------- | ----------------------------------- |
| none             | `draft`          | Org    | `create`                              | Enrollment must be `approved`       |
| `draft`          | `draft`          | Org    | `update`                              | Free editing                        |
| `rejected`       | `draft`          | Org    | `update`                              | Any edit reopens into draft         |
| `draft`          | `active`         | System | `submit` when `offer_review = auto`   | Mirror updated                      |
| `draft`          | `pending_review` | Org    | `submit` when `offer_review = manual` |                                     |
| `pending_review` | `active`         | Admin  | `approve`                             | Mirror updated                      |
| `pending_review` | `rejected`       | Admin  | `reject`                              | `review_note` required              |
| `active`         | `pending_review` | Org    | `update`                              | Any active edit triggers re-review  |
| `archived`       | `draft`          | Org    | `update`                              | Any archived edit reopens the offer |
| `active`         | `archived`       | Org    | `archive`                             | Mirror updated                      |
| `pending_review` | `archived`       | Org    | `archive`                             | Mirror updated                      |
| `rejected`       | `archived`       | Org    | `archive`                             |                                     |
| `active`         | `suspended`      | Admin  | `suspend`                             | Mirror updated                      |
| `pending_review` | `suspended`      | Admin  | `suspend`                             | Mirror updated                      |
| `suspended`      | `active`         | Admin  | `reinstate`                           | Enrollment must still be `approved` |

Invalid transitions return HTTP 422.

### 6.4 Edit Rules

- `draft` and `rejected` offers may be edited freely by the provider.
- Editing an `archived` offer reopens it to `draft`.
- Editing an `active` offer moves it to `pending_review`.
- `pending_review` and `suspended` offers are not editable.

---

## 7. Consumer Subscription

An org's consumption of a provider offer.

Stored in the consumer's regional DB.

V1 rule: exactly one subscription row per `(consumer_org, provider_org, capability_slug)`.

If a subscription is in a terminal state and the consumer requests again, the existing row
is reused and moved back to `requested`. Full history lives in audit logs.

Self-subscription returns HTTP 422.

Requesting against a non-active offer returns HTTP 422.

### 7.1 Fields

| Field                      | Type                 | Constraints                                   |
| -------------------------- | -------------------- | --------------------------------------------- |
| `id`                       | UUID                 | Internal only                                 |
| `consumer_org_id`          | UUID                 | Internal FK in consumer region                |
| `consumer_org_domain`      | string               | Canonical current value                       |
| `provider_org_global_id`   | UUID                 | Internal reference                            |
| `provider_org_domain`      | string               | Canonical current value                       |
| `provider_region`          | string               | Denormalized for routing                      |
| `capability_slug`          | string               | Canonical slug                                |
| `request_note`             | string nullable      | Max 2000 chars                                |
| `requires_provider_review` | bool                 | Frozen at request time from capability config |
| `requires_admin_review`    | bool                 | Frozen at request time from capability config |
| `requires_contract`        | bool                 | Frozen at request time from capability config |
| `requires_payment`         | bool                 | Frozen at request time from capability config |
| `status`                   | enum                 | See below                                     |
| `review_note`              | string nullable      | Last admin/provider decision note             |
| `starts_at`                | timestamptz nullable | Set when active                               |
| `expires_at`               | timestamptz nullable | Null means no expiry                          |
| `created_at`               | timestamptz          | First creation time                           |
| `updated_at`               | timestamptz          | Last lifecycle change time                    |

### 7.2 States

- `requested`
- `provider_review`
- `admin_review`
- `awaiting_contract`
- `awaiting_payment`
- `active`
- `rejected`
- `cancelled`
- `expired`

There is no `draft` state. Subscriptions are visible to relevant parties from the moment
they are requested.

### 7.3 Gate Evaluation

At request time, the capability configuration is frozen onto the subscription row as four
booleans. This ensures the subscription's lifecycle is determined by the rules that were
in effect when it was requested, not by future capability reconfiguration.

Transition order is always:

1. provider review (if `requires_provider_review`)
2. admin review (if `requires_admin_review`)
3. contract (if `requires_contract`)
4. payment (if `requires_payment`)
5. active

`subscription_approval = direct` with `contract_required = true` is valid: it means no
review gates, but contract confirmation is still required before activation.

### 7.4 Transition Table

| From                | To                    | Actor             | Trigger                                    | Notes                                                       |
| ------------------- | --------------------- | ----------------- | ------------------------------------------ | ----------------------------------------------------------- |
| none or terminal    | `requested`           | Consumer          | `request`                                  | Creates or reuses the row; captures frozen gates            |
| `requested`         | `provider_review`     | System            | auto                                       | When provider review required                               |
| `requested`         | `admin_review`        | System            | auto                                       | When provider review not required and admin review required |
| `requested`         | `awaiting_contract`   | System            | auto                                       | When no review gates remain and contract required           |
| `requested`         | `awaiting_payment`    | System            | auto                                       | When no earlier gates remain and payment required           |
| `requested`         | `active`              | System            | auto                                       | When no gates apply                                         |
| `provider_review`   | next gate or `active` | Provider          | `provider-approve`                         | Advances automatically through remaining gates              |
| `provider_review`   | `rejected`            | Provider          | `provider-reject`                          | `review_note` required                                      |
| `admin_review`      | next gate or `active` | Admin             | `approve`                                  | Advances automatically through remaining gates              |
| `admin_review`      | `rejected`            | Admin             | `reject`                                   | `review_note` required                                      |
| `awaiting_contract` | next gate or `active` | Admin             | `mark-contract-signed` or `waive-contract` |                                                             |
| `awaiting_payment`  | `active`              | Admin             | `record-payment` or `waive-payment`        | Sets `starts_at`                                            |
| any non-terminal    | `cancelled`           | Consumer or Admin | `cancel`                                   |                                                             |
| `active`            | `expired`             | System            | expiry worker                              | When `NOW() >= expires_at`                                  |

Invalid transitions return HTTP 422.

---

## 8. Cross-Entity Cascades

| Trigger                         | Cascades to                             | Effect                     |
| ------------------------------- | --------------------------------------- | -------------------------- |
| Capability disabled             | Active offers                           | `suspended`                |
| Capability disabled             | Approved enrollments                    | No change                  |
| Capability disabled             | Active subscriptions                    | No change                  |
| Enrollment suspended or expired | Active or pending-review offers         | `suspended`                |
| Enrollment suspended or expired | Active subscriptions                    | No change                  |
| Offer suspended or archived     | Non-active subscriptions for that offer | `cancelled`                |
| Offer suspended or archived     | Active subscriptions                    | No change                  |
| Offer reinstated                | Previously auto-cancelled subscriptions | No automatic reinstatement |

---

## 9. RBAC

### 9.1 Roles

Add to the roles registry:

- `org:view_marketplace`
- `org:manage_marketplace`
- `admin:view_marketplace`
- `admin:manage_marketplace`

### 9.2 Access Rules

- Org read endpoints require `org:view_marketplace` or `org:manage_marketplace`.
- Org write endpoints require `org:manage_marketplace`.
- `org:superadmin` bypasses all org marketplace checks.
- Admin read endpoints require `admin:view_marketplace` or `admin:manage_marketplace`.
- Admin write endpoints require `admin:manage_marketplace`.
- `admin:superadmin` bypasses all admin marketplace checks.

---

## 10. Audit Logging

Every write handler writes an audit row inside the same transaction as the primary write.

Admin events go to global `admin_audit_logs`.
Org events go to regional `audit_logs`.

Event type format: `{portal}.marketplace_{entity}_{action}`

Examples:

- `org.marketplace_enrollment_apply`
- `org.marketplace_offer_submit`
- `admin.marketplace_offer_approve`
- `org.marketplace_subscription_request`
- `org.marketplace_subscription_provider_reject`
- `admin.marketplace_subscription_payment_recorded`

Use business identifiers in `event_data`:

- `org_domain`
- `capability_slug`
- `consumer_org_domain` / `provider_org_domain` as applicable

Do not store raw email addresses in event data.

---

## 11. API Endpoints

All endpoints use POST.

All business identifiers are passed in the JSON body, never in the URL path.

### 11.1 Org: Capability Catalog

```
POST /org/marketplace/capabilities/list
POST /org/marketplace/capabilities/get
```

`get` body:

```json
{ "capability_slug": "talent-sourcing" }
```

Pagination:

- sort: `capability_slug ASC`
- cursor: `capability_slug`

### 11.2 Org: Provider Enrollments

```
POST /org/marketplace/provider-enrollments/list
POST /org/marketplace/provider-enrollments/get
POST /org/marketplace/provider-enrollments/apply
POST /org/marketplace/provider-enrollments/reapply
```

`get` body:

```json
{ "capability_slug": "talent-sourcing" }
```

`apply` body:

```json
{
	"capability_slug": "talent-sourcing",
	"application_note": "We have operated in this space for 8 years..."
}
```

`reapply` body:

```json
{
	"capability_slug": "talent-sourcing",
	"application_note": "We have addressed the concerns raised..."
}
```

Pagination:

- sort: `created_at DESC, capability_slug ASC`
- cursor: `{created_at, capability_slug}`

### 11.3 Org: Provider Offers

```
POST /org/marketplace/provider-offers/get
POST /org/marketplace/provider-offers/create
POST /org/marketplace/provider-offers/update
POST /org/marketplace/provider-offers/submit
POST /org/marketplace/provider-offers/archive
```

`get` / `submit` / `archive` body:

```json
{ "capability_slug": "talent-sourcing" }
```

`create` / `update` body:

```json
{
	"capability_slug": "talent-sourcing",
	"headline": "Enterprise Talent Sourcing",
	"summary": "End-to-end talent acquisition for enterprise hiring programmes.",
	"description": "# About Our Service\n...",
	"regions_served": ["ind1", "usa1"],
	"pricing_hint": "Starting from $2,000/month",
	"contact_mode": "external_url",
	"contact_value": "https://acme.com/marketplace-contact"
}
```

### 11.4 Org: Buyer Discovery

```
POST /org/marketplace/providers/list
POST /org/marketplace/providers/get-offer
```

`list` body:

```json
{
	"capability_slug": "talent-sourcing",
	"pagination_key": null,
	"limit": 40
}
```

`get-offer` body:

```json
{
	"provider_org_domain": "acme.com",
	"capability_slug": "talent-sourcing"
}
```

`get-offer` returns HTTP 403 if the caller's org is the provider org.

Pagination:

- sort: `provider_org_domain ASC, capability_slug ASC`
- cursor: `{provider_org_domain, capability_slug}`

### 11.5 Org: Consumer Subscriptions (outgoing, buyer-side)

```
POST /org/marketplace/consumer-subscriptions/list
POST /org/marketplace/consumer-subscriptions/get
POST /org/marketplace/consumer-subscriptions/request
POST /org/marketplace/consumer-subscriptions/cancel
```

`get` / `cancel` body:

```json
{
	"provider_org_domain": "acme.com",
	"capability_slug": "talent-sourcing"
}
```

`request` body:

```json
{
	"provider_org_domain": "acme.com",
	"capability_slug": "talent-sourcing",
	"request_note": "We need this service for our Q3 hiring campaign."
}
```

Pagination:

- sort: `updated_at DESC, provider_org_domain ASC, capability_slug ASC`
- cursor: `{updated_at, provider_org_domain, capability_slug}`

### 11.6 Org: Incoming Subscriptions (provider-side inbox)

```
POST /org/marketplace/incoming-subscriptions/list
POST /org/marketplace/incoming-subscriptions/get
POST /org/marketplace/incoming-subscriptions/provider-approve
POST /org/marketplace/incoming-subscriptions/provider-reject
```

`get` / `provider-approve` / `provider-reject` body:

```json
{
	"consumer_org_domain": "globex.com",
	"capability_slug": "talent-sourcing"
}
```

`provider-reject` additionally requires `review_note`.

Pagination:

- sort: `updated_at DESC, consumer_org_domain ASC, capability_slug ASC`
- cursor: `{updated_at, consumer_org_domain, capability_slug}`

### 11.7 Admin: Capability Catalog

```
POST /admin/marketplace/capabilities/list
POST /admin/marketplace/capabilities/get
POST /admin/marketplace/capabilities/create
POST /admin/marketplace/capabilities/update
POST /admin/marketplace/capabilities/enable
POST /admin/marketplace/capabilities/disable
```

`get` / `enable` / `disable` body:

```json
{ "capability_slug": "talent-sourcing" }
```

### 11.8 Admin: Provider Enrollments

```
POST /admin/marketplace/provider-enrollments/list
POST /admin/marketplace/provider-enrollments/get
POST /admin/marketplace/provider-enrollments/approve
POST /admin/marketplace/provider-enrollments/reject
POST /admin/marketplace/provider-enrollments/suspend
POST /admin/marketplace/provider-enrollments/reinstate
POST /admin/marketplace/provider-enrollments/renew
```

Identifier body:

```json
{
	"org_domain": "acme.com",
	"capability_slug": "talent-sourcing"
}
```

`approve` and `renew` additionally accept:

```json
{
	"expires_at": "2027-03-31T00:00:00Z",
	"billing_reference": null,
	"review_note": "Verified. Documents on file."
}
```

Pagination:

- sort: `created_at DESC, org_domain ASC, capability_slug ASC`
- cursor: `{created_at, org_domain, capability_slug}`

### 11.9 Admin: Provider Offers

```
POST /admin/marketplace/provider-offers/list
POST /admin/marketplace/provider-offers/get
POST /admin/marketplace/provider-offers/approve
POST /admin/marketplace/provider-offers/reject
POST /admin/marketplace/provider-offers/suspend
POST /admin/marketplace/provider-offers/reinstate
```

Identifier body:

```json
{
	"org_domain": "acme.com",
	"capability_slug": "talent-sourcing"
}
```

`reject` and `suspend` require `review_note`.

Pagination:

- sort: `updated_at DESC, org_domain ASC, capability_slug ASC`
- cursor: `{updated_at, org_domain, capability_slug}`

### 11.10 Admin: Consumer Subscriptions

```
POST /admin/marketplace/consumer-subscriptions/list
POST /admin/marketplace/consumer-subscriptions/get
POST /admin/marketplace/consumer-subscriptions/approve
POST /admin/marketplace/consumer-subscriptions/reject
POST /admin/marketplace/consumer-subscriptions/mark-contract-signed
POST /admin/marketplace/consumer-subscriptions/waive-contract
POST /admin/marketplace/consumer-subscriptions/record-payment
POST /admin/marketplace/consumer-subscriptions/waive-payment
POST /admin/marketplace/consumer-subscriptions/cancel
```

Identifier body:

```json
{
	"consumer_org_domain": "globex.com",
	"provider_org_domain": "acme.com",
	"capability_slug": "talent-sourcing"
}
```

Pagination:

- sort: `updated_at DESC, consumer_org_domain ASC, provider_org_domain ASC, capability_slug ASC`
- cursor: `{updated_at, consumer_org_domain, provider_org_domain, capability_slug}`

### 11.11 Admin: Billing Records (read-only in V1)

```
POST /admin/marketplace/billing/list
```

Filters: `filter_consumer_org_domain`, `filter_provider_org_domain`, `filter_capability_slug`

Pagination:

- sort: `created_at DESC, consumer_org_domain ASC, provider_org_domain ASC, capability_slug ASC`
- cursor: `{created_at, consumer_org_domain, provider_org_domain, capability_slug}`

---

## 12. UI Routes and Screen Descriptions

UI routes use path parameters for readability. The corresponding API calls always send
the same identifiers in the JSON body.

### 12.1 Org Portal

---

#### `/marketplace`

**Marketplace launcher**

The entry point to the marketplace. Shows three cards:

1. **Explore Capabilities** — Browse capabilities the org could subscribe to.
2. **Provide Capabilities** — Manage the org's provider enrollments and offers.
3. **Purchases** — Track the org's outgoing subscription requests and active subscriptions.

Below the cards, show a summary of the org's current marketplace activity:

- Number of active enrollments (org is an approved provider).
- Number of active subscriptions (org is an active consumer).
- Any pending items needing attention (enrollment pending review, offer pending review,
  incoming subscriptions awaiting provider approval).

OrgUsers with only `org:view_marketplace` see all sections but cannot take write actions.
OrgUsers with `org:manage_marketplace` can take write actions.

---

#### `/marketplace/capabilities`

**Capability catalog (buyer view)**

Lists all capabilities where `status = active` and `consumer_enabled = true`. Purpose:
help the buyer understand what kinds of services exist on the marketplace before choosing
a provider.

Each row shows: capability display name, short description excerpt, number of active
providers. Clicking a row navigates to the capability detail page.

For capabilities where the org already has an active subscription, show a badge indicating
the org is already consuming this capability.

---

#### `/marketplace/capabilities/:capability_slug`

**Capability detail and provider list**

Shows the full capability description so the buyer understands what it covers. Below the
description, lists all providers with an active offer for this capability, sorted
alphabetically by org domain.

Each provider card shows: org name, offer headline, offer summary, regions served, pricing
hint. Clicking a card navigates to the provider offer detail page.

The buyer can also see whether they already have an active or pending subscription to any
of the providers for this capability.

---

#### `/marketplace/capabilities/:capability_slug/providers/:provider_org_domain`

**Provider offer detail (buyer-facing)**

The full offer page for a specific provider's capability offering. Shows:

- Offer headline and summary
- Full markdown description
- Regions served
- Pricing hint
- Contact mode and contact value (as a CTA: "Contact Provider", "Send Message", etc.)

If the buyer's org does not yet have a subscription for this provider+capability, shows a
"Request Access" button that starts the subscription workflow. Clicking it navigates to
a confirmation screen where the buyer can add a request note before submitting.

If a subscription already exists in a non-terminal state, shows the current subscription
status instead of the request button.

Returns HTTP 403 if the caller's org is the provider org. The UI must not show the
"View offer details" link for the caller's own offers in capability browse pages.

---

#### `/marketplace/provide`

**Provider dashboard**

Lists every capability the org has ever applied to provide, grouped by enrollment status.
Each row shows: capability display name, enrollment status badge, offer status badge (if
an offer exists), number of active incoming subscriptions.

If the org has no enrollments, shows an explanation of the provider workflow and a list
of capabilities where `provider_enabled = true` that the org could apply for.

A "Provide a new capability" button opens a modal or inline selector to choose a capability
slug and begin the apply flow.

---

#### `/marketplace/provide/:capability_slug`

**Enrollment and offer summary for one capability**

The operational hub for providing a specific capability. Shows two sections side by side
(or stacked on small viewports):

**Enrollment section**

Shows the current enrollment status and the next available action:

| Enrollment status | What is shown                                                            |
| ----------------- | ------------------------------------------------------------------------ |
| Not applied       | "You have not applied to provide this capability." Apply button.         |
| `pending_review`  | "Your application is under review." No action.                           |
| `approved`        | "Approved provider." Expiry date if set. Renew prompt if within 30 days. |
| `rejected`        | Admin review note. Reapply button.                                       |
| `suspended`       | Admin review note. No org action available.                              |
| `expired`         | "Your enrollment has expired." Reapply button.                           |

**Offer section**

Shows the current offer status and the next available action:

| Offer status     | What is shown                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No offer         | "You have not created an offer for this capability yet." Create offer button. Visible only when enrollment is `approved`. |
| `draft`          | Offer headline preview. Edit and Submit buttons.                                                                          |
| `pending_review` | Offer headline preview. "Under admin review."                                                                             |
| `active`         | Offer headline preview. Edit, Archive buttons.                                                                            |
| `rejected`       | Offer headline preview. Admin review note. Edit button to address feedback.                                               |
| `suspended`      | Offer headline preview. Admin review note. No org action.                                                                 |
| `archived`       | "Your offer is archived." Reopen link (which opens the edit form).                                                        |

A link to the Activity page (incoming subscriptions) is shown when the enrollment is
`approved` and the offer is `active`.

---

#### `/marketplace/provide/:capability_slug/apply`

**Enrollment application form**

Form to apply for provider enrollment in a capability. Shows:

- Capability display name and description so the provider understands what they are
  applying for.
- Optional `application_note` textarea (max 2000 chars): "Describe the services you plan
  to offer and why your org is qualified to provide this capability."
- Submit button: "Apply to Provide".

On submission, navigates back to the enrollment and offer summary page showing
`pending_review` status, or shows `approved` immediately if the capability uses open
enrollment.

The same page is used for reapplication after rejection or expiry. When reapplying, pre-fill
the existing application note and show the previous admin review note as context.

---

#### `/marketplace/provide/:capability_slug/offer`

**Offer detail (provider's own view)**

Shows the provider's own offer record for this capability, including fields that buyers
cannot see (internal status, review note, created/updated timestamps).

If the offer is in `rejected` state, prominently shows the admin review note at the top.

Shows available actions based on current status:

| Status           | Available actions                                                                |
| ---------------- | -------------------------------------------------------------------------------- |
| `draft`          | Edit, Submit for review, Archive                                                 |
| `pending_review` | Archive (editing is not allowed while in review)                                 |
| `active`         | Edit (with warning that editing will pause the offer pending re-review), Archive |
| `rejected`       | Edit to address feedback, Archive                                                |
| `suspended`      | Archive only                                                                     |
| `archived`       | Reopen for editing                                                               |

---

#### `/marketplace/provide/:capability_slug/offer/edit`

**Offer create or edit form**

Used for both creating a new offer and editing an existing draft or rejected offer.

Fields:

- Headline (required, max 100 chars)
- Summary (required, max 500 chars): shown in provider cards on the capability page
- Description (required, markdown editor, max 10000 chars): shown on the full offer page
- Regions served (required, multi-select of region codes plus `all`)
- Pricing hint (optional, max 200 chars): free-form text shown on buyer-facing pages
- Contact mode: choose between platform message, external URL, or email
- Contact value: validated field based on chosen contact mode

Two save actions:

- "Save as Draft": saves without submitting for review
- "Submit for Review": saves and immediately submits

When editing an `active` offer, show a warning before the user saves: "Saving this edit
will temporarily hide your offer from buyers while it is under review."

---

#### `/marketplace/provide/:capability_slug/activity`

**Incoming subscription requests list**

Shows all subscriptions where the current org is the provider for this capability. Fetched
via the provider-side inbox (routes through the global routing table to consumer regional
DBs).

Each row shows: consumer org domain, subscription status badge, `updated_at`. Default sort:
most recently updated first.

Status filter chips at the top: All, Awaiting My Action, Active, Historical.

"Awaiting My Action" filters to `provider_review` status only (subscriptions the provider
needs to approve or reject).

Clicking a row navigates to the incoming subscription detail page.

---

#### `/marketplace/provide/:capability_slug/activity/:consumer_org_domain`

**Incoming subscription detail (provider's view)**

Shows the full subscription record from the provider's perspective:

- Consumer org domain
- Capability
- Request note from the consumer
- Current status
- Frozen gate fields (whether provider review, admin review, contract, payment are required)
- Relevant timestamps

Available actions depend on current status:

| Status             | Available actions                      |
| ------------------ | -------------------------------------- |
| `provider_review`  | Approve, Reject (review note required) |
| All other statuses | View only                              |

---

#### `/marketplace/purchases`

**Outgoing subscriptions list (buyer's view)**

Shows all subscriptions where the current org is the consumer, across all capabilities and
providers. Each row shows: capability display name, provider org domain, subscription status
badge, `updated_at`. Default sort: most recently updated first.

Status filter chips: All, Active, Pending, Historical.

Clicking a row navigates to the purchase detail page.

---

#### `/marketplace/purchases/from/:provider_org_domain/:capability_slug`

**Purchase detail (consumer's view)**

Shows the full subscription lifecycle from the consumer's perspective:

- Provider org domain and capability
- Request note submitted by the org
- Current status with a clear explanation of what the status means
- Next step description (e.g. "Awaiting provider approval", "Awaiting contract confirmation
  from Vetchium", "Subscription is active since [date]")
- Expiry date if set

Cancel button is shown for any non-terminal status. Cancellation requires confirmation.

If the subscription is terminal (rejected, cancelled, expired), shows a "Request Again"
button to re-enter the workflow for the same provider and capability.

---

### 12.2 Admin Portal

---

#### `/marketplace`

**Marketplace admin dashboard**

Landing page showing aggregate counts for operational queues that need attention:

- Enrollment applications pending review (link to enrollment-applications queue)
- Offers pending review (link to offers queue with pending_review filter)
- Subscriptions awaiting admin action (link to subscriptions queue with admin_review filter)
- Subscriptions awaiting contract or payment confirmation (links to relevant filtered views)
- Enrollments expiring within 30 days (link to enrollments queue with expiry filter)

These counts are the primary navigation signal for routine admin work.

---

#### `/marketplace/catalog`

**Capability catalog management**

Table of all capabilities at all statuses (`draft`, `active`, `disabled`). Shows: slug,
display name, status, enrollment approval mode, offer review mode, subscription approval
mode, number of active enrollments, number of active offers.

"Create New Capability" button navigates to the new capability form.

Status badge is color-coded. `draft` capabilities are clearly distinguished so they are not
confused with live capabilities.

---

#### `/marketplace/catalog/new`

**New capability form**

Form to create a new capability definition. All fields from the capability schema are
presented. New capabilities are always saved in `draft` status first. The admin must
explicitly enable them after review.

Field descriptions should explain the operational implications of each configuration choice
(e.g. the difference between `enrollment_approval = open` vs `manual` and when each is
appropriate).

---

#### `/marketplace/catalog/:capability_slug`

**Capability detail and edit**

Shows all current field values for the capability and allows editing them. Below the fields,
shows aggregate statistics: number of approved enrollments, number of active offers, number
of active subscriptions.

Available status actions:

| Current status | Available action                                  |
| -------------- | ------------------------------------------------- |
| `draft`        | Enable (moves to `active`)                        |
| `active`       | Disable (moves to `disabled`; cascades to offers) |
| `disabled`     | Re-enable (moves to `active`)                     |

Disabling a capability shows a confirmation warning listing the number of active offers
that will be suspended as a result.

---

#### `/marketplace/enrollment-applications`

**Enrollment application review queue**

Default view: all enrollments in `pending_review` status, sorted oldest first (to process
in order of submission).

Filter controls: capability slug, org domain, applied_at date range.

Each row shows: org domain, capability display name, applied_at, application note excerpt.

Clicking a row navigates to the enrollment review page.

---

#### `/marketplace/enrollment-applications/:org_domain/:capability_slug`

**Enrollment review page**

The primary decision page for admins reviewing a provider application. Shows two panels:

**Left panel — Org context**

Information about the org applying: org name, verified domains, account creation date,
number of existing enrollments (across all capabilities), brief account history relevant
to the decision.

**Right panel — Application**

- Capability being applied for (display name + description)
- Application note from the org
- Previous review history if this is a reapplication

**Decision actions**

- **Approve**: Admin sets optional `expires_at` and optional `billing_reference`. On submit,
  enrollment moves to `approved`.
- **Reject**: Admin must supply a `review_note` (max 2000 chars). This note is shown to the
  org. On submit, enrollment moves to `rejected`.

---

#### `/marketplace/enrollments`

**All enrollments**

Table of all enrollment records in all statuses. Default view: `approved` and `suspended`
statuses. Filters: capability, org domain, status, expiry date range.

Shows: org domain, capability, status, approved_at, expires_at, billing_status.

Used for monitoring active provider relationships and identifying enrollments needing
renewal before they expire.

Clicking a row navigates to the enrollment detail page.

---

#### `/marketplace/enrollments/:org_domain/:capability_slug`

**Enrollment detail**

Shows the full enrollment record and all available admin actions:

| Current status   | Available actions                                                        |
| ---------------- | ------------------------------------------------------------------------ |
| `approved`       | Suspend (note required), Renew (update expires_at and billing_reference) |
| `suspended`      | Reinstate                                                                |
| `expired`        | Renew (reactivates without requiring reapplication)                      |
| `rejected`       | No admin action needed; org can reapply                                  |
| `pending_review` | Redirects to the enrollment applications page for this record            |

Renewing an expiring enrollment extends `expires_at` from the current value (for proactive
renewal before lapse) or from now (if the enrollment has already expired).

---

#### `/marketplace/offers`

**Offer moderation and catalog health**

Default view: offers in `pending_review` status, sorted oldest first.

A "Catalog Health" summary at the top of the page shows: number of active offers by
capability, number of capabilities with zero active offers, number of suspended offers.

Filter controls: capability, org domain, status.

Each row shows: org domain, capability, offer headline, status, updated_at.

Clicking a row navigates to the offer detail page.

---

#### `/marketplace/offers/:org_domain/:capability_slug`

**Offer detail (admin view)**

Shows all offer fields including the admin-only `review_note`. Links to the provider's
enrollment record for context on their approval status.

Available actions based on current offer status:

| Status           | Available admin actions                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pending_review` | Approve (moves to `active`; global catalog mirror updated), Reject (note required) |
| `active`         | Suspend (note required; global catalog mirror updated)                             |
| `suspended`      | Reinstate (moves to `active` if enrollment is still `approved`)                    |

Approving an offer that belongs to a provider with an `expired` or `suspended` enrollment
is blocked. The page shows the enrollment status as context.

---

#### `/marketplace/subscriptions`

**All subscriptions**

Table of all subscription records across all consumer regions. Default view: non-terminal
statuses (`requested`, `provider_review`, `admin_review`, `awaiting_contract`,
`awaiting_payment`, `active`), sorted by `updated_at DESC`.

Filter controls: consumer org domain, provider org domain, capability, status.

Each row shows: consumer org, provider org, capability, status badge, updated_at.

Clicking a row navigates to the subscription detail page.

---

#### `/marketplace/subscriptions/:consumer_org_domain/from/:provider_org_domain/:capability_slug`

**Subscription detail (admin view)**

Shows the full subscription record including the frozen gate booleans so it is clear which
steps are still required before activation.

A status timeline shows the history of state transitions (from audit logs).

Available actions depend on current status:

| Status              | Available admin actions                                           |
| ------------------- | ----------------------------------------------------------------- |
| `admin_review`      | Approve (advances to next gate or active), Reject (note required) |
| `awaiting_contract` | Mark Contract Signed, Waive Contract Requirement                  |
| `awaiting_payment`  | Record Payment (sets starts_at), Waive Payment Requirement        |
| Any non-terminal    | Cancel                                                            |

Waiving contract or payment requires an admin note explaining the reason (this note is
stored in the billing record for audit purposes).

---

#### `/marketplace/billing`

**Billing records**

Read-only list of all billing events recorded against subscriptions. Each record
corresponds to a significant billing event such as subscription activation, payment
waiver, or contract waiver.

Filter controls: consumer org domain, provider org domain, capability.

Shows: consumer org, provider org, capability, event type, note, created_at.

This page provides the admin with a complete audit trail of commercial decisions made
on the platform, including all waivers.

---

## 13. DB Schema

Add to the existing initial schema migrations directly. Do not create new migration files.

### 13.1 Global DB

```sql
CREATE TABLE marketplace_capabilities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_slug       TEXT        NOT NULL UNIQUE,
  display_name          TEXT        NOT NULL,
  description           TEXT        NOT NULL DEFAULT '',
  provider_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  consumer_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  enrollment_approval   TEXT        NOT NULL CHECK (enrollment_approval IN ('open', 'manual')),
  offer_review          TEXT        NOT NULL CHECK (offer_review IN ('auto', 'manual')),
  subscription_approval TEXT        NOT NULL CHECK (subscription_approval IN ('direct', 'provider', 'admin', 'provider_and_admin')),
  contract_required     BOOLEAN     NOT NULL DEFAULT FALSE,
  payment_required      BOOLEAN     NOT NULL DEFAULT FALSE,
  pricing_hint          TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_capability_slug_aliases (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id   UUID        NOT NULL REFERENCES marketplace_capabilities(id),
  alias_slug      TEXT        NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_org_domain_aliases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_global_id    UUID        NOT NULL,
  alias_domain     TEXT        NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_offer_catalog (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_org_global_id UUID        NOT NULL,
  provider_org_domain    TEXT        NOT NULL,
  provider_region        TEXT        NOT NULL,
  capability_slug        TEXT        NOT NULL,
  headline               TEXT        NOT NULL,
  summary                TEXT        NOT NULL,
  pricing_hint           TEXT,
  regions_served         TEXT[]      NOT NULL,
  contact_mode           TEXT        NOT NULL CHECK (contact_mode IN ('platform_message', 'external_url', 'email')),
  status                 TEXT        NOT NULL CHECK (status IN ('active', 'suspended', 'archived')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_org_global_id, capability_slug)
);
CREATE INDEX marketplace_offer_catalog_capability_status
  ON marketplace_offer_catalog (capability_slug, status, provider_org_domain);

CREATE TABLE marketplace_subscription_routing (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_org_global_id UUID        NOT NULL,
  consumer_org_domain    TEXT        NOT NULL,
  consumer_region        TEXT        NOT NULL,
  provider_org_global_id UUID        NOT NULL,
  provider_org_domain    TEXT        NOT NULL,
  provider_region        TEXT        NOT NULL,
  capability_slug        TEXT        NOT NULL,
  status                 TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consumer_org_global_id, provider_org_global_id, capability_slug)
);
CREATE INDEX marketplace_subscription_routing_provider
  ON marketplace_subscription_routing (provider_org_global_id, status, updated_at DESC);

CREATE TABLE marketplace_billing_records (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_org_global_id UUID        NOT NULL,
  consumer_org_domain    TEXT        NOT NULL,
  provider_org_global_id UUID        NOT NULL,
  provider_org_domain    TEXT        NOT NULL,
  capability_slug        TEXT        NOT NULL,
  event_type             TEXT        NOT NULL,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 13.2 Regional DB

```sql
CREATE TABLE marketplace_enrollments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  capability_slug   TEXT        NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected', 'suspended', 'expired')),
  application_note  TEXT,
  review_note       TEXT,
  approved_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  billing_reference TEXT,
  billing_status    TEXT        NOT NULL DEFAULT 'not_applicable' CHECK (billing_status IN ('not_applicable', 'pending', 'active', 'suspended')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, capability_slug)
);

CREATE TABLE marketplace_offers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   UUID        NOT NULL REFERENCES marketplace_enrollments(id),
  org_id          UUID        NOT NULL,
  capability_slug TEXT        NOT NULL,
  headline        TEXT        NOT NULL DEFAULT '',
  summary         TEXT        NOT NULL DEFAULT '',
  description     TEXT        NOT NULL DEFAULT '',
  regions_served  TEXT[]      NOT NULL DEFAULT '{}',
  pricing_hint    TEXT,
  contact_mode    TEXT        NOT NULL CHECK (contact_mode IN ('platform_message', 'external_url', 'email')),
  contact_value   TEXT        NOT NULL DEFAULT '',
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'active', 'rejected', 'suspended', 'archived')),
  review_note     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, capability_slug)
);

CREATE TABLE marketplace_subscriptions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_org_id          UUID        NOT NULL,
  consumer_org_domain      TEXT        NOT NULL,
  provider_org_global_id   UUID        NOT NULL,
  provider_org_domain      TEXT        NOT NULL,
  provider_region          TEXT        NOT NULL,
  capability_slug          TEXT        NOT NULL,
  request_note             TEXT,
  requires_provider_review BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_admin_review    BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_contract        BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_payment         BOOLEAN     NOT NULL DEFAULT FALSE,
  status                   TEXT        NOT NULL CHECK (status IN ('requested', 'provider_review', 'admin_review', 'awaiting_contract', 'awaiting_payment', 'active', 'rejected', 'cancelled', 'expired')),
  review_note              TEXT,
  starts_at                TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consumer_org_id, provider_org_global_id, capability_slug)
);
CREATE INDEX marketplace_subscriptions_consumer_org
  ON marketplace_subscriptions (consumer_org_id, status, updated_at DESC);
```

---

## 14. Keyset Pagination Reference

| Endpoint                            | Sort order                                                                               | Cursor                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `capabilities/list`                 | `capability_slug ASC`                                                                    | `capability_slug`                                                         |
| `provider-enrollments/list`         | `created_at DESC, capability_slug ASC`                                                   | `{created_at, capability_slug}`                                           |
| `providers/list`                    | `provider_org_domain ASC, capability_slug ASC`                                           | `{provider_org_domain, capability_slug}`                                  |
| `consumer-subscriptions/list`       | `updated_at DESC, provider_org_domain ASC, capability_slug ASC`                          | `{updated_at, provider_org_domain, capability_slug}`                      |
| `incoming-subscriptions/list`       | `updated_at DESC, consumer_org_domain ASC, capability_slug ASC`                          | `{updated_at, consumer_org_domain, capability_slug}`                      |
| `admin/provider-enrollments/list`   | `created_at DESC, org_domain ASC, capability_slug ASC`                                   | `{created_at, org_domain, capability_slug}`                               |
| `admin/provider-offers/list`        | `updated_at DESC, org_domain ASC, capability_slug ASC`                                   | `{updated_at, org_domain, capability_slug}`                               |
| `admin/consumer-subscriptions/list` | `updated_at DESC, consumer_org_domain ASC, provider_org_domain ASC, capability_slug ASC` | `{updated_at, consumer_org_domain, provider_org_domain, capability_slug}` |
| `admin/billing/list`                | `created_at DESC, consumer_org_domain ASC, provider_org_domain ASC, capability_slug ASC` | `{created_at, consumer_org_domain, provider_org_domain, capability_slug}` |

All `limit` values must be between 1 and 100 inclusive.

---

## 15. Out of Scope for V1

- Hub portal marketplace routes
- Multiple concurrent offers per `(org, capability_slug)`
- Multiple concurrent subscriptions per `(consumer_org, provider_org, capability_slug)`
- Capability-specific typed offer attributes
- Inline contract document upload and e-signature
- Live payment gateway integration
- Provider billing integration
- Offer packages or tiered pricing
- Admin UI for slug or domain rename workflows

---

## 16. Build Order

1. Add global DB schema (section 13.1).
2. Add regional DB schema (section 13.2).
3. Add marketplace roles to `initial_schema.sql`, `roles.ts`, and `roles.go`.
4. Write TypeSpec contracts from section 11.
5. Admin: capability catalog CRUD (section 11.7).
6. Org: capability catalog reads (section 11.1).
7. Org: provider enrollment apply/reapply/get/list (section 11.2).
8. Admin: enrollment approve/reject/suspend/reinstate/renew/get/list (section 11.8).
9. Org: provider offer create/update/submit/archive/get (section 11.3).
10. Admin: offer approve/reject/suspend/reinstate/get/list (section 11.9).
11. Global offer catalog mirror writes and reconciliation worker.
12. Org: buyer discovery reads from global catalog (section 11.4).
13. Org: consumer subscription request/cancel/get/list (section 11.5).
14. Global subscription routing writes and reconciliation worker.
15. Org: incoming-subscription inbox for providers (section 11.6).
16. Admin: subscription lifecycle actions (section 11.10).
17. Admin: billing list (section 11.11).
18. Background workers: enrollment expiry, subscription expiry.
19. Org portal UI (section 12.1).
20. Admin portal UI (section 12.2).
21. Playwright coverage for 400, 401, 403, 404, 409, 422, audit logs, and alias-resolution cases.
