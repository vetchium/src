# Backlog

Deliberately deferred work. Each item names what is not done and what has to be
decided before it is.

## Hub signup

Hub self-signup, email ownership verification, tenant-local uniqueness,
idempotent completion, localized UI, audit events, and tenant isolation are
implemented. The remaining rollout and abuse-control work is tracked here.

### Signup policy

- Define tenant-local signup settings, including whether self-signup is open
  and which verification methods are enabled.

### Abuse and uniqueness controls

- Add rate limits for signup initiation, verification attempts, source
  addresses, and repeated email targets.
- Decide whether a low-cost CAPTCHA or proof-of-work challenge is needed after
  measuring abuse. Do not claim that a corporate domain proves a unique human.
- Add useful abuse signals without storing unnecessary personal data.

### Verification methods

- Design a verification-provider interface before adding country-specific
  identity checks.
- Configure providers per tenant. A provider enabled for one country or tenant
  must not appear or run in another tenant.
- Define consent, retention, redaction, audit, and deletion rules before
  collecting government identity data.
- Keep provider evidence separate from public profiles and ordinary product
  analytics.

### Operations and tests

- Add metrics for signup starts, verification delivery, completion, rejection,
  throttling, and provider failure without exposing email addresses in labels.
- Cover rate limiting once it is implemented.
- Add deployment and rollback notes before enabling self-signup for a tenant.
- Roll out behind tenant configuration and monitor one tenant before broader
  enablement.

## Go line width

- `go.md` asks for lines at or below 80 characters "where practical", and 283
  hand-maintained Go lines exceed it when a tab counts as four columns. Decide
  what the rule means and whether to enforce it. Thirty-two of those lines are
  gofmt-aligned struct tags that cannot be wrapped, so any enforcement needs an
  exemption for them; the rest are deep nesting inside idempotent closures and
  long generic type arguments.
