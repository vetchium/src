# Vetchium Org Tiers Specification

Status: Draft (brainstorm)
Date: 2026-04-18
Dependencies: all Org-facing verticals — Hiring, Marketplace (`specs/14-marketplace/`),
Org Posts/Streams (future), SubOrgs, Audit Logs, Invoicing (`specs/15-invoicing/`).

---

## 1. What This Is

Org Tiers define the features and quotas an Organization gets on the Vetchium
platform. Every Org is on **exactly one tier at a time**. Tiers are the platform's
primary monetization mechanism — the value prop is "pay $X/month (or ₹ / €), get a
defined bundle of features and limits".

Tiers replace per-feature metered billing across the platform. When a new feature is
added, it is slotted into an existing tier or becomes the unlock for a new/higher
tier — not priced individually.

Hub Users have their own separate tier structure (free basic use; paid premium
unlocks profile picture, articles, advanced search). **Not covered by this spec.**

---

## 2. Design Principles

- **Predictable**: within a tier, an Org's bill is constant. No surprise usage fees.
- **Bundled**: one tier unlocks features across the entire platform (Hiring,
  Marketplace, Posts, SubOrgs, audit retention, etc.).
- **Capped, not metered**: crossing a quota blocks the next operation with an upgrade
  prompt — it does not silently bill the Org more.
- **Upgrade-friendly**: upgrades take effect immediately. Downgrades require the Org
  to already be within the new tier's caps for every enforced quota.
- **Regionally priced**: the same tier may carry different price points in different
  regions (India, EU, US initially).
- **Admin-overridable**: admins can grant tiers, waive fees, and force state changes
  for legitimate commercial and moderation reasons. All such actions are audited.

---

## 3. Tier Ladder (initial proposal)

Exact quotas and prices are placeholders for the bootstrap launch; iterate based on
real usage.

### 3.1 Free

Default for every new Org on signup. Lets Orgs try the core product.

- Up to 5 Org Users
- Domain verification: up to 2 domains
- **Openings**: up to 5 active
- **Hiring workflow**: Applications, Candidacies, Interviews, Offer Agreements — full
  pipeline included
- **Marketplace**: discover and subscribe (consume). **Cannot publish Listings.**
- Org Posts / Streams: none
- SubOrgs: none
- Audit log retention: 30 days
- Price: ₹0 / $0 / €0

### 3.2 Silver

For Orgs serious about hiring who want to start operating on Vetchium more fully.

- Up to 25 Org Users
- Domain verification: up to 5 domains
- **Openings**: up to 100 active
- **Marketplace**: up to 5 active Listings (each Listing may span multiple
  Capabilities, see `specs/14-marketplace/`)
- Org Posts / Streams: 1 Stream
- SubOrgs: up to 3
- Audit log retention: 1 year
- Price: region-specific (₹ / $ / €), set at launch

### 3.3 Gold

For Orgs running significant operations — staffing firms, multi-site employers,
service providers.

- Up to 100 Org Users
- Unlimited verified domains
- **Openings**: up to 500 active (or unlimited — TBD)
- **Marketplace**: up to 20 active Listings
- Org Posts / Streams: multiple Streams
- SubOrgs: up to 10
- Audit log retention: 3 years
- Priority support
- Price: region-specific

### 3.4 Enterprise

Multinationals and large operators. Custom commercial terms.

- Custom caps across all axes
- Custom data residency constraints
- SLAs
- Dedicated account support
- Pricing by contract

---

## 4. Mechanics

### 4.1 Enforcement

Each quota is checked at the point of use. If at cap, the operation is rejected (403)
with a clear message and an upgrade CTA.

- Creating an Opening → count current `active` Openings for the Org.
- Publishing a Marketplace Listing (or submitting for review) → count current
  `active` + `pending_review` Listings for the Org.
- Inviting an Org User beyond cap → block, with CTA.
- Creating a SubOrg beyond cap → block.
- Adding a verified domain beyond cap → block.

