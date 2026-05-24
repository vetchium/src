# Connection-Enhanced Hiring

**Status**: BRAINSTORM / REQUIREMENTS  
**Authors**: @psankar  
**Date**: 2026-05-23  
**Depends on**: colleague connections (implemented), work email stints (implemented), job openings (implemented), job applications (not yet implemented)

---

## Personas used in examples

Conceptual sections throughout this document use the following shorthand consistently:

- **P2** — a Hub user who is actively job-seeking (the candidate / applicant)
- **P1** — P2's former colleague; depending on the scenario, P1 is either endorsing P2, referring them, or is a current employee at the company P2 is applying to
- **Company A** — the company where P2 and P1 both held verified work email stints (their shared employment history)
- **Company D** — the company P2 is applying to (the hiring company)

The detailed workflow narratives introduce additional personas (P3, P4) within each workflow where more than two people are involved. Each workflow defines its own cast at the start.

---

## What makes Vetchium's connection graph different

Before getting into features, this distinction needs to be stated clearly because every proposal in this document flows from it.

On most professional social networks, anyone can connect with anyone. A recruiter from a company you've never heard of, a salesperson you met briefly at a conference, a second-degree contact who saw your profile — all "connections." The network becomes noise. A recommendation on such platforms might be written by someone who never worked with you directly.

In Vetchium, two people can only be connected if they **both** verified work emails at the same employer domain and their tenures overlapped in time. This is enforced by the server, not self-reported. When P1 is a connection of P2, it is a verifiable fact that they were colleagues at the same company during the same period. The system knows the company domain, the start year, the end year, and that both people confirmed the relationship by successfully receiving email at that employer.

This means: a colleague endorsement on Vetchium is not "someone I vaguely know said something nice." It is "a person who provably worked alongside me — at the same company, at the same time — is attesting to what they witnessed firsthand." That is the entire value proposition of what follows. Every feature below only works because this foundation is solid.

---

## The hiring problem being solved

Hiring has a trust problem at every stage, and it gets resolved in the wrong order.

### The recruiter's problem

A recruiter posting a senior engineering role might receive 200+ applications within 48 hours. Of those, perhaps 15 are genuinely worth a phone call. The recruiter has no good mechanism to separate the 15 from the 185 without investing significant time in each application. The signals available are:

- **Resume**: Entirely self-reported. Anyone can claim anything. Skills assessments exist but add friction. A resume says "led a team of 8 engineers" and there is no way to check this at the top of the funnel.
- **Cover letter**: Largely a formality. Most are generic. The good ones are rare and take experience to spot.
- **ATS keyword filtering**: Excludes good candidates who didn't use the right words. Includes bad candidates who gamed the keywords.
- **Internal referrals**: By far the highest-signal source. Referred candidates have a 55% higher retention rate (Jobvite data). But internal referrals are ad-hoc, happen via Slack messages or personal emails, are untracked, can be biased, and don't scale.

References — the only mechanism that actually involves people who witnessed the candidate doing the job — happen at the very end of the process, after the company has spent weeks on phone screens, technical interviews, and panel discussions. By that point there is enormous sunk cost. Reference checks become a formality rather than a genuine filter. Almost no one fails a reference check; it is done when the decision is already made.

### The candidate's problem

Strong candidates — people who do genuinely good work but are not great self-promoters — apply to jobs and enter black holes. The application was screened out by keywords. Or it was reviewed for 15 seconds before being passed over. Their manager from their previous company would vouch for them enthusiastically, but no one asked, and the candidate can't put their manager's endorsement in the resume without it looking like the candidate wrote it themselves.

Candidates who are currently employed are particularly constrained. They are job-hunting quietly. They cannot ask their current manager for a reference. They cannot publicly broadcast that they are looking. Their existing colleagues at their previous company — the people best positioned to speak to their work — are sitting unused as a signal source.

### The hiring manager's problem

A hiring manager building a team faces a compounding problem: every bad hire costs time, team morale, and money. The best predictor of how someone will perform in a role is how they performed in a comparable role before — ideally observed by someone the hiring manager can trust. But that information is hard to get early, and the process does not create a good mechanism for it.

### What a colleague network can actually change

The core change is **front-loading trust**. Instead of:

> Apply cold → ATS screening → Phone screen → Interview → Interview → Reference check → Hire

The flow becomes:

> Apply with colleague context → Early endorsements visible → Recruiter invests in the right applications → Interview → Hire

The references do not move to the end because they're unimportant; they move to the front because that's when they're most useful for both parties.

