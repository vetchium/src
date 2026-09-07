# Vetchium Agent Guidance Router

Vetchium is a professional social networking and jobs platform. It runs one
isolated stack per tenant — today `sgp`, `usa1`, `deu`, and `ind1`, with more
possible. Each tenant has its own database, backend services, and three
portals. A tenant-local S3-compatible object store is planned but not deployed,
so nothing here may assume one exists.

## Backend

One Go module, eight directories under `backend/cmd/`. Seven build published
images; `dev-seed` is development-only, absent from `docker-bake.hcl`, and
never deployed.

- `admin-api`, `hub-api`, `orgs-api` — stateless portal browser APIs. Traefik
  routes each portal hostname's `/api` to its own API over a dedicated private
  network.
- `mesh-api` — stateless tenant-to-tenant API. Attached only to the private
  mesh and tenant backend networks; publishes no host port.
- `mcp-server` — stateless MCP `2026-07-28` over Streamable HTTP, on its own
  access network so an authenticated public route can be added without putting
  it on portal ingress.
- `workers` — periodic background work; one replica per tenant.
- `global-coordinator` — stateless, database-free singleton outside the tenant
  stacks, serving authenticated region discovery over the private mesh. It
  holds no durable state. Hub signup generates handles locally without it, and
  hub and mesh APIs fall back to a bundled region catalog when discovery fails.
- `dev-seed` — local fixtures that must go through a portal API. Table-content
  fixtures stay in `db/db-seed`.

The tenant commands share database, configuration, and domain packages under
`backend/internal/` and build as separate executables. Every tenant process
reads the same per-tenant JSON from `/etc/vetchium/config.json` — Docker
Compose mounts the development files under `config/`, production mounts
`deploy/<region>/config.json` — and the database password stays a separate
secret file referenced by that JSON. The global coordinator instead reads
`/etc/vetchium/global-coordinator.json`.

## Frontend

- `admin-ui` — the admin portal for the tenant's administrators. Talks only to
  its own tenant's `admin-api`.
- `hub-ui` — the portal for Hub Users, the platform's individuals: posts,
  applications, connections, the hiring process. Talks to `hub-api`.
- `orgs-ui` — the portal for Organizations: posts, openings, hiring. Talks to
  `orgs-api`.
- `portal-ui` — not a portal. The workspace package holding React behavior the
  portals share: shell, authentication, session storage, preferences,
  idempotency, error presentation, account security cards. Portal-agnostic,
  with no API of its own.

## Guides

`AGENTS.md` files define scope and route to shared guidance. The substantive
conventions live once under `agent-guides/`. Read every guide that applies
before changing files:

| Guide | Applies to |
| --- | --- |
| [`change-design.md`](agent-guides/change-design.md) | every change, before implementing |
| [`review.md`](agent-guides/review.md) | every change, before calling it done |
| [`verification.md`](agent-guides/verification.md) | which commands to run |
| [`glossary.md`](agent-guides/glossary.md) | product terminology |
| [`go.md`](agent-guides/go.md) | hand-maintained Go |
| [`backend.md`](agent-guides/backend.md) | API servers and workers |
| [`database.md`](agent-guides/database.md) | PostgreSQL, queries, sqlc, transactions |
| [`authorization.md`](agent-guides/authorization.md) | permissions and the screens presenting them |
| [`typespec.md`](agent-guides/typespec.md) | contracts and matching wire types |
| [`typescript.md`](agent-guides/typescript.md) | hand-maintained TypeScript |
| [`ui.md`](agent-guides/ui.md) | portal user interfaces |
| [`playwright.md`](agent-guides/playwright.md) | API and UI tests |

Guides compose. A backend handler using PostgreSQL needs `go.md`, `backend.md`,
and `database.md`. Adding an admin permission needs `authorization.md`,
`typespec.md`, `database.md`, and `ui.md`. A hand-maintained Go wire type under
`typespec/` needs `go.md` and `typespec.md`.

Scoped routers repeat these requirements near the code:
[`backend/`](backend/AGENTS.md),
[`backend/internal/db/`](backend/internal/db/AGENTS.md),
[`typespec/`](typespec/AGENTS.md), [`playwright/`](playwright/AGENTS.md),
[`admin-ui/`](admin-ui/AGENTS.md), [`hub-ui/`](hub-ui/AGENTS.md),
[`portal-ui/`](portal-ui/AGENTS.md).

The nearest scoped `AGENTS.md` wins on conflict, and a more specific guide wins
over a general one.

## Repository-wide expectations

- `make test` and `make clean` may be run without asking. Development
  containers, volumes, secrets, coverage output, and database data are
  disposable.
- Keep changes focused and preserve unrelated work already in the worktree.
- `make fmt` applies every formatter the repository owns, including the JSON
  outside the npm workspaces; `make test` verifies the committed result is
  already formatted.
- Never hand-edit a generated artifact when a source file and generator exist.
- Comments explain non-obvious intent, invariants, tradeoffs, external
  requirements, or reasoning the code cannot express. Never restate an
  identifier, signature, or the adjacent line.
- Put a shared language or tool convention in one guide rather than copying it
  into several routers.

`docs/` holds records rather than rules: [`todo.md`](docs/todo.md) for
deliberately deferred work, and
[`hub-signup-design.md`](docs/hub-signup-design.md) for the signup and
locality design.
