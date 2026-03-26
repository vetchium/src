# Vetchium Marketplace — Functional Requirements

Status: DRAFT
Authors: @
Dependencies: Employer (Org) accounts, HubUser accounts, Verified Domains

---

## Overview

The Vetchium Marketplace is a directory where Employer organisations hosted on Vetchium can list
professional services they offer. It is browse-able by Hub users (professionals) and by other
Employer organisations. The first supported service category is **JobAgency**.

The Marketplace is not a transactional platform: it does not process payments or contracts.
It connects buyers (professionals, employers) with service providers, and lets both sides
manage that relationship off-platform if they choose.

---

## Actors

| Actor | Description |
|---|---|
| **Provider Org** | An Employer organisation that creates and manages a service listing |
| **Hub User** | A professional browsing the marketplace, seeking services |
| **Org User (buyer)** | An OrgUser at a different Employer who browses on behalf of their company |
| **Vetchium Admin** | Platform administrator; can moderate listings |

---

## Core Concepts

### Service Listing

A Service Listing is created by a Provider Org to advertise a specific service it offers.
Each listing belongs to exactly one service **category** (e.g., `jobagency`).

A Provider Org may have multiple active listings, but no more than one listing per category.

### Service Category

A service category defines the type of service and the extra structured fields that listings
in that category must or may provide. Categories are defined by Vetchium (not by orgs).

Initial categories:

| Category slug | Human name |
|---|---|
| `jobagency` | Job Agency |

### Listing Visibility

A listing can be in one of the following states:

| State | Description |
|---|---|
| `draft` | Created but not visible to anyone outside the Provider Org |
| `pending_review` | Submitted for Vetchium Admin review; not yet publicly visible |
| `active` | Publicly visible in the marketplace |
| `suspended` | Hidden by a Vetchium Admin; Provider Org is notified |
| `withdrawn` | Hidden by the Provider Org itself |

State transitions:

```
draft → pending_review → active ↔ suspended
active → withdrawn
withdrawn → pending_review   (re-submission)
```

### Engagement Request

A Hub User or Org User can send an **Engagement Request** to a Provider Org for a specific
listing. This is a lightweight contact/inquiry — not a contract or a payment.

The Provider Org receives the request and can accept, decline, or let it expire.

---

## Feature Areas

### 1. Listing Management (Provider Org)

#### 1.1 Create a Listing

- An OrgUser with the `employer:manage_marketplace` role (or `employer:superadmin`) can create
  a listing for their org.
- They select a category, fill in the common fields and category-specific fields, and save it
  as a draft.
- The listing is initially in `draft` state.

#### 1.2 Edit a Listing

- A Provider Org can edit any listing that is in `draft`, `active`, or `withdrawn` state.
- Editing an `active` listing does NOT automatically put it back into `pending_review`. Minor
  edits (description, contact details) take effect immediately. If the category-specific
  structured data changes materially, the listing reverts to `pending_review` automatically.
  Defining what constitutes a "material change" is left to a follow-up spec.
- A `suspended` listing cannot be edited until the suspension is lifted.

#### 1.3 Submit for Review

- A Provider Org can submit a `draft` or `withdrawn` listing for review.
- Once submitted the listing moves to `pending_review` and editing is locked until reviewed.

#### 1.4 Withdraw a Listing

- A Provider Org can withdraw an `active` listing at any time. The listing becomes `withdrawn`
  and is no longer visible to the public.
- Pending engagement requests remain and should be handled before or after withdrawal.

#### 1.5 View Own Listings

- OrgUsers with `employer:manage_marketplace` or `employer:view_marketplace` (or superadmin)
  can list and view the org's own service listings regardless of their state.

---

### 2. Marketplace Discovery (Hub Users and Org Users)

#### 2.1 Browse the Marketplace

- Any authenticated Hub User or Org User can browse active marketplace listings.
- Listings are filterable by:
  - Service category
  - Geographic region / country (where the provider operates)
  - Tags / specialisations (category-specific, see §4)
  - Provider org name (free-text search)
- Results are sorted by relevance (default) or by newest listing date.
- Only listings in `active` state are visible to non-provider users.
- Keyset pagination applies; page size 20.

#### 2.2 View a Listing Detail

- Any authenticated user can view the full detail of an `active` listing.
- The listing detail shows:
  - Provider org name and verified domain(s)
  - Listing title and description
  - Service category and category-specific fields
  - Regions / countries of operation
  - Average rating and review count (once reviews are available)
  - A button to send an Engagement Request

#### 2.3 Unauthenticated Access

- Unauthenticated users (not logged in) can view a read-only public version of the marketplace
  listing directory and individual listing pages. They cannot send engagement requests or write
  reviews. This enables external search-engine indexing.

---

### 3. Engagement Requests

#### 3.1 Send an Engagement Request

- An authenticated Hub User or Org User can send an Engagement Request against an active
  listing.
- Fields:
  - A short message (required; max 1000 characters) describing what they need
  - Contact preference: "reply via platform" or "reply via email" (their profile email)
- A user may only have one open (non-terminated) engagement request per listing at a time.

#### 3.2 Provider Org Response

- OrgUsers with `employer:manage_marketplace` (or superadmin) can view incoming engagement
  requests for their listings.
- They can:
  - **Accept**: Indicate they will engage. The requester is notified. An accepted request can
    be later marked **Completed** or **Abandoned**.
  - **Decline**: Provide an optional decline note (max 300 characters). The requester is
    notified.