---

## Design principles

These principles should guide every feature decision and be used to reject features that don't belong.

**1. Endorsements must be earned, not transactional.**  
If asking for an endorsement feels like a routine social obligation (like one-click skill endorsements on other professional networks), they become noise. The mechanism must make it natural to write a substantive, specific endorsement — and natural to decline without awkwardness. An endorser should feel they are giving something of value when they endorse, not just clicking a button.

**2. The candidate controls their own visibility.**  
A candidate may be job-hunting while currently employed. They must never be exposed to their current employer because of activity on Vetchium. Specifically: the fact that P2 is applying to a competitor should never be surfaced to P2's current employer's users. This is a hard requirement.

**3. Connection quality is shown, not abstracted away.**  
A recruiter reviewing an endorsement should see the context of the relationship: where they worked together, how long the overlap was, how recent it was. This is what distinguishes a 3-year close collaborator's endorsement from a 6-month acquaintance at the same company. The system has this data; use it.

**4. Endorsements supplement, never replace, evaluation.**  
A candidate with no connections should not be penalized. A candidate with many connections should not automatically advance. Endorsements are one signal among many. No ranking of candidates by connection count. No requirement to have connections to apply.

**5. Employer cannot browse the candidate's connection graph.**  
The employer sees endorsements that the candidate or their connections have chosen to provide. The employer does not get to see who the candidate is connected to, or reach into the candidate's network to solicit opinions without going through the candidate.

**6. Referrals by current employees must be voluntary and deliberate.**  
An employee who refers a colleague is putting some professional credibility on the line. The system should not make referrals feel cheap or automatic. An employee should be able to say "yes, I know this person, they're good" — and that should mean something.

---

## Feature areas

### 1. The application (prerequisite)

None of the connection-enhanced features exist without a basic application flow. The application is the foundation:

- A Hub user can apply to a Published opening
- The application captures: the candidate's handle, the opening they're applying to, and optionally a note (covering message)
- An application has a lifecycle: `applied → under_review → shortlisted → interviewing → offer_extended → (hired | rejected | withdrawn)`
- A candidate can see all their applications and their current state
- A recruiter or hiring manager at the company can see all applications to their openings
- An applicant can withdraw their application at any point before hired

This spec does not define the full application model in detail — that needs its own spec. What matters here is that the connection features sit on top of this foundation.

### 2. Colleague endorsements for applications

This is the central feature. When P2 applies to an opening at Company D, they can request endorsements from their connections. Because every connection is a verified former colleague, the endorsement carries real weight.

#### What an endorsement contains

An endorsement is not a generic character reference. It is application-specific and relationship-grounded:

- **Who wrote it**: the endorser's display name and handle
- **The verified relationship context**: automatically provided by the system — "Worked together at [company domain] from [year] to [year] ([N] years overlap)". The candidate or endorser does not fill this in; it is derived from the shared stint data.
- **The endorsement text**: written by the endorser, specifically for this application. There should be a prompt that guides them toward something useful: "What did you work on together that's relevant to this role? What specific strengths did you witness?"
- **Whether this endorsement was requested or volunteered**: the system knows. A volunteered endorsement (the endorser initiated it) is arguably a stronger signal than a requested one.
- **Date written**: endorsements have a freshness dimension — one written this month about someone who worked at the company 2 years ago is still fresh knowledge.

#### The endorsement request flow

1. P2 applies to an opening at Company D.
2. After applying, P2 can see their connection list filtered to connections with relevant context (colleagues from companies doing related work, or just all connections).
3. P2 selects one or more connections to request endorsements from.
4. P2 personalizes the request: "I applied for the Staff Engineer role at Company D, would you be willing to write an endorsement?" (optional note).
5. The selected connections receive a notification.
6. The connection (for example, P1) sees: the opening details (title, company domain), the relationship context (where and when they worked together), and a prompt to write an endorsement.
7. P1 can: write an endorsement, or decline. Declining has no social cost in the UI — there is no "declined" notification sent to P2, and P1 does not owe an explanation. P2 simply does not see an endorsement from P1.
8. If P1 writes an endorsement, it is attached to P2's application at Company D and visible to the recruiter and hiring manager reviewing the application.

#### The unsolicited endorsement

P1 may also voluntarily endorse P2 without being asked. Perhaps P1 sees P2's profile, knows they are job-hunting, and wants to proactively help:

