# Vetchium Marketplace Specification

Status: Draft
Date: 2026-04-18

---

## 1. What This Is

Vetchium Marketplace is a B2B professional services directory built into the Vetchium
platform. Organizations that offer professional services publish **Listings** to be
discovered by organizations that need them. When a Consumer Org finds a suitable
provider, they create a **Subscription** to formally record the relationship on the
platform. Commercial settlement between the two Orgs is tracked via **Invoices**,
specified separately in `specs/15-invoicing/`.

Vetchium defines the Capability catalog and acts as a neutral record-keeper for
Listings and Subscriptions. **Vetchium does not intermediate payments between Orgs.**
Money moves directly between Provider and Consumer via whatever channel they have
agreed off-platform.

---

## 2. Participants

| Participant  | Role                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Vetchium     | Platform operator. Defines the Capability catalog. Can suspend any Listing. Does not touch Org↔Org money. |
| Provider Org | Publishes Listings. Delivers services to Consumer Orgs.                                                   |
| Consumer Org | Browses, subscribes, engages Provider Orgs for services.                                                  |

An organization may simultaneously be a Provider for some Capabilities and a Consumer
for others. An organization may not subscribe to its own Listing.

---

## 3. Business Model

### 3.1 Vetchium charges Orgs via platform tiers, not per Listing

The Marketplace has **no per-Listing or per-Capability fee**. Access to marketplace
features is gated by the Org's platform tier, specified in `specs/16-org-tiers/`. In
brief:

- **Free tier**: an Org can discover and subscribe (consume), but cannot publish Listings.
- **Silver tier (paid)**: up to 5 active Listings, each covering one or more Capabilities.
- **Gold tier (paid)**: higher Listing cap + Org Posts/Streams + other features.
- **Enterprise**: custom.

Listings are counted as "active" or "pending_review"; `draft`, `suspended`, `archived`
do not count against the cap.

This design choice (tier-based not metered) is motivated by: predictability for buyers,
bundling all platform features into a coherent product, and avoiding the metering
infrastructure and leakage incentives that come with per-feature transaction fees.

### 3.2 Vetchium does NOT take a cut on Subscription value

A Subscription is a **relationship record**, not a billing event. When a Consumer Org
subscribes to a Listing, no money flows through Vetchium on that axis. The Provider and
Consumer negotiate commercial terms between themselves (captured in their Agreement, a
platform-level construct) and settle payment off-platform via whatever channel they
already use — bank transfer, wire, ACH, cheque.

This is a deliberate choice:

- **Bootstrapped reality**: Vetchium cannot responsibly build merchant-of-record,
  KYC/AML, and multi-region tax infrastructure early in its life.
- **Leakage**: Providers routed through a take-rate would simply invoice clients
  off-platform after month one. An uncollectible tax is worse than no tax.
- **Social contract**: consistent with "no cut on Job Offerings" — Vetchium charges for
  platform presence and tooling, not for counterparties' revenue.

### 3.3 Invoicing lives in a separate spec

Invoicing is cross-cutting — it applies to Marketplace Subscriptions today and will apply
to staffing-partner placement fees in the Hiring vertical. See `specs/15-invoicing/`.

Vetchium generates invoice PDFs, assigns per-Issuer sequential numbers, and tracks
`draft` → `issued` → `acknowledged` → `paid`/`disputed`/`void`. Vetchium does not
process payments or certify tax correctness.

### 3.4 Future: opt-in payment orchestration ("Vetchium Pay")

Once the platform has scale and a cross-region compliance posture, Vetchium may offer
an opt-in payment orchestration layer bundling escrow, dispute resolution, and
remittance. This would be a separately priced add-on, not a tax on all transactions.
**Deferred.**

---

## 4. Core Entities

### 4.1 Capability

A Capability is a category of professional service defined by Vetchium admins. It is
pure taxonomy — **no per-Capability fees**.

Examples: `talent-sourcing`, `background-verification`, `payroll-processing`,
`physical-security`, `kitchen-management`.

**Shape:**

- Unique `capability_id` (lowercase alphanumeric + hyphens, 3–50 chars, immutable).
- Status: `draft` | `active` | `disabled`.
  - `draft`: admin-only. Orgs cannot include on Listings.
  - `active`: Orgs may include on Listings.
  - `disabled`: no new inclusions; existing Listing↔Capability associations continue
    until edited.
- Translations: per-locale `display_name` (1–100 chars) and `description` (markdown,
  max 5000 chars). `en-US` required; other locales fall back.