Soft-limit quotas (e.g., audit log retention) enforce automatically via background
job — older records are pruned / archived.

### 4.2 Upgrades

Upgrades take effect immediately. The new tier's quotas apply from the next
operation. Billing is pro-rated for the remainder of the current period or applied on
the next cycle — choice TBD (annual vs monthly billing interacts here).

### 4.3 Downgrades

Downgrades require the Org to already be within the target tier's caps for every
enforced quota. If not, the downgrade UI surfaces the blocking items with remediation
steps (archive Listings, close Openings, remove SubOrgs, etc.). Orgs must resolve
these before the downgrade proceeds.

### 4.4 Admin-Forced State Changes

Admins can:

- **Grant a tier** to an Org (free or discounted) for commercial reasons (early
  customer, partner, non-profit).
- **Waive fees** for a billing period.
- **Suspend** an Org's subscription for non-payment or policy violation — the Org's
  tier effectively drops to a `frozen` state (read-only on paid features; active
  resources above Free caps become read-only but are not deleted).
- **Force-downgrade** in extreme cases, applying the `frozen` rule above.

All admin actions emit `admin_audit_logs` entries.

### 4.5 Billing

- Subscription is per-Org. SubOrgs inherit the parent's tier — no separate billing.
- Billing period: monthly or annual (Org's choice; annual may be discounted).
- Payment: **out of scope for V1** beyond recording what the admin has manually
  reconciled. Vetchium may integrate an external billing provider (e.g., Stripe) at
  launch and feed results into the Org Subscription state, or use the in-platform
  Invoicing infrastructure (`specs/15-invoicing/` with `source_type =
  org_subscription`). Decision deferred.
- One Org Subscription record per Org, with billing periods as child records.

### 4.6 First-Party Vetchium Services

When Vetchium itself provides managed services (e.g., document signing, background
verification in specific regions), these are add-ons on top of the tier — priced
per use or bundled into higher tiers. Specified per-service as those features are
built.

---

## 5. Entities (conceptual)

Column-level schemas deferred while in brainstorm mode. Rough shape:

### 5.1 Tier Definition

A catalog of available tiers, set by Vetchium admins.

- `tier_id` — stable identifier (e.g., `free`, `silver`, `gold`, `enterprise`).
- `display_name`, `description` (per-locale translations).
- `quotas` — structured map of enforceable quota keys (`openings_active`,
  `listings_active`, `org_users`, `domains_verified`, `streams_active`,
  `suborgs_count`, `audit_retention_days`) to numeric caps or `unlimited`.
- `price_points` — per-region, per-period (`monthly` | `annual`) amounts and
  currency.
- `status` — `draft` | `active` | `retired`.
- Storage: **Global DB** (admin-owned catalog).

### 5.2 Org Subscription

The Org's current tier + history.

- `org_subscription_id` — internal identifier.
- `org_domain` or `org_id` — the Org.
- `current_tier_id`.
- `billing_period` — `monthly` | `annual`.
- `current_period_start`, `current_period_end`.
- `state` — `active` | `past_due` | `frozen` | `cancelled`.
- `granted_by_admin_id` — nullable (for admin-granted tiers).
- Historical tier transitions (via an immutable `org_subscription_history` trail).
- Storage: **Global DB** (tier + billing are platform-global concerns).

### 5.3 Quota Enforcement

No dedicated table — quotas are enforced at write time by counting existing rows in
the feature's own table (e.g., `COUNT(*) WHERE org_domain = X AND status IN
('active','pending_review')` for Listings). A small helper lookup maps Org → current
tier → quotas.

---

## 6. RBAC

### Org portal

- `org:manage_subscription` — view current tier and usage, initiate upgrade/downgrade,
  view billing history. Typically held by superadmin or a finance role.
- `org:view_subscription` — read-only on own subscription and usage.
- `org:superadmin` — bypasses.

### Admin portal

- `admin:manage_org_subscriptions` — grant tiers, waive fees, force state changes.
- `admin:view_org_subscriptions` — read-only.
- `admin:superadmin` — bypasses.

| Action                                           | Required role                                       |
| ------------------------------------------------ | --------------------------------------------------- |
| View own tier + usage dashboard                  | `org:view_subscription` or `org:manage_subscription`|
| Upgrade / downgrade own Org's tier               | `org:manage_subscription`                           |
| Admin: grant / waive / suspend / force-downgrade | `admin:manage_org_subscriptions`                    |
| Admin: read-only views                           | `admin:view_org_subscriptions` or manage            |

---

## 7. UI Screens

### 7.1 Org portal — `/settings/subscription`

Current tier card (tier name, price, next renewal date, state).

**Usage vs quota** panel: progress bars or rows per enforced quota (Openings, Listings,
Streams, SubOrgs, etc.) showing current usage and cap. Visible to anyone with
`org:view_subscription` or `org:manage_subscription`.

**Upgrade / downgrade** section: available tiers comparison, with per-quota cap
differences highlighted. Upgrade button for higher tiers; downgrade requires
confirmation and surfaces any blocking over-cap resources.

**Billing history**: list of past billing periods with invoice links (if
`org_subscription` source_type is used in Invoicing).

### 7.2 Upgrade block at point of use

Wherever a quota is hit (Create Opening, Publish Listing, Add Domain, etc.), the
error response drives an inline modal: "You've reached your Silver tier's 5-Listing
limit. Upgrade to Gold to publish up to 20 Listings." Direct link to the upgrade
flow.

### 7.3 Admin portal — `/admin/org-subscriptions`

List of all Orgs with tier, state, billing status. Filters: tier, state, region,
past-due. Row actions: grant tier, waive period fee, suspend/unsuspend, force
downgrade (with required reason note — audited).

### 7.4 Admin portal — Tier catalog management

CRUD on Tier definitions: quotas, per-region prices, per-locale translations.

---

## 8. Audit Logging

All tier-related writes emit audit entries (regional `audit_logs` for Org-initiated
actions, global `admin_audit_logs` for admin-initiated actions):

- `org.subscription_tier_upgraded`
- `org.subscription_tier_downgraded`
- `org.subscription_billing_period_changed`
- `admin.org_subscription_granted`
- `admin.org_subscription_fee_waived`
- `admin.org_subscription_suspended`
- `admin.org_subscription_unsuspended`
- `admin.org_subscription_force_downgraded`
- `admin.tier_catalog_created` / `admin.tier_catalog_updated`

---

## 9. Open Questions / Future Work

- **Exact tier names**: "Silver / Gold / Enterprise" is placeholder — may end up as
  "Starter / Growth / Business / Enterprise" or similar. Pick before launch.
- **Quota numbers**: placeholders. Validate against design-partner usage.
- **Annual vs monthly discount**: standard 15–20%? decide at pricing review.
- **Per-seat pricing within tiers**: some platforms charge per-seat on top of tier.
  Decision deferred — initial proposal is strict per-tier user caps, no per-seat.
- **Regional pricing matrix**: set at launch per region (INR, USD, EUR).
- **Payment integration**: Stripe vs in-platform invoicing vs manual. Decide for V1
  launch.
- **Trial tier or trial period for paid tiers**: optional; decide based on sales
  motion.
- **Grace period for `past_due`**: how long before state → `frozen`? 14 days is
  industry standard.
- **What counts against "active Opening" cap**: currently-published + internal
  drafts? Decide precisely per quota.
- **SubOrg tier inheritance**: proposal says SubOrgs share parent tier and caps are
  platform-wide per parent. Confirm with Enterprise customers who might want
  per-SubOrg quotas.
- **Hub User tier spec**: separate future spec.
- **Column-level schemas**: defer until implementation.
