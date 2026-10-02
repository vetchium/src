# Vetchium

Professional networking and jobs platform. Each region (tenant) — `sgp`,
`usa1`, `deu`, `ind1`, more possible — runs an isolated stack: PostgreSQL,
SeaweedFS, APIs, workers, and the Admin portal. The Hub and Orgs portals are one
global static site each; the user picks the region at sign-in.

## Components

Backend: one Go module, `backend/cmd/<name>`, shared code in `backend/internal/`.

- `admin-api`, `hub-api`, `orgs-api`: stateless browser APIs. Traefik routes
  `<region>.api.vetchium.com` `/api/hub/` and `/api/orgs/` (CORS for one global
  portal origin each) and the Admin host's `/api`.
- `mesh-api`: tenant-to-tenant API on the private mesh; no public port.
- `mcp-server`: MCP over Streamable HTTP; not public yet.
- `workers`: background jobs; one replica per tenant.
- `global-coordinator`: singleton global directory (principal routing, unique
  handles, aliases, account-email claims). Mesh-internal; holds no credentials
  or tenant business data.
- `dev-seed`: development fixtures created through portal APIs; never deployed.

Tenant processes read `/etc/vetchium/config.json` (`config/`, `config/ci/`,
`deploy/<region>/config.json`); the coordinator reads
`/etc/vetchium/global-coordinator.json`. Passwords are separate secret files.

Frontend:

- `admin-ui`: per-tenant Admin portal, same origin as its `admin-api`.
- `hub-ui`: global Hub portal (`vetchium.com`) for individuals.
- `orgs-ui`: global Orgs portal (`orgs.vetchium.com`) for organizations.
- `portal-ui`: shared React package used by all three; not a portal.

Contracts: `typespec/` (TypeSpec with hand-written Go and TypeScript
companions). Tests: `playwright/`.

## Guides

Read every guide that applies before changing files.

| Guide | Applies to |
| --- | --- |
| [`change-design.md`](agent-guides/change-design.md) | every change, before implementing |
| [`review.md`](agent-guides/review.md) | every change, before calling it done |
| [`verification.md`](agent-guides/verification.md) | which commands to run |
| [`glossary.md`](agent-guides/glossary.md) | product terms |
| [`go.md`](agent-guides/go.md) | hand-written Go |
| [`typescript.md`](agent-guides/typescript.md) | hand-written TypeScript |
| [`typespec.md`](agent-guides/typespec.md) | contracts and wire types |
| [`backend.md`](agent-guides/backend.md) | API servers, workers, ingress |
| [`database.md`](agent-guides/database.md) | PostgreSQL, queries, sqlc, transactions, seeds |
| [`authorization.md`](agent-guides/authorization.md) | permissions and their screens |
| [`ui.md`](agent-guides/ui.md) | portals, `portal-ui`, global portals and regions |
| [`playwright.md`](agent-guides/playwright.md) | API and UI tests |
| [`federation.md`](agent-guides/federation.md) | global directory, mesh trust, cross-tenant commands |
| [`mesh-topology.md`](agent-guides/mesh-topology.md) | mesh and coordinator deployment, certificates, networks |
| [`object-storage.md`](agent-guides/object-storage.md) | SeaweedFS, blobs, signed media |
| [`hub-signup.md`](agent-guides/hub-signup.md) | Hub signup, region selection, account email |
| [`hub-profile.md`](agent-guides/hub-profile.md) | Hub profiles, evidence, aliases, pictures |
| [`hub-subscriptions.md`](agent-guides/hub-subscriptions.md) | Hub plans, subscriptions, payments |
| [`orgs.md`](agent-guides/orgs.md) | Org signup, sign-in, domain verification |
| [`org-subscriptions.md`](agent-guides/org-subscriptions.md) | Org plans, billing, seats, user management, logo, Google sign-in |

Guides compose: a handler using PostgreSQL needs `go.md`, `backend.md`, and
`database.md`. A scoped `AGENTS.md` lists the baseline guides for its tree; the
nearest one wins on conflict, and a specific guide wins over a general one.

## Rules

- Never mention AI generation in commits or pull requests: no
  `Co-Authored-By` trailer, no "Generated with" line, no self-attribution.
- `make test` and `make clean` may run without asking; dev containers,
  volumes, secrets, and data are disposable.
- Keep changes focused; preserve unrelated work in the worktree.
- Run `make fmt`; `make test` fails on unformatted files.
- Never hand-edit a generated file when its source and generator exist.
- Comments state non-obvious intent, invariants, or tradeoffs; never restate
  the code.
- Documentation layout:
  - Agent instructions live only in `AGENTS.md` files and `agent-guides/`,
    each rule in one place.
  - `README.md` holds human developer instructions; `deploy/README.md` the
    production runbook.
  - `docs/` holds only `todo.md`, the deferred-work list.
- Write guides tersely: imperative bullets, exact values, a reason only when a
  rule would otherwise be misapplied. No history, plans, or ledgers.
