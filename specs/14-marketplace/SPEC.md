# Vetchium Marketplace Specification

Status: Draft
Date: 2026-04-09

---

## 1. What This Is

Vetchium Marketplace is a B2B professional services directory built into the Vetchium
platform. Organizations that offer professional services publish **Listings** to be
discovered by organizations that need them. When a Consumer Org finds a suitable provider,
they create a **Subscription** to formally record the relationship on the platform.

Vetchium defines and manages the catalog of service categories (**Capabilities**),
controls which providers are discoverable, and tracks all provider-consumer relationships.
This forms the foundation for Vetchium's own billing of Provider Orgs and future
facilitation of payment between organizations.

---

## 2. Participants

| Participant  | Role                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vetchium     | Platform operator. Defines and manages the Capability catalog. Bills Provider Orgs for their active Listings. Can suspend any Listing at any time. |
| Provider Org | An organization that offers professional services. Publishes Listings to be discovered and subscribed to.                                          |
| Consumer Org | An organization that needs a professional service. Browses the directory, selects a Listing, and creates a Subscription.                           |

An organization may simultaneously be a Provider for some Capabilities and a Consumer for
others.

An organization may not subscribe to its own Listing.

---

## 3. Business Model

### Vetchium charges Provider Orgs for active Listings

Provider Orgs are billed by Vetchium based on the Capabilities they are actively providing
on the platform. This is metered billing similar to how cloud platforms bill for the
services an organization uses in a billing cycle — the fee depends on which Capabilities
are active, how many Listings are live, and potentially the volume of Subscriptions.

The specific fee schedule per Capability is set by Vetchium admins. A Listing that is
suspended or archived does not accrue a fee.

### Provider Orgs charge Consumer Orgs a Subscription fee

When a Consumer Org subscribes to a Listing, the Provider Org may charge a recurring fee —
similar to a retainer. This is a three-party transaction: the Consumer Org pays through
the Vetchium platform, Vetchium takes a platform fee, and the remainder goes to the
Provider Org.

The Subscription model is designed to carry this payment information. Payment processing
is a future feature.

---

## 4. Core Entities

### 4.1 Capability

A Capability is a category of professional service defined by Vetchium admins. It is the
organizing unit of the marketplace. Examples:

- `talent-sourcing`
- `background-verification`
- `payroll-processing`
- `physical-security`
- `kitchen-management`

**Fields (`marketplace_capabilities` table):**

| Field           | Type   | Description                                           |
| --------------- | ------ | ----------------------------------------------------- |
| `capability_id` | string | Unique. Lowercase alphanumeric + hyphens. 3–50 chars. |
| `status`        | enum   | `draft` \| `active` \| `disabled`                     |

**Translations (`marketplace_capability_translations` table):**

| Field           | Type   | Description                       |
| --------------- | ------ | --------------------------------- |
| `capability_id` | string | FK to `marketplace_capabilities`. |
| `locale`        | string | e.g. `en-US`, `de-DE`, `ta-IN`    |
| `display_name`  | string | 1–100 chars.                      |
| `description`   | string | Markdown. Max 5000 chars.         |

Every API response that includes a Capability returns the `display_name` and `description`
for the requesting user's preferred locale. If a translation for the user's locale does not
exist, the `en-US` translation is returned as a fallback.

Admins provide translations for all supported locales when creating or editing a Capability.
The admin UI shows one set of name/description fields per locale.

**`status`:**

- `draft`: Visible to admins only. Orgs cannot create Listings.
- `active`: Orgs may create Listings and Subscriptions.
- `disabled`: No new Listings or Subscriptions. Existing active ones continue.

---

### 4.2 Listing

A Listing is a Provider Org's service offering under a specific Capability. One Provider
Org may have multiple Listings under the same Capability — for example, a staffing firm
may have separate listings for executive search and technical recruitment, each with its
own scope, pricing, and contact information.

Each Listing has its own lifecycle and billing record.

**Fields:**

