# Vetchium Agent Guidance Router

`AGENTS.md` files define scope and route agents to shared guidance. The
substantive conventions live once under `agent-guides/`.

Before changing files, read every guide that applies:

- Maintained Go code: [`go.md`](agent-guides/go.md)
- Backend API servers and workers:
  [`backend.md`](agent-guides/backend.md)
- Database access, queries, sqlc, or transactions:
  [`database.md`](agent-guides/database.md)
- TypeSpec contracts and matching wire types:
  [`typespec.md`](agent-guides/typespec.md)

Guides compose. For example, a backend handler that uses PostgreSQL requires
`go.md`, `backend.md`, and `database.md`. A hand-maintained Go wire type under
`typespec/` requires `go.md` and `typespec.md`.

Scoped routers make these requirements visible near the code:

- [`backend/AGENTS.md`](backend/AGENTS.md)
- [`backend/internal/db/AGENTS.md`](backend/internal/db/AGENTS.md)
- [`typespec/AGENTS.md`](typespec/AGENTS.md)

The nearest scoped `AGENTS.md` takes precedence when instructions conflict.
More specific guides take precedence over general guides.

## Repository-wide expectations

- Keep changes focused and preserve unrelated work already present in the
  worktree.
- Use the commands documented in every applicable guide to format, regenerate,
  and test changes.
- Do not hand-edit generated artifacts when a source file and generator are
  available.
- Add shared language or tool conventions to one guide rather than copying them
  into multiple scoped routers.
- Add UI guides and scoped routers when work begins in `admin-ui/`, `hub-ui/`,
  or `orgs-ui/`. UI guidance is intentionally not defined yet.
