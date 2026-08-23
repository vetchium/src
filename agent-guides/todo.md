# Hub Signup Follow-up Work

The Admin portal domain allowlist is the first part of Hub self-signup. It
stores tenant-local exact domains, supports active and disabled states, and
keeps disabled entries instead of deleting them. The following work is not part
of that Admin feature.

## Signup policy

- Define tenant-local signup settings, including whether self-signup is open
  and which verification methods are enabled.
- Treat the domain allowlist as an eligibility check for new signups only.
  Disabling a domain must not disable existing Hub users.
- Recheck that the domain is active when signup is completed. A domain may be
  disabled after a user starts the flow.
- Keep policy decisions on the server. The Hub UI must not be the enforcement
  boundary.
- Return generic public errors where detailed errors could reveal tenant
  policy or account existence.

## Hub API and UI

- Add Hub API contracts and handlers to start signup, verify email ownership,
  and complete account creation.
- Parse and normalize the email domain once, then compare it with the exact
  canonical domains stored by the Admin feature.
- Make completion atomic so an account cannot be partly created.
- Make retryable signup operations idempotent.
- Add the Hub signup pages, accessible validation, localized text, and clear
  recovery paths for expired or already-used verification links.
- Keep sign-in tenant-bound. An account created in one tenant must not become a
  credential in another tenant.

## Abuse and uniqueness controls

- Verify ownership of every signup email before activating the account.
- Enforce tenant-local email uniqueness with a database constraint and a
  race-safe account creation path.
- Add rate limits for signup initiation, verification attempts, source
  addresses, and repeated email targets.
- Decide whether a low-cost CAPTCHA or proof-of-work challenge is needed after
  measuring abuse. Do not claim that a corporate domain proves a unique human.
- Record security events and useful abuse signals without storing unnecessary
  personal data.

## Verification methods

- Design a verification-provider interface before adding country-specific
  identity checks.
- Configure providers per tenant. A provider enabled for one country or tenant
  must not appear or run in another tenant.
- Define consent, retention, redaction, audit, and deletion rules before
  collecting government identity data.
- Keep provider evidence separate from public profiles and ordinary product
  analytics.

## Operations and tests

- Add metrics for signup starts, verification delivery, completion, rejection,
  throttling, and provider failure without exposing email addresses in labels.
- Cover domain changes during an in-progress signup, concurrent signup for the
  same email, expired tokens, replay, rate limiting, and tenant isolation.
- Add deployment and rollback notes before enabling self-signup for a tenant.
- Roll out behind tenant configuration and monitor one tenant before broader
  enablement.