- Storage: **Global DB** (admin-owned, catalog-level).

> Naming note: the Vetchium Manifesto also uses "Capability" for platform-level
> feature gates (profile pictures, articles, etc.). These two uses are distinct.
> Consider renaming Marketplace's "Capability" to "Service Category" in a future
> pass to remove the overload.

---

### 4.2 Listing

A Listing is a Provider Org's service offering spanning **one or more Capabilities**.
It is the atomic unit of discovery and subscription in the Marketplace.

**Multi-Capability design**: a Listing carries a list of Capabilities rather than a
single one. This supports bundled offerings ("Executive Search with integrated
background verification") without forcing Providers to maintain multiple parallel
Listings with duplicated content. Capabilities are pure tags for discovery — they do
not affect billing.

**Key semantic fields:**

- `listing_id` — internal identifier, **not exposed in URLs**.
- `listing_number` — strictly-increasing per-Org integer, assigned at creation via an
  atomic per-Org counter, immutable, never reused. Starts at 1 per Provider.
- `org_domain` — Provider's canonical current domain.
- `headline` (max 100 chars) + `description` (markdown, max 10000 chars).
- `capabilities` — set of `capability_id`s, minimum 1, soft cap 5 (admin-settable).
  Stored as a regional join table with `added_at` / `removed_at` for audit history.
- `status` — see §4.2.1.
- `suspension_note`, `rejection_note` — admin/approval context fields.
- `active_subscriber_count` — computed.

**Identity**: `(org_domain, listing_number)` is the public identity used in URLs.
`listing_id` is internal only.

**Storage**: authoritative state lives in the **Provider's regional DB**. A global
mirror row (headline, description, capabilities, `org_domain`, `listing_number`)
exists to support cross-region discovery.

**Quota**: the total number of `active` + `pending_review` Listings an Org holds at
any time is capped by the Org's platform tier (`specs/16-org-tiers/`). Attempting to
publish or submit-for-review beyond the cap returns 403 with an upgrade prompt.

#### 4.2.1 Listing States

```
draft            → pending_review  (non-superadmin with org:manage_listings submits for review)
draft            → active          (org:superadmin publishes — self-approval)
pending_review   → active          (org:superadmin approves)
pending_review   → draft           (org:superadmin rejects, with rejection_note)
active           → suspended       (Vetchium admin action: policy violation)
suspended        → active          (Vetchium admin reinstates)
active           → archived        (provider with org:manage_listings archives)
suspended        → archived        (provider archives a suspended listing)
archived         → draft           (provider wants to re-list)
```

A provider may edit a Listing only in `draft` or `active` state. Edits to an `active`
Listing are live immediately — the Listing is not hidden during the edit.

**Editing Capabilities on an active Listing**:

- Adding a Capability takes effect immediately; discovery surface expands.
- Removing a Capability takes effect immediately; Subscriptions to the Listing are
  unaffected (a Subscription is to the Listing, not to any single Capability on it).
- The last remaining Capability cannot be removed (422). Archive the Listing or add
  a replacement Capability first.

**Publish authorization — two layers:**

1. **Vetchium admin gate**: none. Vetchium does not review Listings before they go live.
   Vetchium can only suspend a Listing after the fact.
2. **Intra-org approval**: non-superadmin with `org:manage_listings` → `pending_review`;
   an `org:superadmin` must approve. Superadmin "Publish" goes directly to `active`
   (essential for single-user orgs).

**Rejection note**: when a superadmin rejects a `pending_review` listing, a
`rejection_note` (up to 2000 chars) is required. It is displayed on the Listing page
while the listing is in `draft` and cleared on the next re-submit.

---

### 4.3 Subscription

A Subscription records that a Consumer Org has subscribed to a specific Provider
Listing. **One Subscription covers all Capabilities on that Listing** — the Consumer
does not subscribe per-Capability. This matches buyer intent (they subscribe to the
_offering_, not individual service categories).

When a Subscription is created it goes directly to `active` — the Consumer immediately
sees the Provider's contact information to initiate the relationship off-platform.

**Rules:**

- At most one `active` Subscription per (Consumer Org, Listing). Re-subscribing to a
  `cancelled`/`expired` Subscription reactivates the existing record with a new
  `started_at`.
- Carries no billable amount on Vetchium — commercial terms live in an Agreement, and
  settlement via Invoices (`specs/15-invoicing/`).

**Key semantic fields:**

- `subscription_id` — internal, not exposed in URLs.
- `listing_id` — the subscribed Listing.
- `consumer_org_domain`.
- `provider_org_domain` + `provider_listing_number` — denormalized from the Listing to
  form the stable URL key.
- `request_note` — Consumer's optional introductory note (max 2000 chars).
- `status` — `active` | `cancelled` | `expired`.
- `started_at`, `expires_at` (nullable), `cancelled_at` (nullable).

**URL identity**: Subscriptions are identified from the Consumer side by the Listing
coordinates (`<provider-org-domain>/<listing_number>`). Historical cancelled/expired
records for the same pair share the URL; the page shows the most recent.

**No `capability_id` field**: the previous single-Capability design had this
denormalized; with multi-Capability Listings it no longer has a single value. Filtering
Subscriptions by Capability joins through the Listing's Capability set.

**Storage**: authoritative state lives in the **Consumer's regional DB**. A global
routing index lets Providers query their subscribers across regions.

---

## 5. RBAC

### Org portal

- `org:manage_listings` — create, edit, archive, reopen own Listings; approve/reject
  pending_review as superadmin; view subscriber list.
- `org:view_listings` — read-only on own Listings + subscribers.
- `org:manage_subscriptions` — create, cancel, re-subscribe (Consumer side).
- `org:view_subscriptions` — read-only on own Subscriptions.
- `org:superadmin` — bypasses all org marketplace checks.

### Admin portal

- `admin:manage_marketplace` — writes on Capabilities (catalog), Listings (suspend),
  Subscriptions (cancel).
- `admin:view_marketplace` — read-only.
- `admin:superadmin` — bypasses.

| Action                                                       | Required role                                          |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| Browse active Capabilities and Listings                      | Any authenticated org user                             |
| Create / edit own Listings                                   | `org:manage_listings`                                  |
| View own Listings + subscribers                              | `org:view_listings` or `org:manage_listings`           |
| Create / cancel Subscriptions                                | `org:manage_subscriptions`                             |
| View own Subscriptions                                       | `org:view_subscriptions` or `org:manage_subscriptions` |
| Admin: Capability CRUD, suspend Listing, cancel Subscription | `admin:manage_marketplace`                             |
| Admin: read-only views                                       | `admin:view_marketplace` or `admin:manage_marketplace` |

---

## 6. Data Architecture (conceptual)

Concrete schemas are out of scope while the spec is in brainstorm mode. The rough
shape:

- **Capability catalog** lives in the **Global DB** (admin-owned, shared).
- **Listings + Listing↔Capability join + per-Org Listing counter** live in the
  **Provider's regional DB**. A **global Listing mirror** exists for cross-region
  discovery (stores the discovery fields and the stable URL key).
- **Subscriptions** live in the **Consumer's regional DB**. A **global subscription
  routing index** lets Providers query subscribers across regions.

All cross-DB writes follow the project's existing global-first / regional-second
pattern with compensating transactions on failure.

Column-level schemas are deferred until the spec is implementation-ready.

---

## 7. UI Screens — Org Portal

### 7.1 Dashboard Tiles

| Tile                 | Route                        | Visible when                                           |
| -------------------- | ---------------------------- | ------------------------------------------------------ |
| **Marketplace**      | `/marketplace/discover`      | Any authenticated user                                 |
| **My Subscriptions** | `/marketplace/subscriptions` | `org:manage_subscriptions` or `org:view_subscriptions` |
| **My Listings**      | `/marketplace/listings`      | `org:manage_listings` or `org:view_listings`           |
| **My Clients**       | `/marketplace/clients`       | `org:manage_listings` or `org:view_listings`           |

(The Invoices tile lives under `specs/15-invoicing/`.)

### 7.2 `/marketplace/discover` — Marketplace

Flat paginated list of active Listings across all Capabilities. Each card: headline,
Provider org domain, **all Capability tags** (pills), truncated description.

Filters: **Capability** (multi-select; match-any) and full-text search.

Clicking a card opens `/marketplace/listings/<provider-domain>/<listing_number>`
(§7.3).

### 7.3 `/marketplace/listings/<org-domain>/<listing_number>` — Listing Page (role-aware)

Single canonical page, rendered differently based on the viewer's relationship to the
Provider:

- **Buyer view** (viewer's org ≠ Provider): headline, description, all Capability
  tags, listed date. Subscribe / Re-subscribe button based on existing Subscription
  state. Info banner if the viewer already has an active Subscription.
- **Provider management view**: buyer content + action panel per status (Edit,
  Archive, Publish, Approve/Reject, Reopen) + **Subscribers** section.
- **Admin view**: buyer content + admin actions (Suspend / Reinstate).

Router note: `/marketplace/listings` (index) and `/marketplace/listings/new` (create)
are literal-path routes that take precedence over the `:org-domain/:listing_number`
pattern.

### 7.4 `/marketplace/listings` — My Listings (Provider-side index)

Table of the Org's own Listings (all statuses). Columns: `#<listing_number>`,
Headline, Capabilities (pills), Status, Active Subscribers, Created. **"Create
Listing"** button top-right; disabled with an upgrade prompt if the Org is at its
tier's Listings cap.

### 7.5 `/marketplace/listings/new` — Create Listing

Single step form:

- **Capabilities** — multi-select searchable chooser. At least 1, up to the admin
  soft cap (default 5).
- **Headline** — max 100 chars.
- **Description** — markdown, max 10000 chars.

Pre-selection via `?capability=<id>`.

Actions: **Save Draft**, **Publish** (→ active for superadmin, → pending_review
otherwise). On creation, `listing_number` is assigned atomically from the per-Org
counter.

### 7.6 Manage One Listing — actions by status

| Status           | `org:superadmin` sees                                   | `org:manage_listings` (non-superadmin) sees               |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `draft`          | Edit, Publish (→ active directly)                       | Edit, Publish (→ pending_review)                          |
| `pending_review` | Approve (→ active), Reject with required note (→ draft) | Info message: "Awaiting superadmin approval." No actions. |
| `active`         | Edit, Archive                                           | Edit, Archive                                             |
| `suspended`      | Suspension note shown. Archive.                         | Suspension note shown. Archive.                           |
| `archived`       | Reopen (→ draft)                                        | Reopen (→ draft)                                          |

Reject modal: required `rejection_note` textarea (max 2000 chars); Reject disabled
until text entered.

### 7.7 `/marketplace/listings/<my-domain>/<listing_number>/edit` — Edit

Same form as Create, pre-populated. Capabilities editable; last-Capability-removal
blocked (422). Active-Listing edits live immediately.

### 7.8 `/marketplace/subscriptions` — My Subscriptions (Consumer)

Rows: Provider org, Listing `#<n>` + headline, Capabilities (pills), Status,
Subscribed-since. Status filter: All / Active / Historical.

Row links to `/marketplace/subscriptions/<provider-domain>/<listing_number>` (§7.9).

### 7.9 `/marketplace/subscriptions/<provider-domain>/<listing_number>` — Subscription Detail

Consumer-side view. Full Subscription details + the current Listing inline.

- `active` → **Cancel Subscription** with confirmation.
- Terminal → **Re-subscribe** → navigates to the Listing page (§7.3).

### 7.10 `/marketplace/clients` — My Clients (Provider-side cross-listing)

All Subscriptions where the viewing Org is Provider. Columns: Consumer org, Listing
(`#<n>` + headline), Capabilities, Status, Started, Expires.

Rows link to the Listing page (§7.3) with the Subscribers section in focus.

---

## 8. UI Screens — Admin Portal

### 8.1 Capability Management

Admin list shows all Capabilities regardless of status. Create / edit form:
`capability_id` (immutable), `status`, per-locale `display_name` and `description`
(`en-US` required; others fall back).

**No fee fields** — Capabilities are pure taxonomy.

### 8.2 Listing Oversight

Admins may suspend or reinstate any active Listing. Admin Listing list filterable by
org, Capability, status. Admin detail views reuse `/marketplace/listings/<org-domain>/
<listing_number>` with admin actions layered on.

### 8.3 Subscription Oversight

Admins view all Subscriptions across all orgs and may cancel any if necessary.

(No marketplace-specific billing admin — Vetchium-to-Org billing lives in the Org
Tier admin UI, `specs/16-org-tiers/`.)

---

## 9. Open Questions / Future Work

- **Max Capabilities per Listing**: initial soft cap of 5 (admin-settable). Revisit
  based on observed usage.
- **Capability renaming**: resolve the overload with Manifesto's "Capability" in a
  dedicated pass.
- **Discovery ranking**: flat list is fine for a small catalog; relevance ranking
  (textual match + Capability match + Provider activity + freshness) when catalog
  grows.
- **Vetchium Pay**: opt-in payment orchestration — deferred.
- **Cross-vertical Invoices**: staffing-partner placement fees in the Hiring
  vertical will reuse the invoicing construct (`specs/15-invoicing/`).
- **Column-level schemas**: defer until implementation.