- P1 can visit P2's profile and write a "standing endorsement" that is attached to P2's profile generally (visible to anyone viewing P2's public profile, or to recruiters who view P2's applications — P2 controls visibility).
- Or P1 can endorse P2 for a specific application if P2 has opted in to "allow connections to see my active applications."

Standing endorsements on a profile are different from application-specific endorsements. They are less targeted but show a pattern of credibility over time.

#### What the recruiter sees

When a recruiter at Company D opens P2's application, they see a section: "Colleague Endorsements." For each endorsement:

- The endorser's name and handle (clickable to their profile)
- The relationship badge: "Verified colleague — [company domain], [year]–[year] ([N] years)"
- The endorsement text
- Whether it was requested or volunteered

The recruiter cannot see which connections P2 asked who declined. They only see endorsements that were written.

If P2 has no endorsements, the section is absent. No judgment, no empty state calling attention to it.

#### Endorsement limits and quality controls

- A connection can only write one endorsement for a given (candidate, opening) pair. They can edit it before the company reviews the application (or within a time window).
- There should be a minimum length for endorsement text (e.g., 100 characters) to prevent "great person, hire them" one-liners.
- There should be a maximum (e.g., 2000 characters) to prevent essays.
- There is no upper limit on the number of endorsements P2 can request or receive, but in practice the recruiter will not read more than 3–4. A soft nudge to P2 ("You already have 3 endorsements; adding more may reduce their impact") is reasonable.

---

### 3. Connection visibility during job discovery

When P2 is browsing openings, for each opening where the hiring company has users whose connection graph overlaps with P2's, they should see a signal.

#### The specific signal

On the opening listing or detail page:

> "3 of your colleagues currently work here"

