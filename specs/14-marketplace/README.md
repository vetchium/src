# Vetchium Marketplace — Functional Requirements

Status: DRAFT
Authors: @psankar
Dependencies: Org accounts, OrgUser accounts, Verified Domains

---

## Overview

The Vetchium Marketplace is where Employer Organisations ("Orgs") can list professional services
they offer to other Orgs. It is the connective tissue between service providers and buyers inside
the Vetchium ecosystem.

The first — and for now only — service category is **Talent Sourcing**: a provider Org recruits
talent on behalf of a buyer Org. This is a pure B2B interaction. HubUsers (professionals) are not
consumers of Talent Sourcing ServiceListings.

The Marketplace is not a transactional platform. Vetchium does not handle payments, contracts, or
communications. It connects providers with buyers; the provider supplies a contact URL and all
follow-up happens off-platform.

---

## Goals

- Allow an Org to advertise Talent Sourcing services to other Orgs on the platform.
- Allow buyer Orgs to discover and filter ServiceListings by criteria that matter (industry,
  geography, role types, company size, seniority).
- Give interested Buyer Orgs a clear, direct path to reach the provider via a contact URL
  (CRM form, booking page, website — whatever the provider chooses).
- Nothing built now should prevent later extensions: on-platform messaging, AI agent responders,
  CRM webhook forwarding, or additional service categories.

## Non-Goals (for this version)

- Payments, invoicing, or contracts.
- HubUser access to the marketplace (they are not buyers of Talent Sourcing).
- Structured or validated pricing (providers write whatever they want).
- On-platform messaging or lead management.
- ServiceListing expiry / renewal cycles.
- Reviews or ratings of providers.
- Public (unauthenticated) access to ServiceListings.

---

## Actors

| Actor              | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Provider Org**   | An Org that creates and manages one or more ServiceListings                           |
| **Buyer Org**      | An OrgUser at a different Org who browses ServiceListings and contacts the provider   |
| **Vetchium Admin** | Reviews ServiceListings before they go live; can suspend or reinstate ServiceListings |

> An Org may simultaneously be a provider (advertising its own Talent Sourcing service) and a buyer
> (browsing other providers). These roles are not mutually exclusive.

---

## Core Concepts

### ServiceListing

A ServiceListing is created by a Provider Org to advertise a specific service it offers. Each
ServiceListing belongs to exactly one **service category** (e.g., `talent_sourcing`). A Provider
Org may have any number of active ServiceListings, including multiple ServiceListings in the same
category — for example, one ServiceListing focused on engineering roles in India and another
focused on executive placements in Europe.

Each ServiceListing is a distinct, independently managed entity. There is no forced relationship
between two ServiceListings from the same Org.

### Service Category

A service category defines the type of service and the structured fields that ServiceListings in
that category must provide. Categories are defined by Vetchium, not by Orgs.

| Category slug     | Human name      |
| ----------------- | --------------- |
| `talent_sourcing` | Talent Sourcing |

### ServiceListing States

A ServiceListing moves through the following states:

```
draft → pending_review → active
                       ↕
                    suspended        (by Vetchium Admin)
active → paused → pending_review    (by Provider Org; unpause requires re-review)
active / paused → archived          (by Provider Org)
```

| State            | Who can see it                | Description                                              |
| ---------------- | ----------------------------- | -------------------------------------------------------- |
| `draft`          | Provider Org only             | Created but not yet submitted for review                 |
| `pending_review` | Provider Org + Vetchium Admin | Submitted; awaiting KYB approval                         |
| `active`         | All logged-in Buyer Orgs      | Live in the marketplace                                  |
| `paused`         | Provider Org only             | Temporarily hidden by the provider; not discoverable     |
| `suspended`      | Provider Org + Vetchium Admin | Removed from public view by Vetchium Admin               |
| `archived`       | Provider Org only             | Permanently removed from the marketplace by the provider |

A rejected submission returns the ServiceListing to `draft` with an Admin-provided rejection
reason, so the provider can edit and resubmit.

---

## ServiceListing Fields

### Common to All Service Categories

