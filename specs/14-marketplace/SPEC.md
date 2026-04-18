# Vetchium Marketplace Specification

Status: Draft
Date: 2026-04-18

---

## 1. What This Is

Vetchium Marketplace is a B2B professional services directory built into the Vetchium
platform. Organizations that offer professional services publish **Listings** to be
discovered by organizations that need them. When a Consumer Org finds a suitable provider,
they create a **Subscription** to formally record the relationship on the platform. After
the relationship is established, Provider Orgs may raise **Invoices** against the
Subscription to document commercial transactions.

Vetchium defines the Capability catalog, charges Provider Orgs for their active Listings,
and acts as a neutral record-keeper for Subscriptions and Invoices. **Vetchium does not
intermediate payments between Orgs.** Money moves directly between Provider and Consumer
via whatever channel they have agreed off-platform.

---

## 2. Participants

| Participant  | Role                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vetchium     | Platform operator. Defines the Capability catalog. Bills Provider Orgs for active Listings. Can suspend any Listing. Does not hold, route, or take a cut of payments between Orgs. |
| Provider Org | Publishes Listings. Issues Invoices to Consumer Orgs for services rendered.                                                                                                        |
| Consumer Org | Browses, subscribes, receives and records Invoices. Pays Provider Orgs off-platform.                                                                                               |

An organization may simultaneously be a Provider for some Capabilities and a Consumer for
others. An organization may not subscribe to its own Listing.

---

## 3. Business Model

### 3.1 Vetchium charges Provider Orgs for active Listings

Provider Orgs are billed by Vetchium based on the Capabilities they are actively providing.
This is metered billing: the fee depends on which Capabilities are active, how many
Listings are live per Capability, and the duration each Listing remained active during a
billing period. A `suspended` or `archived` Listing does not accrue a fee.

The fee schedule per Capability is part of the Capability definition (§4.1) and is set by
Vetchium admins. Admins may waive fees on individual billing records for commercial
reasons.

### 3.2 Vetchium does NOT take a cut on Subscription value

A Subscription is a **relationship record**, not a billing event. When a Consumer Org
subscribes to a Listing, no money flows through Vetchium on that axis. The Provider and
Consumer negotiate commercial terms between themselves (captured in their Agreement, a
platform-level construct) and settle payment via whatever channel they already use — bank
transfer, wire, ACH, cheque.

This is a deliberate choice:

- **Bootstrapped reality**: Vetchium cannot responsibly build merchant-of-record, KYC/AML,
  and multi-region tax infrastructure early in its life.
- **Leakage**: Providers routed through a take-rate would simply invoice clients
  off-platform after month one. An uncollectible tax is worse than no tax.
- **Social contract**: consistent with "no cut on Job Offerings" — Vetchium charges for
  platform presence and tooling, not for counterparties' revenue.

### 3.3 Invoicing is a platform service, not a payment rail

Vetchium lets Provider Orgs raise **Invoices** against active Subscriptions (and, in a
later iteration, against staffing-partner placements in the Hiring vertical). An Invoice
is a document + status record.

What Vetchium does:

- Generates a standardized Invoice PDF tied to a Subscription.
- Assigns a sequential invoice number per Provider Org.
- Tracks status: `draft` → `issued` → `acknowledged` → `paid` (or `disputed`, `void`).
- Lets both Provider and Consumer see their shared invoice history.
- Audits every invoice event.

What Vetchium does NOT do:

- **Process payments.** No card or ACH rails. Payment happens off-platform; the Consumer
  records a reference (wire ID, cheque number) when marking the Invoice `paid`.
- **Certify tax correctness.** The Provider is responsible for VAT, GST, and local tax
  compliance. V1 surfaces a free-form tax block; region-specific templates come later.
- **Mediate disputes.** `disputed` is a flag; resolution is between the two Orgs.

### 3.4 Future: opt-in payment orchestration ("Vetchium Pay")

Once the platform has scale and a cross-region compliance posture, Vetchium may offer an
opt-in payment orchestration layer bundling escrow, dispute resolution, and remittance.
This would be a separately priced service, not a tax on all transactions. **Deferred. Not
in scope for this spec.**

### 3.5 Adjacent revenue streams (cross-reference only)

These are named so the Marketplace design slots cleanly into the larger monetisation
picture. Each is specified elsewhere:

