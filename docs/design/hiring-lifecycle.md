# Hiring Lifecycle

Durable design reference for the hiring flow (openings → applications → candidacies →
interviews → offers). Distilled from the implemented feature spec; the source of truth is the
code (`api-server/handlers/{org,hub}/*.go`, `api-schema/{org,hub}/*`, regional schema) and the
`playwright/tests/api/hiring/*` tests. See [glossary](../glossary.md) for entity definitions and
[ADR-001](../adr/adr-001-multi-region-data-access.md) for cross-region placement.

## Entities & where they live

All hiring data lives in the **opening's home region** (an opening inherits its org's region).
A Hub user homed elsewhere applying to it is the canonical cross-region interaction — the
application, candidacy, interviews, offer and résumé blob all live in the opening's region
(ADR-001 §7: optimise for the org's many reads over the candidate's single write).

## State machines

These enums are authoritative (regional schema `CHECK` constraints / `opening_status` enum +
the `api-schema` unions).

### Opening — `opening_status`

`draft → pending_review → published → paused → (expired | closed) → archived`

- `draft → pending_review`: non-superadmin submit. **Superadmin submit shortcuts straight to
  `published`** (single-person-company accommodation; see CLAUDE.md "Superadmin and Approval Flows").
- Editable **only** in `draft`. After it leaves draft, content is frozen — to change a published
  opening, close it and `duplicate` it into a fresh draft.
- Auto-expires 180 days after `first_published_at` via a regional worker; the clock keeps ticking
  while `paused`. `published`/`paused` can be paused/reopened.

### Application — `applications.state`

`applied → shortlisted | rejected | withdrawn | expired`

- `shortlisted` creates a Candidacy (the `candidacies.application_id` UNIQUE constraint guards a
  race between two recruiters; the loser gets 422).
- `withdrawn` only allowed while `applied` (candidate action).

### Candidacy — `candidacies.state`

`interviewing → offered → offer_accepted | offer_declined | candidate_unsuitable | candidate_not_responding | employer_defunct`

- Created in `interviewing` on shortlist. `offered` set by `extend-offer`.
- **Known gap (deferred):** there is no in-platform accept/decline-offer endpoint yet; the
  `offer_accepted` / `offer_declined` terminal states exist but acceptance is currently out-of-band
  (see [known-issues](../known-issues.md) M2).

### Interview — `interviews.state`

`scheduled → completed | cancelled`

- Candidate RSVPs yes/no while `scheduled`; can change until `completed`/`cancelled`.
- Candidate sees type/times/description and each interviewer's RSVP **state** — never interviewer
  names, decisions, or written feedback.

### Offer

Document-centric: the `offers.offer_letter_s3_key` PDF is the source of truth for terms (no
structured salary fields). Offer lifecycle is tracked via the candidacy state above.

### Supporting sub-flows

- **Endorsement request** — `pending → written | declined | expired`. One request per
  `(application, endorser)`; endorser must be a `connected` connection (else 400 `not_a_connection`).
- **Reference nomination** — `nominated → accepted → submitted | declined | expired`.

## Key invariants

- **One live application per (org, candidate):** cannot apply if another application at the same
  org is `applied`/`shortlisted` or its candidacy is `interviewing`/`offered` → 409
  `live_application_exists`. Cannot apply twice to the exact same opening → 409 `already_applied`.
- **Cool-off:** if a prior application at the org reached candidacy, a per-org cool-off window
  (default 90 days, `0` disables) measured from the prior application's `applied_at` blocks
  re-apply → 422 `cool_off_active` with the earliest re-apply date.
- **Résumé placement:** streamed to the opening's region S3 inside the same tx that creates the
  application row; served via auth-gated `GET` blob routes, never presigned URLs.
- **Endorsement visibility:** the candidate can hide/re-show an endorsement (`hidden_by_candidate`)
  while the application is `applied`; hidden ones are excluded from the org view but not deleted.

## Hiring team (per opening)

Hiring Manager (1, required) · Recruiter (1, required) · Hiring Team Members (0–10, optional) ·
Watchers (0–25, optional, notifications only, no decision rights).