| Field                | Required | Notes                                                                                   |
| -------------------- | -------- | --------------------------------------------------------------------------------------- |
| Name                 | Yes      | A short title for the ServiceListing (e.g., "Senior Tech Hiring — India & SEA")         |
| Short blurb          | Yes      | A one- or two-sentence summary shown in browse results                                  |
| Description          | Yes      | Full details; free-form rich text                                                       |
| Countries of service | Yes      | Countries where the provider can deliver this service                                   |
| Contact URL          | Yes      | A URL where interested Buyer Orgs can reach the provider (CRM form, booking page, etc.) |
| Pricing information  | No       | Free-form text; provider writes anything they want. Vetchium imposes no structure here. |

### Talent Sourcing — Specific Fields

| Field                       | Required | Notes                                                                                      |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Industries served           | Yes      | One or more industries the provider specialises in (e.g., Technology, Healthcare, Finance) |
| Company sizes served        | Yes      | One or more size bands: Startup (1–50), SMB (51–500), Enterprise (500+)                    |
| Job functions sourced       | Yes      | One or more job function families (e.g., Engineering, Sales, Operations, Executive)        |
| Seniority levels sourced    | Yes      | One or more: Intern, Junior, Mid, Senior, Lead, Director, C-Suite                          |
| Geographic sourcing regions | Yes      | Where the provider sources candidates from (may differ from countries of service)          |

> The distinction between "countries of service" (where the provider serves clients) and
> "geographic sourcing regions" (where they find candidates) matters for buyers. A provider
> headquartered in India may serve European clients but source candidates only from South Asia.

---

## Provider Org: Creating and Managing ServiceListings

### Who Can Manage ServiceListings

Within a Provider Org, only OrgUsers with the `org:manage_marketplace` role (or `org:superadmin`)
may create, edit, submit, pause, or archive ServiceListings. OrgUsers without this role cannot see
the ServiceListing management interface at all.

### Creating a ServiceListing

1. An authorised OrgUser opens the Marketplace section of the Org Portal and clicks "New ServiceListing".
2. They select the service category (`talent_sourcing`) and fill in all required fields.
3. The ServiceListing is saved as `draft`. The provider can return to edit it at any time while it
   is a draft.
4. When ready, the provider submits it for review. The state becomes `pending_review`.

### KYB Review

Vetchium Admin reviews the submission before it goes live. The purpose is twofold:

- **Business legitimacy**: Vetchium verifies that the submitting Org is a real, operating business
  that can actually deliver the claimed service. The mechanism for this verification (document
  checks, fee payment, etc.) is out of scope for this spec but must be accounted for in the
  workflow.
- **Content quality**: The ServiceListing must accurately describe the service. Misleading or
  spammy content is rejected.

If the Admin **approves**: the ServiceListing moves to `active` and becomes discoverable.
If the Admin **rejects**: the ServiceListing returns to `draft` with a written rejection reason
visible to the provider. The provider may edit and resubmit.

Vetchium may in the future require a ServiceListing fee as part of the KYB step. The spec does not
prescribe how that is collected, but the review workflow must not assume it will always be free.

### Editing a Live ServiceListing

A provider may edit any field of an `active` or `paused` ServiceListing at any time. Edits do not
go live immediately and trigger the Vetchium Admin approval flow once again. The Admin can either
choose to approve or reject the change. On rejection, the ServiceListing will go back to the
previous state (either `draft` or `active` but with the old content).

The ServiceCategory of a ServiceListing cannot be changed and is immutable.

### Pausing a ServiceListing

A provider may pause an active ServiceListing at any time. A `paused` ServiceListing disappears
from the marketplace immediately but retains all data. The provider can unpause it, but it will
again go through the Vetchium Admin review flow.

### Archiving a ServiceListing

Archiving is permanent. An archived ServiceListing is no longer shown anywhere to Buyer Orgs and
cannot be reinstated.

---

## Buyer Org: Discovering ServiceListings

### Who Can Browse

Only logged-in OrgUsers may access the marketplace. Unauthenticated users cannot see
ServiceListings. All OrgUsers can browse by default; no special role is required to view the
marketplace.

### Browse and Search

The marketplace presents `active` ServiceListings. Buyers can:

- **Search by keyword** across the ServiceListing name, blurb, and description.
- **Filter by service category** (only `talent_sourcing` for now; designed to support more later).
- **Filter by countries of service** — "which providers can serve clients in country X?"
- **Filter by industry** — "which providers work in my industry?"
- **Filter by company size** — "which providers work with orgs my size?"
- **Filter by job function** — "which providers source for the roles I need?"
- **Filter by seniority level** — "which providers place senior engineers?"
- **Filter by geographic sourcing region** — "which providers source candidates from region Y?"