| Field                     | Type            | Description                                                                                |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `listing_id`              | UUID            | Unique identifier.                                                                         |
| `org_domain`              | string          | Provider org. Canonical current domain.                                                    |
| `capability_id`           | string          | Which Capability this Listing covers.                                                      |
| `headline`                | string          | Max 100 chars. Name of this specific service offering.                                     |
| `description`             | string          | Markdown. Max 10000 chars. Full service detail.                                            |
| `status`                  | enum            | See 4.2.1                                                                                  |
| `suspension_note`         | string nullable | Admin note explaining why a Listing was suspended.                                         |
| `listed_at`               | timestamptz     | When the Listing first became active.                                                      |
| `active_subscriber_count` | int32           | Count of active Subscriptions for this Listing. Computed from `marketplace_subscriptions`. |
| `created_at`              | timestamptz     |                                                                                            |
| `updated_at`              | timestamptz     |                                                                                            |

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

A provider may edit a Listing only in `draft` or `active` state. `pending_review`,
`suspended`, and `archived` listings cannot be edited. If a non-superadmin wants to
revise a listing that is `pending_review`, a superadmin must first reject it (returning
it to `draft`).

Editing an `active` Listing does not make it invisible while changes are being saved.

**Publish authorization — two distinct layers:**

1. **Vetchium admin gate**: There is none. Vetchium does not review or approve Listings
   before they go live. Vetchium can only suspend a Listing after the fact.

2. **Intra-org approval**: When a non-superadmin org user with `org:manage_listings`
   clicks "Publish", the Listing enters `pending_review` — it is not yet visible to
   Consumer Orgs. An `org:superadmin` within the same org must approve it before it
   goes live.

   **Superadmin self-approval exemption**: When an `org:superadmin` clicks "Publish",
   the Listing goes directly to `active` with no countersignature required. This is
   essential for single-user orgs where the only user is also the superadmin — without
   this exemption they would be permanently blocked from ever publishing.

**Additional `Listing` fields for the approval flow:**

| Field            | Type            | Description                                            |
| ---------------- | --------------- | ------------------------------------------------------ |
| `rejection_note` | string nullable | Set by the rejecting superadmin. Cleared on re-submit. |

---

### 4.3 Subscription

A Subscription records that a Consumer Org has subscribed to a specific Provider Listing.
When a Subscription is created it goes directly to `active` — the Consumer Org immediately
receives the provider's contact information to initiate the service relationship
off-platform.

One Consumer Org may not have more than one active Subscription per Listing. If a Consumer
Org re-subscribes to a Listing after cancelling, the existing record is reactivated with a
new `started_at`.

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

## 5. RBAC

### Roles

- `org:manage_listings` — create, edit, and manage own Listings (Provider side)
- `org:view_listings` — read-only access to own Listings and their Subscriber list
- `org:manage_subscriptions` — create and cancel Subscriptions (Consumer side)
- `org:view_subscriptions` — read-only access to own Subscriptions
- `org:superadmin` — bypasses all org marketplace role checks
- `admin:manage_marketplace` — all admin writes on Capabilities, Listings, and Subscriptions
- `admin:view_marketplace` — read-only admin access
- `admin:superadmin` — bypasses all admin marketplace role checks

### Access rules

| Action                                  | Required role                                          |
| --------------------------------------- | ------------------------------------------------------ |
| Browse active Capabilities and Listings | Any authenticated org user                             |
| Create or edit own Listings             | `org:manage_listings`                                  |
| View own Listings                       | `org:view_listings` or `org:manage_listings`           |
| View Subscribers of own Listings        | `org:view_listings` or `org:manage_listings`           |
| Create or cancel Subscriptions          | `org:manage_subscriptions`                             |
| View own Subscriptions                  | `org:view_subscriptions` or `org:manage_subscriptions` |

---

## 6. Data Architecture

