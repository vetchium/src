# Ideas — Potential Future Work

A scratch list of enhancements that are not yet scheduled. Each entry is meant to
be self-contained enough to pick up later.

## Domain verification history

Domains move through PENDING → VERIFIED → FAILING (see the
`domain_verification_status` enum in the regional schema) and re-verification runs
automatically, but only the one-time claim/verify _actions_ are recorded today —
the `org.claim_domain` and `org.verify_domain` entries in the regular audit log.
There is no record of each individual verification attempt and its result.

Add a regional `domain_verification_events` table keyed by org + domain
(`org_id`, `domain`, `event_type`, `message`, `created_at`) and write a row on
every verification attempt, including automated re-checks and each
PENDING/VERIFIED/FAILING transition, so the full history is available for
compliance and debugging. Surface it on the org domains detail view.

## Tag-scoped discovery page

Once Posts ship (the Openings browse already exists), give Hub users a single page
— e.g. `/tags/:tagId` — that aggregates the Openings and Posts carrying a given
tag. The tag infrastructure (tag definitions, icons, and per-resource tagging) is
already in place; this is the consumer-facing view layered on top of it.