This does not name the colleagues yet (privacy — those colleagues may not know P2 is browsing this company). It is just a count that tells P2 "you have a warm path here." Clicking on it could show the colleague handles, but only if P2 takes an explicit action (the colleagues' presence at this company is visible on their public profiles via their stints, so this is not revealing private information — but it deserves a deliberate click rather than a passive display).

This feature requires being able to efficiently query: for a given opening's org domain, how many of P2's connections have an active work email stint at that domain?

#### Why this matters for candidates

Knowing you have colleagues at a company changes how you approach the application:
- You might reach out informally before applying (possible via direct messages, if that feature exists).
- You might ask a specific colleague to write an endorsement (rather than cold-guessing who would help).
- You might feel more confident applying because the company is not a complete unknown — your colleagues can give you a real picture of the culture.

#### Separate: openings at companies where your connections work

This is a passive job discovery feature. Rather than P2 searching for jobs, the system can surface:

> "Your colleague P1 (worked with you at [company domain], 2020–2022) now works at [Company D]. [Company D] has 2 open roles that may match your background."

This is warm network job discovery. P2 finds out about opportunities where they have a natural warm connection, without having to search for them. The quality of the opportunity doesn't change, but the information asymmetry is reduced: P2 knows someone inside who can give honest information about the role, team, and company.

This can be surfaced as a section on the Hub dashboard: "Opportunities through your network."

---

### 4. Employee referral by a current colleague

This is the reverse flow: P1 discovers an opportunity and thinks of P2.

#### The proactive nomination

P1 works at Company D (active verified stint). P1 sees an open role at Company D in their org portal. P1 thinks of P2, their former colleague from Company A, who would be a great fit.

P1 can nominate P2 for the role. This creates a "colleague nomination":
- P1 selects the opening.
- P1 searches for P2 in their connection list (because connections are colleagues, P1 is not nominating a stranger).
- P1 writes a brief statement: "I worked with P2 at Company A for [N] years. I think they'd be great for this role because..."
- The nomination is submitted.

What happens next:
- P2 receives a notification: "Your former colleague P1 thinks you'd be a great fit for [Role] at Company D. Would you like to apply?"
- P2 can accept (which creates a draft application), decline, or ignore.
- If P2 applies, the application is tagged as "Referred by P1" and P1's statement is attached as an endorsement.
- The hiring team at Company D can see: "This application came through a colleague referral from P1 (current employee; verified former colleague of applicant)."

#### Why this is better than current referral programs

Most company referral programs work like this: HR posts a form, employees fill it out with a name and email, HR tracks nothing, the referred candidate is indistinguishable from a cold applicant in the ATS. The referring employee gets a bonus if the hire goes through — which creates an incentive to refer anyone, not just great candidates.

A Vetchium colleague referral is different:
- The referral is made by a verified former colleague (the relationship is on-record, not claimed).
- The statement is attached to the application and visible throughout the review process.
- The referrer is accountable in a real sense — their professional reputation is indexed in the system, and their colleagues can see that they made the referral.
- The candidate has agency: they choose to apply or not.

This structure naturally filters for genuine referrals because P1 will not nominate someone they did not actually think was good — the relationship is verified and the statement is attached to their professional record.

#### Who can see what

- P2 (the candidate) sees: who nominated them and the statement.
- The hiring team at Company D sees: the nomination, the statement, and the relationship context (where and when P1 and P2 worked together).
- P1 (the referrer) sees: whether P2 applied (so they can follow up naturally). P1 does NOT see P2's application status in detail — that is P2's private information.

---

### 5. Passive colleague alert (opt-in, consent-first)

This is the mirror of feature 3 but from the perspective of the company's current employee.

When P2 applies to a role at Company D, and P1 is a current employee of Company D and a connection of P2, **if P2 has opted in**, P1 gets a notification:

> "Your former colleague P2 has applied for [Role] at your company. Would you like to write an endorsement?"

This is **opt-in by the candidate** and **opt-out by default.** P2 controls whether their connections at the target company are notified. The default is: no notification (protecting job search privacy, especially for currently-employed candidates). P2 can enable "notify my colleagues at companies I apply to" in their settings, or enable it on a per-application basis during the application flow.

If P1 gets this notification and writes an endorsement, it appears in the application — same as a requested endorsement. The difference is P1 initiated it unprompted.

This feature is operationally simple but has a large psychological effect: the hiring team now knows that a current employee who worked with the candidate believes in them enough to write something, unprompted, when told their colleague applied.

---

### 6. Relationship context in the application view

This is less a feature and more a display enhancement, but it needs to be designed explicitly.

When a recruiter or hiring manager at Company D reviews P2's application, they are seeing a candidate they know nothing about. The application needs to give them context fast.

The verified work history (employer stints) is already public and should be visible directly in the application view, without requiring the reviewer to navigate to P2's public profile. The reviewer should be able to see at a glance:

- Where P2 has worked (verified company domains)
- How long at each place (years)
- Whether their experience trajectory is relevant (seniority, domain)

This is separate from the endorsements. The stints are factual. The endorsements are evaluative. Both are useful together.

Additionally, for any endorsement on the application, the system should show the relationship context automatically: "P1 and P2 were both verified employees of [domain] from [year] to [year] — a [N-year] overlap." This is not commentary the endorser writes; it is derived from the common stint periods in the database. It tells the recruiter exactly how strong the relationship behind the endorsement is.

---

### 7. Late-stage structured reference facilitation

References currently happen ad-hoc and late. This feature allows the hiring company to request structured references through the platform.

When a hiring manager wants to do a formal reference check on P2:
1. They send P2 a reference request through the platform: "We'd like to speak with 2 people who have managed or closely worked with you."
2. P2 can nominate connections from their verified colleague list. (These are the people they actually worked with — not hand-picked cheerleaders.)
3. The nominated reference (for example, P3) receives a notification and can accept or decline.
4. If P3 accepts, the hiring company can send a structured questionnaire (predefined questions relevant to the role) through the platform, or schedule a call, or both.
5. P3's responses are attached to the application and visible only to the hiring team.

#### Why this is better than the current process

- References are requested from verified colleagues, not self-selected cheerleaders.
- The structured questionnaire is relevant to the specific role, not a generic "would you hire this person again?"
- The process is on-platform and documented — no lost emails, no one "forgot to call back."
- References can be collected earlier in the process (after shortlisting but before final interviews) rather than at the very last step.
- P2 still has full agency — they nominate who to ask, and the nominated person can decline.

One important constraint: the hiring company cannot directly contact P2's connections for references. All reference requests must go through P2, who nominates. This preserves the candidate's control over their own process.

---

## Workflows: narrative descriptions

### Workflow A: "I applied and want to add colleague context"

*Cast: P2 is a software engineer applying to Company D. P1 is P2's colleague from Company A (overlapping tenure 2019–2023, four years). P3 is P2's colleague from a second past employer, Company B (overlapping tenure 2021–2022). P4 is another colleague from Company A (overlapping tenure 2018–2019, shorter stint).*

P2 applies to a Staff Engineer role at Company D. After submitting the application, P2 sees the option: "Request endorsements from colleagues." P2 selects three connections: P1 (worked together at Company A, 2019–2023), P3 (worked together at Company B, 2021–2022), and P4 (worked together at Company A, 2018–2019).

P2 adds a note: "I'm applying for a platform engineering role. Anything you can say about the distributed systems work we did together would help."

P1 and P3 write endorsements. P4 does not respond — no notification is sent to P2 or Company D about this.

When the recruiter at Company D opens P2's application, they see: verified work history at Company A and Company B, plus two endorsements. P1's endorsement cites a specific incident where P2 redesigned a queuing system under time pressure and reduced latency by 40%. It says "I've worked with maybe 12 senior engineers over my career — P2 is in the top 3." The relationship badge shows: "Verified colleague — Company A, 2019–2023 (4 years)." P3's endorsement is shorter but specific. The recruiter moves P2 to the shortlist without a phone screen.

### Workflow B: "I found a job through my network"

*Cast: P2 is a professional browsing job openings. P1 is P2's former colleague from Company A who now works at Company D.*

P2 opens the Hub dashboard. There is a section: "Opportunities through your network." One item reads: "Company D has 2 open roles — 1 of your colleagues works there." P2 clicks through. The colleague is P1, who P2 worked with at Company A. One of the openings matches P2's profile. P2 applies and is in a stronger position: they can ask P1 to write an endorsement or refer them internally before the application is reviewed.

### Workflow C: "I know someone perfect for this role"

*Cast: P1 is an engineering manager at Company D, currently on the hiring team for a platform engineer role. P2 is P1's former colleague from Company A (overlapping tenure 2020–2023).*

P1 sees the open role in the org portal. There is a button: "Refer a colleague." P1 thinks of P2, who they worked with at Company A for three years and believe would be excellent for this role.

P1 nominates P2 and writes: "I worked with P2 on the core infrastructure team at Company A. They owned the deployment pipeline end to end. This role is doing similar work and I would bring P2 in without hesitation."

P2 receives a notification: "P1 (Company A, 2020–2023) thinks you'd be a great fit for Staff Platform Engineer at Company D. Apply now?" P2 applies. The application arrives in Company D's queue tagged "Referred by P1 (current employee, verified former colleague of applicant)" with P1's statement attached. The recruiter puts P2 at the top of the shortlist.

### Workflow D: "I'm job-hunting quietly"

*Cast: P2 is currently employed at Company A and is quietly job-hunting. P1 is P2's former colleague from Company A who is now a current employee at Company D.*

P2's privacy settings are at the default: no notifications sent to connections at companies P2 applies to.

P2 applies to Company D. P1 is a current Company D employee and a connection of P2. P1 does NOT receive a notification. P2's application is reviewed as a standard application. P2's prior connection to P1 only becomes visible if P2 explicitly requests an endorsement from P1 or nominates P1 as a reference later in the process.

---

## Consent and privacy model

This section captures the explicit decisions that need to be made per feature.

| Scenario | Default | Candidate can change |
|---|---|---|
| Notify connections at target company when you apply | Off | Yes, globally or per-application |
| Show how many connections you have at a company while browsing openings | On (count only) | Not controllable — this is derived from public profile data |
| Show which specific connections you have at a company | Off (count is shown; names require a click) | N/A |
| Allow connections to see your active applications | Off | Yes, globally |
| Make endorsements visible to the hiring team | On (they're attached to the application) | Yes, candidate can delete an endorsement before it's reviewed |
| Allow hiring company to initiate reference requests | On (standard practice) | Candidate chooses who to nominate; nominated persons can decline |

### What the employer cannot do

- See the list of P2's connections.
- Contact P2's connections directly without going through P2.
- Know which connections P2 asked for endorsements who did not respond.
- Know whether P2 has applied to any other companies.
- See P2's application activity on the platform at any point before P2 submits to them.

### The active-stint privacy edge case

If P2 has an active work email stint at their current employer and applies to a competitor, the system must not surface this to the competitor as anything other than normal work history context. The application shows "Current employer: [company domain]" because that is public information on P2's profile — but this is not the same as telling the current employer that P2 is applying elsewhere. No notification is sent to the current employer.

---

## Things this feature explicitly does not do

**Candidate ranking by network size.**  
Sorting or scoring candidates by how many connections endorsed them, or how many connections they have at the company, would disadvantage candidates from underrepresented groups, career changers, and people who are early in their career. This is explicitly excluded.

**AI-generated or template endorsements.**  
Endorsements must be written by the person who endorses. The value is the human judgment and the specific detail only a real colleague can know. A template or AI draft undermines the entire premise.

**Employer browsing the candidate's colleague graph.**  
The employer only sees what the candidate or the candidate's connections choose to provide. The employer cannot explore who the candidate is connected to.

**Mandatory endorsements.**  
Candidates with zero endorsements are not penalized. The application stands on its own. Endorsements are an optional enrichment signal.

**Recruiter outreach through the colleague network without candidate consent.**  
A recruiter cannot contact P1 and ask "tell me about P2." All connection-based signals are mediated through the application and through the candidate's choices.

**Cross-org visibility of application details.**  
P1 (who referred P2 or wrote an endorsement) does not get to track P2's application status or see how the hiring process unfolds. P1's involvement ends when they submit their endorsement or referral.

---

## Open questions

**Q1: What is the endorsement lifecycle?**  
Can an endorsement be edited after it's submitted? What if P2 and P1 have a falling out after the endorsement is written — can P1 revoke it? Or can P2 choose not to include it in a specific application? These need careful design: if either party can remove endorsements at any time without explanation, a missing endorsement becomes itself a signal. Probably the cleanest model is: P2 can remove an endorsement from their application at any time (it is their application), but P1 cannot silently retract. If P1 wants to retract, they contact P2 directly.

**Q2: Endorsements across applications.**  
If P1 writes an endorsement for P2 for one application, and P2 applies somewhere else, can that endorsement be reused? Or is each endorsement always application-specific? There's an argument for both. Application-specific endorsements are higher quality. But a standing profile endorsement (feature 2, "unsolicited endorsement") could naturally be reused. The two types should be clearly distinct in the data model and the UI.

**Q3: The discovery-of-connections-at-company performance question.**  
Showing "N of your colleagues work here" on every opening in a list view requires an efficient join between the viewing user's connections and the opening org's active user stints. This can be expensive at scale. The feature is desirable but the display may need to be lazy-loaded or limited to the opening detail view rather than the list view.

**Q4: What happens to endorsements when a connection is severed?**  
If P1 and P2 disconnect on the platform (one disconnects from the other), do existing endorsements P1 wrote for P2's applications remain visible to employers? The endorsement was written based on a verified relationship that existed and was real. The subsequent disconnection doesn't retroactively make the work history untrue. Probably endorsements should survive a disconnection, but this needs a decision.

**Q5: Referral credit and incentives.**  
If Company D has an employee referral bonus program and P1 refers P2 who gets hired, does the platform need to facilitate the bonus tracking? This is likely out of scope for Vetchium (the financial transaction is the employer's internal process), but the data that P1 made a referral that resulted in a hire could be surfaced to the company for that purpose.

**Q6: Connection depth in endorsements.**  
The current stint model shows domain and years but not the team or proximity of work. P1 and P2 might both have worked at a 5000-person company for overlapping years but in completely different departments and never interacted. The stint overlap proves they were at the same company at the same time — it does not prove they worked closely together. Should endorsers self-declare how closely they worked with the candidate? Something like "Team/immediate colleague" vs. "Same company, different team" vs. "Worked together on specific projects"? This context would help recruiters calibrate the endorsement's weight. Worth considering, but adds friction to the endorsement flow.

---

## Summary of new user stories by persona

### Hub user as candidate (P2)
- I want to see, when browsing openings, how many of my verified colleagues work at each company.
- I want to request specific colleagues to write endorsements for a specific job application.
- I want to control whether my connections at the company I'm applying to know I'm applying.
- I want to see which endorsements are attached to each of my applications.
- I want to receive a notification when a colleague thinks I'd be a good fit for a role and nominates me.
- I want to nominate verified colleagues as references in a structured way, without having to manage the process by email.

### Hub user as colleague (P1)
- I want to be notified when a former colleague asks me to endorse them for a specific role.
- I want to write a targeted endorsement that tells the hiring team what we actually worked on together.
- I want to be able to nominate a former colleague for a role at my current company, directly from the org portal.
- I want to optionally receive a notification when a former colleague applies to my company (if the candidate opts in).

### Org user as recruiter or hiring manager
- I want to see, in each application, whether any colleague endorsements are attached, with the relationship context.
- I want to see whether a current employee referred this candidate or whether the candidate was referred by someone who worked with them directly.
- I want to send a structured reference request to a candidate late in the process and receive responses in-platform.
- I want to see the candidate's verified work history as part of the application, without navigating to their public profile.

### Org user as current employee (referrer)
- I want to nominate former colleagues for open roles at my company.
- I want to write a referral statement that is visible throughout the hiring process.
- I want to know whether my referred colleague chose to apply.
