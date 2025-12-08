## Portals

### Employer Portal

- Used by Employers via OrgUsers
- Employers are Organizations that post job openings

### Hub Portal

- Used by Professionals (HubUsers)
- For job searching, applications, professional networking

### Agency Portal

- Used by Agencies via AgencyUsers
- For sourcing candidates and managing hiring

### Admin Portal

- Used by Vetchium administrators
- For platform moderation and administration

## Core Entities

### Employer

- Organization that posts job openings
- Must have at least one verified domain
- Has a primary region and operating regions
- Contains OrgUsers

### OrgUser

- User belonging to an Employer
- Logs into Employer Portal
- Roles: ADMIN, RECRUITER, HIRING_MANAGER, VIEWER

### HubUser

- Professional user on the Hub
- Has a HomeRegion where PII is stored
- Can apply to openings in any region

### Agency

- Third-party organization helping Employers source candidates
- Similar domain verification as Employers

### AgencyUser

- User belonging to an Agency
- Logs into Agency Portal

### Opening

- Job posting created by Employer
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
