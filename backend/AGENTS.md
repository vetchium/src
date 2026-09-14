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
- [`../agent-guides/hub-subscriptions.md`](../agent-guides/hub-subscriptions.md)
  — Hub plans, subscriptions, billing periods, plan enforcement, or payments.

[`internal/db/AGENTS.md`](internal/db/AGENTS.md) always applies inside
`backend/internal/db/`.