- **Platform Subscription** — per-Org seat-/tier-based SaaS for core platform access.
- **Hub User premium tiers** — free basic use; paid tiers unlock profile picture,
  articles, advanced search.
- **First-party Capabilities** — services where Vetchium itself is the Provider (e.g.
  document signing in certain regions), earning normal service margin.

---

## 4. Core Entities

### 4.1 Capability

A Capability is a category of professional service defined by Vetchium admins. It is the
organizing unit of the Marketplace. Examples:

- `talent-sourcing`
- `background-verification`
- `payroll-processing`
- `physical-security`
- `kitchen-management`

**`marketplace_capabilities` (Global DB):**

| Field                  | Type    | Description                                                                    |
| ---------------------- | ------- | ------------------------------------------------------------------------------ |
| `capability_id`        | string  | Unique. Lowercase alphanumeric + hyphens. 3–50 chars. Immutable after create.  |
| `status`               | enum    | `draft` \| `active` \| `disabled`                                              |
| `listing_fee_amount`   | numeric | Fee charged per active Listing per billing period. Nullable (free capability). |
| `listing_fee_currency` | string  | ISO-4217. Required if amount is set.                                           |
| `billing_period`       | enum    | `monthly` \| `annual`. How listing fees accrue.                                |

**`marketplace_capability_translations` (Global DB):**

| Field           | Type   | Description                       |
| --------------- | ------ | --------------------------------- |
| `capability_id` | string | FK to `marketplace_capabilities`. |
| `locale`        | string | e.g. `en-US`, `de-DE`, `ta-IN`.   |
| `display_name`  | string | 1–100 chars.                      |
| `description`   | string | Markdown. Max 5000 chars.         |

Every API response that includes a Capability returns `display_name` and `description` for
the user's preferred locale, falling back to `en-US`. Admins provide all supported-locale
translations when creating or editing a Capability.

**`status`:**

- `draft`: admin-only. Orgs cannot create Listings.
- `active`: Orgs may create Listings and Subscriptions.
- `disabled`: no new Listings or Subscriptions. Existing active ones continue.

Region-specific fee overrides are out of scope for V1; introduce an override table if
pricing differentiation becomes necessary.

---

### 4.2 Listing

A Listing is a Provider Org's service offering under a specific Capability. One Provider
Org may have multiple Listings under the same Capability — for example, a staffing firm
may have separate listings for executive search and technical recruitment, each with its
own scope, pricing, and contact.

Each Listing has its own lifecycle and billing record.

**Fields:**

| Field                     | Type            | Description                                          |
| ------------------------- | --------------- | ---------------------------------------------------- |
| `listing_id`              | UUID            | Unique identifier.                                   |
| `org_domain`              | string          | Provider org. Canonical current domain.              |
| `capability_id`           | string          | Which Capability this Listing covers.                |
| `headline`                | string          | Max 100 chars.                                       |
| `description`             | string          | Markdown. Max 10000 chars.                           |
| `status`                  | enum            | See 4.2.1.                                           |
| `suspension_note`         | string nullable | Admin note when suspended.                           |
| `rejection_note`          | string nullable | Set by a rejecting superadmin. Cleared on re-submit. |
| `listed_at`               | timestamptz     | When the Listing first became active.                |
| `active_subscriber_count` | int32           | Computed from `marketplace_subscriptions`.           |
| `created_at`              | timestamptz     |                                                      |
| `updated_at`              | timestamptz     |                                                      |

#### 4.2.1 Listing States

```
draft            → pending_review  (non-superadmin with org:manage_listings submits for review)
draft            → active          (org:superadmin publishes — self-approval)
pending_review   → active          (org:superadmin approves)
pending_review   → draft           (org:superadmin rejects, with rejection_note)
active           → suspended       (Vetchium admin action: violation or billing failure)
suspended        → active          (Vetchium admin reinstates)
active           → archived        (provider with org:manage_listings archives)
suspended        → archived        (provider archives a suspended listing)
archived         → draft           (provider wants to re-list)
```

A provider may edit a Listing only in `draft` or `active` state. Edits to an `active`
Listing are visible immediately — the Listing is not hidden during the edit.

**Publish authorization — two distinct layers:**

1. **Vetchium admin gate**: none. Vetchium does not review Listings before they go live.
   Vetchium can only suspend a Listing after the fact.

