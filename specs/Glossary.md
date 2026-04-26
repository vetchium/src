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
- States: DRAFT, PUBLISHED, PAUSED, CLOSED, ARCHIVED
- Stored in a specific region, never migrates

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
