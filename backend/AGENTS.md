# backend/

Applies to the whole `backend/` tree. Read before changing anything here:

- [`../agent-guides/backend.md`](../agent-guides/backend.md) — architecture,
  handlers, logging, security, tests.
- [`../agent-guides/go.md`](../agent-guides/go.md) — every hand-maintained Go
  file. Generated sqlc files are excluded.
- [`../agent-guides/database.md`](../agent-guides/database.md) — anything that
  reads or writes PostgreSQL, changes queries or transactions, or affects sqlc.
- [`../agent-guides/hub-signup.md`](../agent-guides/hub-signup.md) — Hub signup,
  region discovery, locality, federation, or principal migration.
- [`../agent-guides/federation.md`](../agent-guides/federation.md) — global
  identity, mesh calls, remote reads or writes, outbox/inbox, or migration.
- [`../agent-guides/object-storage.md`](../agent-guides/object-storage.md) — S3,
  SeaweedFS, uploads, signed media, or blob lifecycle.
- [`../agent-guides/hub-profile.md`](../agent-guides/hub-profile.md) — Hub
  profiles, professional-email evidence, professional claims, aliases, or
  pictures.
- [`../agent-guides/hub-subscriptions.md`](../agent-guides/hub-subscriptions.md)
  — Hub plans, subscriptions, billing periods, plan enforcement, or payments.
- [`../agent-guides/orgs.md`](../agent-guides/orgs.md) — Org signup, Org user
  authentication, or domain verification and re-verification.

[`internal/db/AGENTS.md`](internal/db/AGENTS.md) always applies inside
`backend/internal/db/`.
