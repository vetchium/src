# Hiring Flow

---

## Actors

**Org users** are employees of a hiring company. They are assigned roles that determine what actions they can take in the hiring process.

**Hub users** are job-seekers who apply to openings.

---

## Openings

An org user creates an opening to represent a job position. An opening starts in the **Draft** state and must be explicitly activated before candidates can apply.

### States

- **Draft** — Not visible to candidates. No applications accepted.
- **Active** — Candidates can apply.
- **Suspended** — New applications are blocked. The opening is temporarily paused. Existing applications and candidacies continue unaffected.
- **Closed** — Permanently shut. No applications accepted. Cannot be reopened or modified.

### Allowed Transitions

- Draft → Active
- Draft → Closed
- Active → Suspended
- Active → Closed
- Suspended → Active
- Suspended → Closed

An opening can never return to Draft. Closed is final.

### What an Opening Describes

An opening records the job title, number of positions available, job description, recruiter, hiring manager, optional cost center, optional private internal notes, employment type (full-time, part-time, contract, internship, or unspecified), required experience range, minimum education level, optional salary range, optional office locations, optional remote availability (by country or globally), and optional tags for categorisation.

### Hiring Team and Watchers

An opening has an optional hiring team — org users involved in the hiring for that role. Separately, org users can watch an opening to receive notifications about activity on it. An opening supports up to 25 watchers.

---

## Applying

A hub user can apply to an opening that is in the **Active** state. An application includes a cover letter and a resume.

### When a Hub User Cannot Apply

- They already have a live (not yet resolved) application at the same company for any other opening.
- They have ever applied to this exact opening before, regardless of what happened to that application.
- The company has a cool-off period policy and the hub user previously reached the candidacy stage at the same company within that period. The cool-off is measured from when their earlier application was submitted. Companies can disable the cool-off by setting it to zero days.

### Endorsements

When applying, a hub user may ask colleagues to endorse their application. Only hub users who are confirmed colleagues of the applicant can be nominated as endorsers. If any nominated person is not a confirmed colleague, the application is not submitted. Each nominated endorser receives a notification and can either endorse or decline.

### Application Scoring

Each application is automatically scored by AI models. These scores are visible to org users when reviewing applications.

---

## Application States

- **Applied** — Submitted and awaiting employer action.
- **Rejected** — The employer decided not to proceed.
- **Shortlisted** — The employer decided to move forward. A candidacy is created.
- **Withdrawn** — The hub user withdrew the application.
- **Expired** — The application expired. (Defined but automatic expiry is not yet active.)

A hub user can withdraw their application only while it is in the Applied state.

Org users can reject or shortlist an application only while it is in the Applied state.

Org users can assign a colour label (Green, Yellow, or Red) to an application to aid internal triage. This label can only be set or cleared while the application is in the Applied state.

### Notifications

- When an application is rejected, the hub user is notified.
- When an application is shortlisted, the hub user is notified and receives a link to their candidacy.

---

## Candidacies

When an application is shortlisted, a candidacy is created. The candidacy is the active record of the hiring process for that individual applicant against that specific opening.

### Candidacy States

- **Interviewing** — The candidacy is active. Interviews can be scheduled.
- **Offered** — An offer has been extended to the candidate.
- **Offer Accepted** — The candidate accepted the offer.
- **Offer Declined** — The candidate declined the offer.
- **Candidate Unsuitable** — The employer concluded the candidate is not a fit.
- **Candidate Not Responding** — The candidate has become unresponsive.
- **Employer Defunct** — The employer has ceased operations.

The only transition with an implemented action is **Interviewing → Offered**. All other terminal states exist as defined outcomes but have no corresponding action yet.

### Comments

Both org users and hub users can leave comments on a candidacy. Comments from both sides are visible in the same thread. Comments cannot be added once the candidacy has reached a terminal state.

Certain events automatically generate system comments on the candidacy: when an interview is scheduled, and when an offer is extended.

---

## Interviews

Zero or more interviews can be scheduled against a candidacy that is in the Interviewing state.

### Interview States

- **Scheduled** — The interview is upcoming.
- **Completed** — The interview has concluded and feedback has been recorded.
- **Cancelled** — The interview was cancelled.

### Interview Types

An interview can be: in-person, video call, take-home, or other.

### Interviewers

Each interview can have up to 5 interviewers. Interviewers must be active org users of the hiring company. Only active org users can be added; deactivated org users cannot participate.

Interviewers can be added to or removed from an interview after it is created, as long as it has not yet been completed or cancelled. When added or removed, interviewers receive a notification.

### RSVP

The candidate and each interviewer independently RSVP to an interview. RSVP can only be set while the interview is Scheduled. The options are Yes or No.

### Feedback and Assessment

After an interview, each interviewer records their assessment. Only org users who are interviewers on that interview can submit feedback — no other role, including administrator roles, can do so.

An assessment records: an overall decision (Strong Yes, Yes, Neutral, No, or Strong No), observations on positives, observations on negatives, an overall assessment, and optional feedback for the candidate.

When an interviewer submits feedback and marks the interview as complete, the interview transitions to Completed.

Feedback can be overwritten by the same interviewer. Each submission replaces the previous one.

### Notifications on Scheduling

When an interview is scheduled:

- The candidate is notified with the interview type, times, description, and interviewer names.
- All interviewers are notified.
- The opening's watchers are notified.

### What Candidates See

Candidates can see the interview's state, type, times, description, their own RSVP, and each interviewer's RSVP status. Candidates do not see interviewer names, contact details, decisions, or written feedback.

---

## Extending an Offer

An org user can extend an offer to a candidate whose candidacy is in the Interviewing state. When this happens:

- The candidacy moves to Offered.
- All interviews that are still Scheduled are automatically Cancelled.
- The candidate receives a notification.
- A system comment is added to the candidacy.

---

## End-to-End Flow Summary

```
Opening: Draft
    │
    └──► Opening: Active
                │
                │  Candidate applies
                ▼
            Application: Applied
                │
                ├───────────────────────────┐
                │ Shortlisted               │ Rejected
                ▼                           ▼
        Application: Shortlisted    Application: Rejected
        Candidacy: Interviewing
                │
                │  (zero or more interviews)
                ├──► Interview: Scheduled
                │         ├── RSVP from candidate and interviewers
                │         └── Feedback submitted → Interview: Completed
                │
                │  Offer extended
                ▼
        Candidacy: Offered
        (all Scheduled interviews → Cancelled)
                │
                ├──► Offer Accepted   (no action implemented yet)
                └──► Offer Declined   (no action implemented yet)

Other terminal candidacy outcomes (no actions implemented yet):
    Candidate Unsuitable
    Candidate Not Responding
    Employer Defunct

Candidate may withdraw while application is in Applied state:
    Application: Withdrawn

Opening can be paused and resumed:
    Active ↔ Suspended
    Either can move to Closed (final)
```