- Requests that receive no response within 30 days are automatically **Expired**.

#### 3.3 Engagement Lifecycle States

```
pending → accepted → completed
                   → abandoned
pending → declined
pending → expired  (auto, after 30 days)
```

#### 3.4 Notifications

- The requester is notified (in-platform + email) when their request is accepted, declined,
  or expired.
- The Provider Org is notified (in-platform + email) when a new engagement request arrives.

---

### 4. Reviews and Ratings

#### 4.1 Who Can Review

- A Hub User or Org User who has had at least one **completed** engagement with a listing may
  leave one review for that listing.
- A user can update their own review (the original review is replaced).
- A user can delete their own review.

#### 4.2 Review Fields

| Field | Type | Required | Constraints |
|---|---|---|---|
| `rating` | integer | Yes | 1–5 (stars) |
| `title` | string | Yes | max 120 characters |
| `body` | string | No | max 2000 characters |

#### 4.3 Review Visibility

- Reviews are visible to all authenticated users on the listing detail page.
- The reviewer's name is shown unless they opt to post anonymously.
- Anonymous reviews still count toward the rating average.

#### 4.4 Rating Aggregation

- The listing detail shows the mean rating (rounded to one decimal place) and the count of
  reviews.
- Rating breakdown by star level (1–5) is also shown.

#### 4.5 Review Moderation

- Vetchium Admins can hide individual reviews that violate platform policies.
- Hidden reviews are excluded from the rating average and are not visible to regular users.
- The reviewer is notified when their review is hidden, with a policy reference.

---

### 5. Admin Moderation

#### 5.1 Review Queue

- Vetchium Admins can view the queue of listings in `pending_review` state.
- They can approve (→ `active`) or reject (→ `draft`, with a rejection note) a listing.
- The Provider Org is notified of the outcome.

#### 5.2 Suspend a Listing

- Vetchium Admins can suspend an `active` listing, moving it to `suspended`.
- They must provide a reason (max 500 characters).
- The Provider Org is notified.
- Admins can lift a suspension, returning the listing to `active` without re-review.

#### 5.3 Audit Trail

- All admin moderation actions (approve, reject, suspend, unsuspend, hide review) are recorded
  in the `admin_audit_logs` table with full context.

---

### 6. Roles and Permissions

#### New Roles (Employer Portal)

| Role slug | Description |
|---|---|
| `employer:manage_marketplace` | Create, edit, submit, withdraw listings; respond to engagement requests |
| `employer:view_marketplace` | View own org's listings and incoming engagement requests (read-only) |

`employer:superadmin` implicitly has all marketplace permissions.

#### Admin Roles (Admin Portal)

No new admin role is needed. The existing admin authentication and the new marketplace
moderation actions are accessible to any authenticated Vetchium Admin.

---

## Category-Specific Fields: JobAgency

The `jobagency` category captures the following additional structured fields on a listing:

| Field | Type | Required | Description |
|---|---|---|---|
| `specialisations` | list of tags | Yes (min 1) | Areas of hiring expertise (e.g., "software engineering", "finance", "executive search"). Selected from a pre-defined tag set. |
| `placement_types` | list of enum | Yes (min 1) | Types of placement offered: `permanent`, `contract`, `temp_to_perm`, `executive` |
| `operates_in` | list of region/country codes | Yes (min 1) | Geographies the agency actively sources candidates in |
| `typical_fee_model` | enum | No | How they charge: `contingency`, `retained`, `flat_fee`, `subscription`, `negotiable` |
| `typical_time_to_fill_days` | integer range | No | Approximate time-to-fill in days (min, max) |
| `minimum_hiring_budget` | currency + amount | No | Minimum engagement size they accept (e.g., "USD 5000") |
| `languages_supported` | list of BCP-47 language tags | No | Languages the agency works in |
| `testimonials` | list of short quotes | No | Up to 3 client testimonials; max 300 characters each; source name optional |
| `website_url` | URL | No | Agency or service-specific landing page |
| `case_studies_url` | URL | No | Link to portfolio / case studies page |

### JobAgency Specialisation Tags

Specialisation tags for the `jobagency` category are managed by Vetchium Admins (they are not
free-form strings entered by the Provider Org). Admins can add and retire tags. Retired tags
remain on existing listings but cannot be selected for new or updated listings.

---

## Non-Goals (Out of Scope for This Spec)

- Payment processing or escrow
- In-platform contract negotiation or document signing
- Real-time chat between provider and requester (async messaging via engagement requests only)
- Marketplace for Hub Users to list freelance services (this spec covers Employer orgs only)
- Automatic matching / recommendation engine (may follow in a later spec)
- Multi-category listings (one listing = one category)
- Public API / webhook for listing data

---

## Open Questions

1. Should unauthenticated browsing be enabled from day one, or gated behind login initially?
2. Should Provider Orgs be required to have at least one verified domain before creating a
   listing, or is org account creation sufficient?
3. Should engagement requests go through a messaging thread (multiple messages back and forth),
   or is a single message + accept/decline sufficient for the MVP?
4. How are `specialisation` tags initially seeded, and who maintains them?
5. Should a Hub User's engagement request history be visible to that user (i.e., a "my
   enquiries" page)?
6. Should Org Users be able to send engagement requests on behalf of their employer, distinct
   from a Hub User sending a personal request?
7. What is the review/moderation SLA expectation for listings in `pending_review`?
