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
- Suspended org — an org whose only domain stayed failing past the grace period and was released; its users can sign in only to restore the domain.

## Hiring

- Opening — a job post owned by an org; numbered per (org, country).
- Application — a Hub user applying to an opening; authoritative in the org's tenant.
- Candidacy — an application advanced into the interview pipeline.
- Interview — a scheduled event under a candidacy, with interviewers, RSVP, and feedback.
- Offer — the offer letter extended on a candidacy; the candidate accepts or declines.
- Endorsement — a requested written vouch on an application from a user whose verified work-email stint overlaps the applicant's at one employer domain.
- Reference — a structured Q&A the org requests on a candidacy; nominees answer.
- Referral — an agency proposing a candidate for a client org's opening.
- Work-email stint — a verified mailbox at an employer domain plus self-declared employment years; backs endorsement and reference eligibility and network-opportunity discovery.

## Marketplace

- Capability — a seeded service category an org can offer; Staffing is the first.
- Listing — a provider org's service offer; numbered per (org, country).
- ServiceConsumer — a consumer org subscribing to a provider's Listing; authoritative provider-side.
- Agency assignment — a client org officially assigning an agency to one of its openings.

## Subscriptions

- Plan — a Hub subscription tier identified by its plan OID with a unique rank; a higher rank includes everything a lower rank allows.
- Subscription — a Hub user's single current plan, billing interval, period, and scheduled change, stored on the user's row in the home tenant.
- Offered plans — the plans a tenant sells, configured in both the backend and `hub-ui`.

## Location

- Resident country — a Hub user's self-declared current country, independent of their home tenant.
- Preferred job countries — up to ten discovery countries, initially the residence, later independently editable; empty means no country filter.
- Signup region — the tenant a user selects from the configured eligible regions; country recommendations do not force placement.
