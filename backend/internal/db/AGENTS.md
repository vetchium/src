# Backend Database Scope Router

These routing instructions apply to the complete `backend/internal/db/` tree,
including `queries/` and `sqlc/`.

Read the following shared guides before making changes:

- [`../../../agent-guides/database.md`](../../../agent-guides/database.md) for
  query, transaction, efficiency, sqlc, and generation conventions.
- [`../../../agent-guides/go.md`](../../../agent-guides/go.md) for
  hand-maintained Go files in this tree.

The Go style guide does not authorize edits to generated files under `sqlc/`.
The generated-code rules in `database.md` take precedence there.
