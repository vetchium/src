Principals and identity:

Hub user — an individual with a profile, in the Hub portal.
Org — an employer or agency, in the Org portal. Also called a company.
Org user — a person acting inside one org; cell-local id, not a principal of the federation.
Admin — a platform maintainer; cell-local, scoped to one country.
Principal — a hub user or an org: the two things that own data, are routable, and can migrate.
DID (_\_did) — a principal's stable, opaque, never-reused UUID. Encodes no location.
OID (_\_oid) — a seeded config id (language, plan, capability, opening tag), byte-identical in every cell, never minted at runtime.
Handle — a hub user's public name in a URL; unique per country, mutable, re-assignable.
Follow — a one-way interest used for network-opportunity discovery and warm endorsement suggestions. It is not evidence that the users worked together and grants no endorsement privilege.
Domain — an org's DNS-verified domain; globally unique, owned by one org at a time. One is primary.
Home cell — the cell holding a principal's authoritative rows and credentials. Every principal is single-homed.
Migration — moving a principal to another cell; a fenced flip of one global routing row.
Hiring:

Opening — a job post owned by an org. Numbered per (org, country).
Application — a hub user applying to an opening. Authoritative in the org's cell.
Candidacy — an application that advanced into the interview pipeline.
Interview — a scheduled event under a candidacy, with interviewers, RSVP and feedback.
Offer — the offer letter extended on a candidacy; the candidate accepts or declines.
Endorsement — a requested written vouch attached to an application, from a user whose verified work-email stint overlaps the applicant's at one employer domain.
Reference — a structured Q&A the org requests on a candidacy; nominees answer.
Referral — an agency proposing a candidate for a client org's opening.
Work-email stint — a verified mailbox at an employer domain plus the user's self-declared employment years. Backs endorsement/reference eligibility and network-opportunity discovery.
Marketplace:

Capability — a seeded service category an org can offer. Staffing is the first.
Listing — a service offer by a provider org. Numbered per (org, country).
Subscription — a consumer org subscribing to a provider's listing. Authoritative provider-side.
Agency assignment — a client org officially assigning an agency to one of its openings.
