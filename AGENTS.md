# Vetchium Agent Guidance

This file provides repository-wide routing for agent instructions. Read the
nearest scoped `AGENTS.md` before changing files in that part of the tree.

## Scoped guidance

- [`backend/AGENTS.md`](backend/AGENTS.md) applies to the Go API server and
  worker code under `backend/`.
- [`backend/internal/db/AGENTS.md`](backend/internal/db/AGENTS.md) adds narrower
  rules for PostgreSQL access, hand-maintained queries, and generated sqlc code.

The narrower file takes precedence when instructions overlap.

## Repository-wide expectations

- Keep changes focused and preserve unrelated work already present in the
  worktree.
- Use the commands documented in the applicable child file to format,
  regenerate, and test changes.
- Do not hand-edit generated artifacts when a source file and generator are
  available.
- Add UI-specific guidance only when work begins in `admin-ui/`, `hub-ui/`, or
  `orgs-ui/`; those directories are intentionally not covered yet.
