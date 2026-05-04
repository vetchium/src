## Portals

### Org Portal

- Used by Organizations via OrgUsers
- Organizations post job openings and manage hiring

### Hub Portal

- Used by Professionals (HubUsers)
- For job searching, applications, professional networking

### Admin Portal

- Used by Vetchium administrators
- For platform moderation and administration

## Core Entities

### Org (Organization)

- Entity that posts job openings
- Must have at least one verified domain
- Has a primary region and operating regions
- Contains OrgUsers

### OrgUser

- User belonging to an Org
- Logs into Org Portal
- Roles enforced via RBAC (`org:superadmin`, `org:manage_users`, etc.)

### HubUser

- Professional user on the Hub
- Has a HomeRegion where PII is stored
- Can apply to openings in any region

### Opening

- Job posting created by an Org
- States: DRAFT, PENDING_REVIEW, PUBLISHED, PAUSED, EXPIRED, CLOSED, ARCHIVED
- Identified externally by the composite `(org_domain, opening_number)`; `opening_number` is a per-org atomic counter starting at 1
- Editable only while in DRAFT; once it leaves DRAFT, content is frozen — to change a published opening, close it and create a new one (the `duplicate` action seeds a fresh DRAFT from the old fields)
- Auto-expires 180 days after `first_published_at` via a regional background worker; the clock keeps ticking while PAUSED
- Stored in the org's home region, never migrates

### Hiring Team (on an Opening)

- **Hiring Manager** — single OrgUser ultimately accountable for the hire (required)
- **Recruiter** — single OrgUser running the talent-acquisition pipeline (required)
- **Hiring Team Members** — 0..10 OrgUsers who are potential team-mates (optional)
- **Watchers** — 0..25 OrgUsers who receive notifications but have no decision rights (optional)

### Work Email Stint (HubUser)

- A continuous period during which a HubUser is verifiably employed at a given employer domain (per the `hub-employer-ids` spec)
- States: `pending_verification` → `active` → `ended`; one row in `hub_employer_stints` per stint
- Carries `(first_verified_at, last_verified_at, ended_at?)`; the active period requires re-verification once every 365 days, with a 30-day grace before auto-end
- Globally unique per active stint (at most one HubUser holds a given email in `pending_verification` or `active` state at a time)
- Public profile shows only the **domain** of the stint plus the year-range; the address is private to the owning HubUser

### Hub Connection

- A bilateral relationship between two HubUsers, gated by overlapping verified work-email stints at the same domain (per the `hub-connections` spec)
- One canonical pair row in `hub_connections`; states: `pending` / `connected` / `rejected` / `disconnected`
- Asymmetric: the actor that ends a relationship (rejecter, disconnector, withdrawer) retains the option to restart it; the other party does not
- Block (`hub_blocks`) is a separate, one-way override that severs any pending or connected pair

### HubUser Profile

- The public surface of a HubUser: handle, multi-language display names, short_bio, long_bio, optional city, country, profile picture (per the `hub-profile` spec)
- Reachable by exact handle only in Phase 1 (no search). Any authenticated HubUser can view any active HubUser's profile

### Application

- Created when HubUser applies to Opening
- States: APPLIED, SHORTLISTED, REJECTED_AT_APPLICATION
- Stored in Opening's region

### Candidacy

- Created when Application is shortlisted
- Has multiple possible states (extensible)
- Stored in Opening's region

### Interview

- Belongs to a Candidacy
- States: SCHEDULED, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED

## Architecture Terms

### Global Database

- Central database for cross-region lookups
- Contains regions list and email digests

### Regional Database

- Independent PostgreSQL per region
- Stores actual user data and PII

### HomeRegion

- HubUser's primary region where their PII is stored

### Email Address Digest

- SHA-256 hash of email address stored globally
- Used for uniqueness enforcement and login routing
