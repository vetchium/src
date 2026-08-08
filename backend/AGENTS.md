# Backend Scope Router

These routing instructions apply to the complete `backend/` tree.

Read the following shared guides before making changes:

- [`../agent-guides/backend.md`](../agent-guides/backend.md) for backend
  architecture, handlers, logging, security, and testing.
- [`../agent-guides/go.md`](../agent-guides/go.md) for every hand-maintained Go
  file. Generated sqlc files are excluded from hand-maintained style rules.
- [`../agent-guides/database.md`](../agent-guides/database.md) whenever work
  reads or writes PostgreSQL, changes queries or transactions, or affects sqlc.

The narrower [`internal/db/AGENTS.md`](internal/db/AGENTS.md) always applies
inside `backend/internal/db/`.