Filters are combinable. Results use keyset pagination.

### ServiceListing Detail View

Clicking a ServiceListing shows the full description, all structured fields, the provider's Org
name (and their verified domain, so buyers can look them up externally), and a prominent "Contact
Provider" button that opens the provider's Contact URL in a new tab.

Vetchium does not track whether a buyer clicked the Contact URL. All lead capture and follow-up
is the provider's responsibility from that point on.

---

## Vetchium Admin Capabilities

| Action                           | Description                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| View all ServiceListings         | See ServiceListings in any state, filterable by state, category, Org, and submission date           |
| Review pending ServiceListing    | Approve (→ `active`) or reject (→ `draft` with rejection note) a `pending_review` ServiceListing    |
| Suspend an active ServiceListing | Move an `active` ServiceListing to `suspended` with a mandatory written reason sent to the provider |
| Reinstate a ServiceListing       | Move a `suspended` ServiceListing back to `active`                                                  |

Admins do not create or edit ServiceListings. They are a moderation layer, not a content layer.

---

## Roles and Permissions

### New Role

| Role slug                | Scope      | Description                                                         |
| ------------------------ | ---------- | ------------------------------------------------------------------- |
| `org:manage_marketplace` | Org Portal | Create, edit, submit, pause, and archive this Org's ServiceListings |

`org:view_marketplace` is intentionally not introduced at this time. Viewing the marketplace (as a
buyer) is available to all OrgUsers without a special role. ServiceListing management is
exclusively `org:manage_marketplace` or `org:superadmin`.

Admin roles for marketplace moderation are handled by Vetchium Admins with the existing
`admin:superadmin` role for now. A dedicated `admin:manage_marketplace` role can be introduced
when the team grows to warrant it.

---

## State Transition Summary

| From             | To               | Who                                              | Condition                                     |
| ---------------- | ---------------- | ------------------------------------------------ | --------------------------------------------- |
| `draft`          | `pending_review` | Provider (OrgUser with `org:manage_marketplace`) | All required fields are filled                |
| `pending_review` | `active`         | Vetchium Admin                                   | KYB approved                                  |
| `pending_review` | `draft`          | Vetchium Admin                                   | Rejected; rejection note required             |
| `active`         | `paused`         | Provider                                         | Any time                                      |
| `paused`         | `pending_review` | Provider                                         | Provider requests unpause; re-review required |
| `active`         | `suspended`      | Vetchium Admin                                   | Policy violation; reason required             |
| `suspended`      | `active`         | Vetchium Admin                                   | Violation resolved                            |
| `active`         | `archived`       | Provider                                         | Irreversible                                  |
| `paused`         | `archived`       | Provider                                         | Irreversible                                  |

---

## Edge Cases and Clarifications

**Provider Org is also a Buyer Org**: An Org may browse ServiceListings from other providers while
also maintaining its own ServiceListings. No conflict. The Contact URL on its own ServiceListing is
irrelevant to it as a buyer — it browses others' ServiceListings normally.

**Multiple ServiceListings, same provider**: Buyer Org sees each ServiceListing as a separate card
with its own Contact URL. The provider may use different Contact URLs per ServiceListing (e.g.,
different CRM campaigns for different service tiers or geographies).

---

## Future Considerations

The following are explicitly out of scope now but should not be architected against:

- **On-platform messaging**: A Buyer Org initiates a conversation thread directly from a
  ServiceListing, removing the need for an external Contact URL.
- **Lead tracking**: Vetchium records when a buyer clicks a Contact URL so the provider can see
  interest signals without needing their own analytics.
- **CRM webhook forwarding**: When a buyer expresses interest, Vetchium pushes structured lead
  data to the provider's CRM automatically.
- **AI agent responders**: A Provider Org plugs in an AI agent to handle initial enquiries on
  their behalf.

---

## Open Questions

1. **KYB mechanism**: What documents or signals does Vetchium Admin use to approve a
   ServiceListing? Does a fee need to be paid, and through which channel? This needs a separate
   spec or at minimum a process document before the Admin review workflow is built.

2. **Industries, job functions, company sizes**: Should Vetchium define a closed enumeration (a
   taxonomy) or allow providers to type custom values? A closed taxonomy is better for filtering
   accuracy but requires maintenance.

3. **ServiceListing fee timing**: Is the fee collected at `pending_review` submission or at
   `active` transition? The flow differs meaningfully depending on the answer.