| Table                                 | DB                                | Notes                                                                                                      |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `marketplace_capabilities`            | Global                            | Admin-owned Capability catalog (capability_id, approval type, status).                                     |
| `marketplace_capability_translations` | Global                            | Display name and description per capability per locale. Fallback to `en-US` when user's locale is missing. |
| `marketplace_listings`                | Regional (provider's home region) | Provider operational state                                                                                 |
| `marketplace_listing_catalog`         | Global                            | Discovery mirror: headline + description for active listings, for fast cross-region browse                 |
| `marketplace_subscriptions`           | Regional (consumer's home region) | Consumer operational state                                                                                 |
| `marketplace_subscription_index`      | Global                            | Routing index: lets providers query their subscribers across regions                                       |
| `marketplace_billing_records`         | Global                            | Listing fee records per org per Capability                                                                 |

`marketplace_listing_catalog` is a mirror of the fields needed to render a browse card for
every active Listing. When a Listing becomes active or stops being active, both the
regional `marketplace_listings` row and the global `marketplace_listing_catalog` row are
updated in a single transaction.

`marketplace_subscription_index` is updated on every Subscription write. The provider's
Subscriber view queries this index to find which regional DBs hold relevant Subscription
records, then retrieves the full records from those regional DBs.

---

## 7. UI Screens — Org Portal

### 7.1 Dashboard Tiles

Three marketplace tiles on the main org dashboard:

| Tile                 | Route                        | Visible when                                                    |
| -------------------- | ---------------------------- | --------------------------------------------------------------- |
| **Marketplace**      | `/marketplace/discover`      | Any authenticated user                                          |
| **My Subscriptions** | `/marketplace/subscriptions` | User has `org:manage_subscriptions` or `org:view_subscriptions` |
| **My Listings**      | `/marketplace/listings`      | User has `org:manage_listings` or `org:view_listings`           |
| **My Clients**       | `/marketplace/clients`       | User has `org:manage_listings` or `org:view_listings`           |

---

### 7.2 `/marketplace/discover` — Marketplace

Shows a flat paginated list of all active Listings across all Capabilities. Each card shows:

- Listing headline
- Provider org domain
- Capability tag
- Description (truncated to 3 lines)

A flat list is preferred over a capability-first browse because consumers typically know
what service category they need, and the capability tag on each card gives sufficient
context without an extra navigation step.

Clicking a card navigates to the Listing detail page (buyer view).

---

### 7.3 `/marketplace/discover/:listing_id` — Listing Detail (Buyer View)

Full Listing page from the buyer's perspective:

- Headline
- Provider org domain
- Capability tag
- Full description
- Listed date

If the viewing org does not have an active Subscription to this Listing, a
**"Subscribe"** button is shown. Clicking it opens a panel with an optional request note
field and a confirm button. On confirm, the Subscription is created immediately.

If a Subscription already exists in a terminal state (cancelled or expired), a
**"Re-subscribe"** button is shown instead.

---

### 7.4 `/marketplace/listings` — My Listings (Provider Dashboard)

A consistent table view of the org's Listings, regardless of whether any exist. A
**"Create Listing"** button is always shown at the top right (for users with
`org:manage_listings`).

The empty state shows a simple prompt inside the table. The table columns and the
"Create Listing" button are always present — the page never switches to a different
layout. This matches the standard pattern used by major marketplace provider portals
(AWS Seller Central, Shopify Partners, Salesforce AppExchange).

| Headline                | Capability       | Status   | Active Subscribers | Created    |
| ----------------------- | ---------------- | -------- | ------------------ | ---------- |
| Executive Search        | talent-sourcing  | Active   | 4                  | 2026-03-01 |
| Engineering Recruitment | talent-sourcing  | Archived | —                  | 2026-02-15 |
| Standard Screening      | background-verif | Draft    | —                  | 2026-04-01 |

Clicking a listing's headline navigates to the Manage One Listing page (7.6).

---

### 7.5 `/marketplace/listings/new` — Create Listing

The Create Listing form has a single step with all fields on one page:

- **Capability** — searchable dropdown of all active Capabilities. Pre-selected if
  `?capability=<id>` is present in the URL.
- **Headline** — max 100 chars.
- **Description** — markdown, max 10000 chars.

Two actions:

- **"Save Draft"** — saves without publishing.
- **"Publish"** — saves and immediately makes the Listing visible to all Consumer Orgs.

In edit mode, **"Publish"** is only shown when the Listing is currently in `draft` state.
For active listings, only **"Save Draft"** is shown (the listing remains visible while
changes are saved).

---

### 7.6 `/marketplace/listings/:listing_id` — Manage One Listing

Operational hub for a specific Listing. Reached by clicking a listing name in the My
Listings table.

**Listing section:**

Shows current status, all listing fields, and available actions. Actions and messages differ by status and user role:

| Status           | `org:superadmin` sees                                   | `org:manage_listings` (non-superadmin) sees               |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `draft`          | Edit, Publish (→ active directly)                       | Edit, Publish (→ pending_review)                          |
| `pending_review` | Approve (→ active), Reject with required note (→ draft) | Info message: "Awaiting superadmin approval." No actions. |
| `active`         | Edit, Archive                                           | Edit, Archive                                             |
| `suspended`      | Suspension note shown. Archive.                         | Suspension note shown. Archive.                           |
| `archived`       | Reopen (→ draft)                                        | Reopen (→ draft)                                          |

**Rejection note**: When a superadmin rejects a `pending_review` listing, they must provide a `rejection_note` (required, up to 2000 chars) explaining the reason. This note is displayed prominently on the listing detail page when the listing is in `draft` state after rejection. It is cleared when the listing is re-submitted for review (next Publish action).

**Reject action**: Clicking "Reject" opens a modal dialog containing a required text area for the rejection note. The Reject button in the modal is disabled until text is entered.

**Subscribers section** (shown when Listing is `active`):

Table of Consumer Orgs currently subscribed to **this specific Listing** (not all
listings). This per-listing view is more useful than a global client list when a provider
has multiple listings.

| Organization | Subscribed Since | Note                      |
| ------------ | ---------------- | ------------------------- |
| globex.com   | 2026-03-15       | We're expanding our team. |
| initech.com  | 2026-04-01       | (no note)                 |

---

### 7.7 `/marketplace/listings/:listing_id/edit` — Edit Listing

Same form as Create Listing Step 2, pre-populated with the existing Listing's values.

Same two actions: **"Save as Draft"** and **"Publish"**.

Editing a Listing that is currently `active` saves changes immediately — the Listing
remains visible to buyers while the edit is in progress.

---

### 7.8 `/marketplace/subscriptions` — My Subscriptions (Consumer View)

Lists all Subscriptions where the viewing org is the Consumer. Each row shows:

- Provider org domain
- Capability
- Status
- Subscribed since date

A status filter (All / Active / Historical) narrows the list. "Historical" covers both
`cancelled` and `expired` subscriptions and maps to `include_historical: true` in the
API request.

Clicking a row navigates to the Subscription detail page.

---

### 7.9 `/marketplace/subscriptions/:subscription_id` — Subscription Detail

Full Subscription details:

- Provider org domain
- Capability
- Request note (if provided)
- Status and dates (started, expires, cancelled)

For `active` Subscriptions: **"Cancel Subscription"** button with a confirmation dialog.

For cancelled or expired Subscriptions: **"Re-subscribe"** button that navigates to the
Listing detail page (7.3), where the provider's current listing is shown.

---

### 7.10 `/marketplace/clients` — My Clients (Provider View)

Lists all active and historical Subscriptions where the viewing org is the Provider,
across all their Listings. Each row shows:

- Consumer org domain
- Capability
- Status
- Started date
- Expires date (if set)

This is a global view across all listings. For a per-listing subscriber view, see the
Subscribers section within 7.6.

---

## 8. UI Screens — Admin Portal

### 8.1 Capability Management

Admins create, edit, enable, and disable Capabilities. The admin Capability list shows all
Capabilities regardless of status, including drafts.

When creating or editing a Capability, the admin form includes:

- `capability_id` (set at creation, immutable after)
- `status`
- For each supported locale (`en-US`, `de-DE`, `ta-IN`): `display_name` and `description`

All locale translations are managed through the same admin form. The `en-US` translation
is required; other locales are optional (the platform falls back to `en-US`).

### 8.2 Listing Oversight

Admins may suspend or reinstate any active Listing at any time. Suspended Listings are
hidden from Consumer Orgs. The suspension note is shown to the Provider Org on their
Listing management page.

### 8.3 Subscription Oversight

Admins can view all Subscriptions across all orgs and cancel any Subscription if necessary.

### 8.4 Billing Management

Admins view billing records per org per Capability, manually record payments, and waive
fees.