2. **Intra-org approval**: when a non-superadmin org user with `org:manage_listings` clicks
   "Publish", the Listing enters `pending_review`. An `org:superadmin` within the same org
   must approve it before it goes live.

   **Superadmin self-approval exemption**: when an `org:superadmin` clicks "Publish", the
   Listing goes directly to `active`. This is essential for single-user orgs.

**Rejection note**: when a superadmin rejects a `pending_review` listing, a
`rejection_note` (up to 2000 chars) is required. It is displayed on the listing detail
page while the listing is in `draft` and cleared on the next re-submit.

---

### 4.3 Subscription

A Subscription records that a Consumer Org has subscribed to a specific Provider Listing.
When a Subscription is created it goes directly to `active` — the Consumer Org immediately
receives the provider's contact information to initiate the service relationship
off-platform.

One Consumer Org may not have more than one active Subscription per Listing. If a Consumer
Org re-subscribes to a cancelled or expired Subscription, the existing record is
reactivated with a new `started_at`.

**Subscriptions carry no billable amount on Vetchium.** Commercial terms are captured in
the Agreement between the two Orgs and settled via Invoices (§4.4) with money flowing
off-platform.

**Fields:**

| Field                 | Type                 | Description                                                   |
| --------------------- | -------------------- | ------------------------------------------------------------- |
| `subscription_id`     | UUID                 | Unique identifier.                                            |
| `listing_id`          | UUID                 | Which Listing is being subscribed to.                         |
| `consumer_org_domain` | string               | Consumer org. Canonical current domain.                       |
| `provider_org_domain` | string               | Provider org. Denormalized for querying.                      |
| `capability_id`       | string               | Denormalized for querying.                                    |
| `request_note`        | string nullable      | Max 2000 chars. Consumer's introductory note to the provider. |
| `status`              | enum                 | `active` \| `cancelled` \| `expired`                          |
| `started_at`          | timestamptz          | When the Subscription became active.                          |
| `expires_at`          | timestamptz nullable | Null = no expiry. Set for time-bounded arrangements.          |
| `cancelled_at`        | timestamptz nullable |                                                               |
| `created_at`          | timestamptz          |                                                               |
| `updated_at`          | timestamptz          |                                                               |

---

### 4.4 Invoice

An Invoice is a document + status record issued by a Provider Org to a Consumer Org under
an active (or recently active) Subscription. Invoices may be one-off or describe a
billing period (for retainer-style arrangements). Recurring-invoice templates are out of
scope for V1.

**Authority model**: the Provider Org is the source of truth for Invoice content. The
Consumer Org contributes acknowledgement, dispute signal, and payment reference. Vetchium
reconciles both sides into one record.

