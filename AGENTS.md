# Vetchium Agent Guidance Router

Vetchium is a professional social networking and jobs platform.

Vetchium runs one isolated stack per tenant. The current tenants are `sgp`,
`usa1`, `deu`, `ind1` and more can be added in future.

Each tenant has a tenant-local database, a bunch of backend services,
a S3 compatible object store and three frontend portals.

## Backend

The backend is one Go module with seven command directories and seven
independent container images:

- `admin-api`, `hub-api`, and `orgs-api` — stateless, portal-specific browser
  APIs. Traefik routes each portal hostname's `/api` requests to its matching
  API over a dedicated private network.
- `mesh-api` — stateless tenant-to-tenant API. It is attached only to the
  private mesh and tenant backend networks and never publishes a host port.
- `mcp-server` — stateless MCP `2026-07-28` over Streamable HTTP. It has a
  dedicated access network so an authenticated public route can be added
  without placing it on general portal ingress.
- `workers` — periodic background work. Each tenant runs one replica.
- `global-coordinator` — a database-free singleton outside the tenant stacks.
  Tenant APIs call its authenticated HTTP endpoint to allocate globally unique
  short IDs; its durable state volume prevents counter reuse across restarts.

The tenant backend commands share database, configuration, and domain packages
under `backend/internal/`, but build as separate executables under
`backend/cmd/`. Every tenant backend process reads the same per-tenant JSON file from
`/etc/vetchium/config.json`; Docker Compose mounts the development files under
`config/`, and production mounts each region's `deploy/<region>/config.json`.
The database password remains a separate secret file referenced by that JSON.
The global coordinator instead reads its own non-tenant JSON manifest from
`/etc/vetchium/global-coordinator.json`.

## Frontend

- `admin-ui` is the admin portal that talks only to the `admin-api` server of
  the same tenant where it is deployed. It is used by the Administrators of
  the Tenant.
- `hub-ui` is the portal used by Hub Users who are the individual users of the
  platform; who write posts, apply to Openings, connect with other individuals,
  go through the hiring process, etc. This portal talks to the `hub-api` server
  of the same Tenant.
- `orgs-ui` is the portal used by the Organizations that want to be on the
  Vetchium platform. These Organizations create Posts, Job Openings, go through
  the hiring process for Applicants, etc. This portal talks to the `orgs-api`
  server of the same Tenant.
- `portal-ui` is not a portal. It is the workspace package holding the React
  behavior the portals share — the application shell, authentication, session
  storage, preferences, idempotency, error presentation, and the account
  security cards. It is portal-agnostic and talks to no API of its own.

`AGENTS.md` files define scope and route agents to shared guidance. The
substantive conventions live once under `agent-guides/`.

`agent-guides/glossary.md` contains the definitions of some of the terms that
will be used in prompts, specifications, UIs related to the Vetchium platform.

Before changing files, read every guide that applies:

- Product terminology and domain vocabulary:
  [`glossary.md`](agent-guides/glossary.md)
- Maintained Go code: [`go.md`](agent-guides/go.md)
- Backend API servers and workers:
  [`backend.md`](agent-guides/backend.md)
- Permissions, their enforcement, and the screens that present them:
  [`authorization.md`](agent-guides/authorization.md)
- Database access, queries, sqlc, or transactions:
  [`database.md`](agent-guides/database.md)
- TypeSpec contracts and matching wire types:
  [`typespec.md`](agent-guides/typespec.md)
- Hand-maintained TypeScript:
  [`typescript.md`](agent-guides/typescript.md)
- Portal user interfaces: [`ui.md`](agent-guides/ui.md)
- Playwright API and UI tests:
  [`playwright.md`](agent-guides/playwright.md)

Guides compose. For example, a backend handler that uses PostgreSQL requires
`go.md`, `backend.md`, and `database.md`, and adding a permission to the admin
portal requires `authorization.md`, `typespec.md`, `database.md`, and `ui.md`.
A hand-maintained Go wire type under `typespec/` requires `go.md` and
`typespec.md`.

Scoped routers make these requirements visible near the code:

- [`backend/AGENTS.md`](backend/AGENTS.md)
- [`backend/internal/db/AGENTS.md`](backend/internal/db/AGENTS.md)
- [`typespec/AGENTS.md`](typespec/AGENTS.md)
- [`playwright/AGENTS.md`](playwright/AGENTS.md)
- [`admin-ui/AGENTS.md`](admin-ui/AGENTS.md)
- [`hub-ui/AGENTS.md`](hub-ui/AGENTS.md)
- [`portal-ui/AGENTS.md`](portal-ui/AGENTS.md)

The nearest scoped `AGENTS.md` takes precedence when instructions conflict.
More specific guides take precedence over general guides.

## Repository-wide expectations

- Agents may run `make test` and `make clean` without asking for confirmation.
  Development containers, volumes, secrets, coverage output, and database data
  are disposable and may be removed and recreated by these commands.
- Before calling any coding activity done, complete the review gate in
  [`review.md`](agent-guides/review.md).
- Keep changes focused and preserve unrelated work already present in the
  worktree.
- Use the commands documented in every applicable guide to format, regenerate,
  and test changes. `make fmt` applies every formatter the repository owns,
  including the JSON outside the npm workspaces, and `make test` verifies that
  the committed result is already formatted.
- Do not hand-edit generated artifacts when a source file and generator are
  available.
- Keep source comments purposeful. Do not add namesake comments that merely
  restate an identifier, function signature, or adjacent code. Use comments to
  explain non-obvious intent, invariants, tradeoffs, external requirements, or
  reasoning the code cannot express.
- Add shared language or tool conventions to one guide rather than copying them
  into multiple scoped routers.
- Keep shared UI conventions in `agent-guides/ui.md` and scoped routers in
  each implemented portal.
