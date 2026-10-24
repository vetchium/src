# Glossary

Applies to product terms in prompts, specifications, code, and UI text.

## Principals and identity

- Hub user — an individual with a profile, in the Hub portal.
- Org — an employer or agency, in the Orgs portal; also called a company.
- Org user — a person acting inside one org; tenant-local, not a federation principal; unique per (org, email), so one email may belong to users of several orgs.
- Admin — a platform maintainer; tenant-local, scoped to one country.
- Principal — a Hub user or an org: the two things that own data, are routable, and can migrate.
- DID (`_did`) — a principal's stable, opaque, never-reused UUID; encodes no location and never leaves the backend and private mesh (browser APIs use a Hub user's handle or an org's domain).
- OID (`_oid`) — a seeded configuration id (language, plan, capability, opening tag), byte-identical in every tenant, never minted at runtime.
- Handle — a Hub user's globally unique, permanent, generated name in the canonical `/u/<handle>` URL; never reassigned.
- Account email — the address a Hub user signs in with; globally unique across tenants, reserved at signup, moved by a durable reserve/apply/finalize saga on change.
- Identity digest — the keyed HMAC of a normalized Hub account email (formula in `federation.md`); the only form of the address the global coordinator stores.
- Alias — one optional, globally unique, human-chosen `/u/<alias>` label from the Silver plan; not canonical, released immediately when changed, deleted, or lost on downgrade.
- Follow — one-way interest for network-opportunity discovery and warm endorsement suggestions; not evidence of working together and grants no endorsement privilege.
- Domain — an org's DNS-verified domain; globally unique, owned by one org at a time; one is primary.
- Home tenant — the tenant holding a principal's authoritative rows and credentials; every principal is single-homed.
- Migration — moving a principal to another tenant: a fenced flip of one versioned global routing row.

## Orgs

- Org signup — an org joining a tenant by proving control of its first domain with a mailbox on that exact domain plus a published DNS TXT record.
- Requester — the person (typically domain IT staff) who requests and completes org signup and becomes its first superadmin; never call them founder or owner — they need not have started or own the company.
- Superadmin — an org user holding `org:superadmin`; an active org always keeps at least one active superadmin.
- Verified / failing domain — TXT record found at the last conclusive check / absent on consecutive periodic checks.
- Org country — where an org is based, chosen at signup; unrelated to its home tenant.
- Suspended org — an org whose only domain stayed failing past the grace period and was released; its users can sign in only to restore the domain.

## Hiring

- Opening — a job post owned by an org; numbered per org.
- Working copy — an Opening's editable content: the draft before first publication, a revision after it.
- Opening request — a pending publish, revise, pause, reopen, or close of one Opening, awaiting an approver; at most one per Opening.
- Approver — an org user holding `org:approve_openings`; their own requests apply at once.
- Hiring team — the hiring manager, recruiter, and team members named on an Opening; internal, never shown to Hub users.
- Employing country — the one country of the entity hiring for an Opening.
- Applicant — a Hub user who applied to an Opening themselves; stored once per (org, person) in the org's tenant.
- Application — an applicant's submission to one Opening, numbered per Opening; authoritative in the org's tenant.
- Pipeline — an Opening's ordered stages (`review`, `assessment`, `interview`, `background_check`), copied from a pipeline template and owned by the Opening.
- Candidate — an applicant the employing org shortlisted from the Applicants stage.
- Candidacy — what shortlisting creates for an application: at a stage, offered, or offer accepted.
- Interview — a scheduled event under a candidacy, with interviewers, RSVP, and feedback.
- Offer — the offer letter extended on a candidacy; the candidate accepts or declines.
- Joined on / separated on — dates the org records after an accepted offer; billable facts for sourcing.
- Endorsement — a requested written vouch on an application from a user whose verified work-email stint overlaps the applicant's at one employer domain.
- Reference — a structured Q&A the org requests on a candidacy; nominees answer.
- Work-email stint — a verified mailbox at an employer domain plus self-declared employment years; backs endorsement and reference eligibility and network-opportunity discovery.

## Marketplace

- Capability — a seeded service an org can provide: `sourcing`, `interviewing`, `assessment`, `background_check`.
- Provider / consumer — the org performing a Capability / the org using it for its Openings.
- Listing — a provider's offer of one Capability, with the countries it serves; one per (org, Capability).
- Engagement — a consumer and a provider agreeing to work together on one Capability; authoritative in the consumer's tenant.
- Assignment — an engagement attached to an Opening (sourcing) or an Opening stage.
- Route — the choice, per candidacy at a stage, of in-house or one assigned engagement.
- Agency — an org whose `sourcing` Listing is listed.
- Conversation — a chat an agency starts with one Hub user inside Vetchium; messages are authoritative in the agency's home tenant, and the Hub user's tenant holds a pointer; never exposes contact details.
- Contact — an agency's own record of one Hub user, created by its first note or message about them; never an applicant or candidate; outlives the conversation.
- Agency note — a private note an agency keeps on a Contact; never shown to the Hub user or any other Org.
- Opening suggestion — an agency posting an Opening it is assigned to in a conversation; applying from it credits the agency.
- Credit — the one `sourcing` engagement an applicant chooses as referrer when applying (one that suggested the Opening, or one named by primary domain), or none; fixed at apply time.
- Activity statement — one engagement's billable facts for one month; never an invoice and never an amount.

## Subscriptions

- Plan — a Hub subscription tier identified by its plan OID with a unique rank; a higher rank includes everything a lower rank allows.
- Subscription — a Hub user's single current plan, billing interval, period, and scheduled change, stored on the user's row in the home tenant.
- Offered plans — the plans a tenant sells, configured in both the backend and `hub-ui`.
- Org plan — `org-free-tier`, `org-silver-tier`, or `org-gold-tier`, with entitlements (seats, Openings per year, logo, Google sign-in) defined once in the contract.
- Seat — an active Org user or an unexpired pending invitation; the plan's user cap counts seats.
- Preset — a role label in the Orgs portal (Superadmin, Finance, User manager, Recruiter, Hiring approver, Vendor manager, Provider staff, Member) that pre-ticks permission checkboxes; not stored.
- Google sign-in — a Gold Org's optional sign-in with its members' Google Workspace accounts; skips Vetchium TOTP.

## AI

- AI operation — one AI feature, such as `org-opening-draft`, with its own permission, prompt, and output validation.
- Model OID — Vetchium's stable name for a model a region offers, independent of the server hosting it.
- AI credit — the whole unit AI usage is charged in; each model has credit rates per million input and output tokens.
- Credit lot — credits from one monthly grant or one purchased pack, with its own expiry.
- Reservation — credits held for a model call in progress; settling charges at most that much.
- Kept text — a call's prompt and answer, kept for the region's retention period for support and abuse review.

## Location

- Resident country — a Hub user's self-declared current country, independent of their home tenant.
- Preferred job countries — up to ten discovery countries, initially the residence, later independently editable; empty means no country filter.
- Signup region — the tenant a user selects from the configured eligible regions; country recommendations do not force placement.