**`marketplace_invoices` (Provider's regional DB):**

| Field                        | Type                 | Description                                                             |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `invoice_id`                 | UUID                 | Unique.                                                                 |
| `subscription_id`            | UUID                 | FK to the Subscription this Invoice bills under.                        |
| `provider_org_domain`        | string               | Issuer.                                                                 |
| `consumer_org_domain`        | string               | Bill-to.                                                                |
| `invoice_number`             | string               | Provider's sequential number. Immutable once `issued`.                  |
| `issue_date`                 | date                 | When issued.                                                            |
| `due_date`                   | date                 | When payment is due.                                                    |
| `period_start`               | date nullable        | For retainer-style invoices.                                            |
| `period_end`                 | date nullable        |                                                                         |
| `currency`                   | string               | ISO-4217.                                                               |
| `subtotal_amount`            | numeric              | Before tax.                                                             |
| `tax_amount`                 | numeric              | Provider-asserted.                                                      |
| `total_amount`               | numeric              | `subtotal + tax`.                                                       |
| `line_items`                 | JSON                 | Array of `{description, quantity, unit_price, amount}`.                 |
| `notes`                      | string nullable      | Free-form markdown. Max 5000 chars.                                     |
| `provider_tax_details`       | JSON nullable        | e.g. VAT ID, GSTIN, HSN/SAC codes. Free-form.                           |
| `consumer_tax_details`       | JSON nullable        | Bill-to details copied from Consumer's org profile at issue time.       |
| `status`                     | enum                 | `draft` \| `issued` \| `acknowledged` \| `paid` \| `disputed` \| `void` |
| `issued_at`                  | timestamptz nullable | Set on `issued`.                                                        |
| `acknowledged_at`            | timestamptz nullable | Set by Consumer.                                                        |
| `paid_at`                    | date nullable        | Set by Consumer.                                                        |
| `consumer_payment_reference` | string nullable      | Consumer-supplied (wire ID, cheque number).                             |
| `dispute_note`               | string nullable      | Set by Consumer when disputing.                                         |
| `void_reason`                | string nullable      | Set by Provider when voiding.                                           |
| `document_key`               | string nullable      | S3 key for generated PDF.                                               |
| `created_at`                 | timestamptz          |                                                                         |
| `updated_at`                 | timestamptz          |                                                                         |

#### 4.4.1 Invoice States

```
draft        → issued        (Provider issues; invoice_number assigned; PDF generated)
issued       → acknowledged  (Consumer confirms receipt)
issued       → disputed      (Consumer disputes with required note)
issued       → void          (Provider voids unpaid invoice with required reason)
acknowledged → paid          (Consumer records off-platform payment with reference)
acknowledged → disputed      (Consumer disputes after acknowledging)
acknowledged → void          (Provider voids with required reason)
disputed     → issued        (dispute resolved between parties; returns to issued)
```

`paid` and `void` are terminal. Invoice numbers are sequential per Provider Org and are
never reused — a voided invoice's number remains assigned to that voided record.

**`marketplace_invoice_index` (Global DB)**: routing index listing `invoice_id`,
`provider_org_domain`, `consumer_org_domain`, `provider_region`, `consumer_region`,
`status`, `issue_date`, `total_amount`, `currency`. Allows Consumers to discover invoices
addressed to them across regions and feeds cross-region reporting. Updated in the same
transaction as the regional `marketplace_invoices` row using the global-first then
regional pattern.

**Data sovereignty**: the authoritative Invoice record lives in the Provider's home
region. The Consumer sees Invoices via the global index joining back to Provider-region
reads. This matches the pattern used for Subscriptions.

**Not in V1**: currency conversion, partial payments, credit notes, recurring-invoice
templates, region-specific tax templates. Start simple; extend with evidence.

---

### 4.5 Billing Record

A Billing Record is Vetchium's own charge for a Provider Org's active Listings. These are
the eventual platform-usage invoices Vetchium will send to Providers.

**`marketplace_billing_records` (Global DB):**

| Field               | Type                 | Description                                                |
| ------------------- | -------------------- | ---------------------------------------------------------- |
| `billing_record_id` | UUID                 | Unique.                                                    |
| `org_domain`        | string               | Provider org being charged.                                |
| `capability_id`     | string               | Capability the fee relates to.                             |
| `listing_id`        | UUID nullable        | Specific Listing if itemized per Listing (recommended V1). |
| `period_start`      | date                 | Billing period start.                                      |
| `period_end`        | date                 | Billing period end.                                        |
| `active_days`       | int                  | Days the Listing was `active` during the period.           |
| `amount`            | numeric              | Computed fee for the period.                               |
| `currency`          | string               | ISO-4217.                                                  |
| `status`            | enum                 | `pending` \| `invoiced` \| `paid` \| `waived`              |
| `invoiced_at`       | timestamptz nullable | When Vetchium issued the bill.                             |
| `paid_at`           | timestamptz nullable | When admin recorded payment.                               |
| `payment_reference` | string nullable      | Admin-entered reference.                                   |
| `waived_at`         | timestamptz nullable |                                                            |
| `waived_by`         | UUID nullable        | Admin user who waived.                                     |
| `waiver_reason`     | string nullable      | Required when status = `waived`.                           |
| `created_at`        | timestamptz          |                                                            |

A billing record is created when a Listing enters `active` (or when a new billing period
begins for an already-active Listing). `active_days` accumulates as the Listing's status
evolves. The record closes at `period_end` and moves `pending` → `invoiced` when Vetchium
issues its platform invoice to the Provider.

Until Vetchium builds its own platform-usage invoicing pipeline, `invoiced` and `paid`
transitions are admin-driven (manual reconciliation).

---

## 5. RBAC

### Roles (Org portal)

- `org:manage_listings` — create, edit, archive, reopen own Listings; act on
  pending_review approvals when superadmin; view own subscriber list.
- `org:view_listings` — read-only access to own Listings and their subscriber list.
- `org:manage_subscriptions` — create, cancel, re-subscribe on Consumer side.
- `org:view_subscriptions` — read-only access to own Subscriptions.
- `org:manage_invoices` — issue, edit drafts, void Invoices as Provider; acknowledge,
  dispute, mark-paid as Consumer.
- `org:view_invoices` — read-only access to own Invoices (both sent and received).
- `org:superadmin` — bypasses all org marketplace role checks.

### Roles (Admin portal)

- `admin:manage_marketplace` — all admin writes on Capabilities, Listings, Subscriptions,
  and Vetchium's Billing Records.
- `admin:view_marketplace` — read-only admin access.
- `admin:superadmin` — bypasses all admin marketplace role checks.

### Access rules

| Action                                                                                                  | Required role                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Browse active Capabilities and Listings                                                                 | Any authenticated org user                             |
| Create or edit own Listings                                                                             | `org:manage_listings`                                  |
| View own Listings                                                                                       | `org:view_listings` or `org:manage_listings`           |
| View Subscribers of own Listings                                                                        | `org:view_listings` or `org:manage_listings`           |
| Create or cancel Subscriptions                                                                          | `org:manage_subscriptions`                             |
| View own Subscriptions                                                                                  | `org:view_subscriptions` or `org:manage_subscriptions` |
| Issue / void / edit-draft Invoice (Provider)                                                            | `org:manage_invoices`                                  |
| Acknowledge / dispute / mark-paid (Consumer)                                                            | `org:manage_invoices`                                  |
| View Invoices (sent or received)                                                                        | `org:view_invoices` or `org:manage_invoices`           |
| Admin: Capability CRUD, suspend Listing, cancel Subscription, waive / record-payment on billing records | `admin:manage_marketplace`                             |
| Admin: read-only views of any of the above                                                              | `admin:view_marketplace` or `admin:manage_marketplace` |

---

## 6. Data Architecture

| Table                                 | DB                                | Notes                                                                                         |
| ------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `marketplace_capabilities`            | Global                            | Capability catalog + fee schedule.                                                            |
| `marketplace_capability_translations` | Global                            | Per-locale name / description. Fallback to `en-US`.                                           |
| `marketplace_listings`                | Regional (provider's home region) | Provider operational state.                                                                   |
| `marketplace_listing_catalog`         | Global                            | Discovery mirror: headline + description for `active` Listings, for fast cross-region browse. |
| `marketplace_subscriptions`           | Regional (consumer's home region) | Consumer operational state.                                                                   |
| `marketplace_subscription_index`      | Global                            | Cross-region routing for Provider subscriber views.                                           |
| `marketplace_invoices`                | Regional (provider's home region) | Authoritative Invoice records.                                                                |
| `marketplace_invoice_index`           | Global                            | Cross-region routing for Consumer invoice views.                                              |
| `marketplace_billing_records`         | Global                            | Vetchium's billing of Providers for platform usage.                                           |

**Mirror writes**: when a Listing becomes `active` or stops being `active`, the regional
`marketplace_listings` and global `marketplace_listing_catalog` rows are updated in one
transaction using the global-first, regional-second pattern with a compensating
transaction on failure. The same pattern applies to Subscriptions ↔ subscription_index
and Invoices ↔ invoice_index.

---

## 7. UI Screens — Org Portal

### 7.1 Dashboard Tiles

| Tile                 | Route                        | Visible when                                           |
| -------------------- | ---------------------------- | ------------------------------------------------------ |
| **Marketplace**      | `/marketplace/discover`      | Any authenticated user                                 |
| **My Subscriptions** | `/marketplace/subscriptions` | `org:manage_subscriptions` or `org:view_subscriptions` |
| **My Listings**      | `/marketplace/listings`      | `org:manage_listings` or `org:view_listings`           |
| **My Clients**       | `/marketplace/clients`       | `org:manage_listings` or `org:view_listings`           |
| **Invoices**         | `/marketplace/invoices`      | `org:manage_invoices` or `org:view_invoices`           |

---

### 7.2 `/marketplace/discover` — Marketplace

Flat paginated list of all active Listings across all Capabilities. Each card shows:

- Listing headline
- Provider org domain
- Capability tag
- Description (truncated to 3 lines)

A Capability filter and full-text search sit at the top. Flat listing is preferred over a
capability-first browse because Consumers typically know the service category they need,
and the capability tag on each card provides enough context. Clicking a card opens the
Listing detail page (§7.3).

---

### 7.3 `/marketplace/discover/:listing_id` — Listing Detail (Buyer View)

Full Listing page from the buyer's perspective: headline, provider org domain, capability
tag, full description, listed date.

- No existing Subscription → **"Subscribe"** button opens a panel with an optional request
  note. Confirm creates the Subscription immediately.
- Terminal Subscription (`cancelled`/`expired`) → **"Re-subscribe"** button.

---

### 7.4 `/marketplace/listings` — My Listings (Provider)

Table view of the org's Listings (all statuses). **"Create Listing"** button is always
present at top-right (for `org:manage_listings`). Empty state is a prompt inside the
table.

| Headline                | Capability       | Status   | Active Subscribers | Created    |
| ----------------------- | ---------------- | -------- | ------------------ | ---------- |
| Executive Search        | talent-sourcing  | Active   | 4                  | 2026-03-01 |
| Engineering Recruitment | talent-sourcing  | Archived | —                  | 2026-02-15 |
| Standard Screening      | background-verif | Draft    | —                  | 2026-04-01 |

Clicking a listing's headline navigates to §7.6.

---

### 7.5 `/marketplace/listings/new` — Create Listing

Single step. Fields:

- **Capability** — searchable dropdown of all active Capabilities. Pre-selected if
  `?capability=<id>` is present.
- **Headline** — max 100 chars.
- **Description** — markdown, max 10000 chars.

Two actions: **"Save Draft"** and **"Publish"**. Publish transitions as described in
§4.2.1 based on the user's roles.

---

### 7.6 `/marketplace/listings/:listing_id` — Manage One Listing

Listing section + subscribers section.

**Actions by status and role:**

| Status           | `org:superadmin` sees                                   | `org:manage_listings` (non-superadmin) sees               |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `draft`          | Edit, Publish (→ active directly)                       | Edit, Publish (→ pending_review)                          |
| `pending_review` | Approve (→ active), Reject with required note (→ draft) | Info message: "Awaiting superadmin approval." No actions. |
| `active`         | Edit, Archive                                           | Edit, Archive                                             |
| `suspended`      | Suspension note shown. Archive.                         | Suspension note shown. Archive.                           |
| `archived`       | Reopen (→ draft)                                        | Reopen (→ draft)                                          |

**Reject action**: opens a modal with a required textarea for the `rejection_note`.
The modal's Reject button is disabled until text is entered.

**Subscribers section** (when Listing is `active`):

| Organization | Subscribed Since | Note                      |
| ------------ | ---------------- | ------------------------- |
| globex.com   | 2026-03-15       | We're expanding our team. |
| initech.com  | 2026-04-01       | (no note)                 |

A per-row action **"Issue Invoice"** (for `org:manage_invoices`) navigates to §7.12 with
the Subscription preselected.

---

### 7.7 `/marketplace/listings/:listing_id/edit` — Edit Listing

Same form as Create, pre-populated. Same two actions. Editing an `active` Listing saves
changes immediately — the Listing remains visible while the edit is in progress.

---

### 7.8 `/marketplace/subscriptions` — My Subscriptions (Consumer)

Rows: Provider org, Capability, Status, Subscribed-since. Status filter: All / Active /
Historical (`cancelled` + `expired` — maps to `include_historical: true` in the API).

---

### 7.9 `/marketplace/subscriptions/:subscription_id` — Subscription Detail

Full Subscription details + most recent Invoices against this Subscription.

- `active` Subscription → **"Cancel Subscription"** with confirmation dialog.
- Terminal Subscription → **"Re-subscribe"** → navigates to the Listing detail page
  (§7.3).

---

### 7.10 `/marketplace/clients` — My Clients (Provider)

Cross-listing view of all Subscriptions where the viewing org is Provider. Columns:
Consumer org, Capability, Listing, Status, Started, Expires, Latest invoice status. A
row action opens the per-Subscription page (§7.9) from the Provider side, which exposes
**"Issue Invoice"** for `org:manage_invoices`.

---

### 7.11 `/marketplace/invoices` — Invoices

Unified Invoice view with a segmented toggle at the top:

- **Sent** — where viewing org is the Provider.
- **Received** — where viewing org is the Consumer.

Rows: counterparty org, invoice number, issue date, due date, amount + currency, status.
Filters: status, date range, counterparty, subscription.

---

### 7.12 `/marketplace/invoices/new?subscription_id=X` — Issue Invoice

Provider-side form. Pre-populated fields from the Subscription (counterparty, capability,
default currency if the Provider has one configured).

Editable fields:

- Due date.
- Currency.
- Line items (description, quantity, unit price — line total computed, subtotal
  computed).
- Tax amount (free-form; V1 does not compute tax).
- Period start / end (optional, for retainer-style invoices).
- Notes (markdown, max 5000 chars).
- Provider tax details (VAT ID, GSTIN, HSN/SAC; free-form JSON block surfaced as a
  simple form).
- Consumer tax details (editable; defaults copied from the Consumer org profile).

Actions:

- **"Save Draft"** — `draft` invoice, no invoice number yet, no PDF.
- **"Issue"** — `invoice_number` assigned from Provider's sequential counter, PDF
  generated and stored in provider-region S3, `marketplace_invoice_index` row upserted,
  Consumer is notified.

---

### 7.13 `/marketplace/invoices/:invoice_id` — Invoice Detail

Both parties see the same document. Role-aware action panel:

- **Provider** (`org:manage_invoices`)
  - `draft`: Edit, Issue, Delete.
  - `issued` or `acknowledged`: Void (requires reason).
  - Always: Download PDF.
- **Consumer** (`org:manage_invoices`)
  - `issued`: Acknowledge, Dispute (with required note), Mark Paid (with payment
    reference).
  - `acknowledged`: Dispute, Mark Paid.
  - `disputed`: Withdraw dispute → back to `issued`.
  - Always: Download PDF.

A status timeline (stepper) visualises the lifecycle and timestamps.

---

## 8. UI Screens — Admin Portal

### 8.1 Capability Management

Admin list shows all Capabilities regardless of status. The create / edit form includes:

- `capability_id` (set at creation, immutable after).
- `status`.
- **Fee schedule**: `listing_fee_amount`, `listing_fee_currency`, `billing_period`.
  Leave amount null for a free Capability.
- For each supported locale (`en-US`, `de-DE`, `ta-IN`): `display_name`, `description`.
  `en-US` required; others fall back.

### 8.2 Listing Oversight

Admins may suspend or reinstate any active Listing. Suspended Listings are hidden from
Consumer Orgs; the suspension note is shown to the Provider on their Listing management
page.

### 8.3 Subscription Oversight

Admins view all Subscriptions across all orgs and may cancel any Subscription if
necessary.

### 8.4 Billing (Vetchium → Provider)

Admin page to:

- List billing records with filters: provider org, capability, period, status.
- View a billing record — period, active_days, computed amount, current status.
- **Issue** (moves `pending` → `invoiced`, captures invoice document key once Vetchium's
  own billing pipeline exists; stays manual until then).
- **Record payment** (moves `invoiced` → `paid`; stores payment reference).
- **Waive** (moves any non-terminal status to `waived`; required `waiver_reason`).

Every billing write emits an `admin_audit_logs` entry inside the same transaction
(`admin.marketplace_billing_invoice_issued`, `admin.marketplace_billing_payment_recorded`,
`admin.marketplace_billing_fee_waived`).

### 8.5 Invoice Oversight

Admin read-only list of all Invoices across all orgs for moderation and dispute
visibility. **Admins do not mutate Invoice content** — the Provider is the source of
truth. Admins may flag Invoices for review if reported.

---

## 9. Open Questions / Future Work

- **Currency handling across regions**: V1 stores a per-invoice `currency` field. FX
  conversion, multi-currency reporting, and consolidated P&L are deferred.
- **Recurring-invoice templates**: retainer Subscriptions will benefit from auto-emitting
  Invoices on a schedule. Deferred.
- **Credit notes / partial payments**: deferred until demand surfaces.
- **Region-specific tax templates**: V1 uses a free-form tax block. V2 adds region-aware
  VAT invoices (EU), GST invoices (India), etc.
- **Region-specific Capability fee overrides**: introduce an override table if pricing
  sensitivity requires it.
- **Vetchium Pay**: opt-in payment orchestration once platform and compliance maturity
  allow. Deferred.
- **Cross-vertical Invoices**: the same Invoice construct is expected to be reused for
  staffing-partner placement fees in the Hiring vertical. A follow-up spec under that
  vertical will formalise how Invoices attach to Placements in addition to Subscriptions.
