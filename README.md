# Vetchium வெட்சியம்

![Vetchium V composed of multicolor Ixora flowers](V.png)

**Vetchium** draws its name from **வெட்சி** (_Vetchi_) in Tamil tradition:

- [**The Vetchi flower**](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF), identified with [Ixora](https://en.wikipedia.org/wiki/Ixora), a flowering shrub native to Southern India.
- [**வெட்சித் திணை** (_Vetchi thinai_)](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF%E0%AE%A4%E0%AF%8D_%E0%AE%A4%E0%AE%BF%E0%AE%A3%E0%AF%88), **`ஆநிரை கவர்தல் வெட்சி`** a theme in classical Tamil _puram_ poetry in which warriors seize Cattle (Wealth) from a rival land.

## Request paths and networks

```text
Internet/browser
       |
     edge
       |
 tenant Traefik
       |-- portal hostname, /api/* --> matching portal API --> PostgreSQL
       `-- portal hostname, other paths --> portal nginx (static files)

future WireGuard gateway --> private mesh --> mesh-api --> PostgreSQL

optional authenticated MCP route --> mcp-server --> PostgreSQL

workers --> PostgreSQL
```

Traefik is the only publicly exposed ingress.

## MCP exposure

MCP is deliberately not public yet. The service and tenant Traefik already
share `*_mcp_access`, so exposure later is a routing/configuration change, not a
network-topology change. Before adding a router for `mcp.<tenant-domain>/mcp`,
add the MCP authorization flow, TLS, request limits, and an explicit allowed
origin policy. Do not attach `mcp-server` directly to `*_ingress`.

## Development

Clean and bring up the development environment:

```bash
make [dev]
```

[Tilt](https://tilt.dev) is an optional front end for that same
`docker-compose.json` stack. It creates the development secrets through
`make dev-secrets`, keeps every service's log stream separately addressable,
and rebuilds only what a change touched instead of recreating the stack the way
`make dev` does:

```bash
tilt up                     # every tenant, rebuilding on source changes
tilt up -- --tenants sgp    # one tenant (repeat the flag for more)
tilt up -- --manual         # build once, then rebuild only on demand
tilt logs -f hub-api-sgp    # follow one service outside the UI
tilt down                   # stop the stack; volumes and secrets survive
```

Every backend service is built from the same `backend/Dockerfile` and the same
repository-root context, so one backend change invalidates all of them. Use
`--manual`, or a single tenant, when that fan-out costs more than it saves.
`make clean` remains the full teardown.

Clean and bring up the test environment; run the Go, TypeScript, React,
PostgreSQL, sqlc, dependency, and vulnerability checks and tests; then report
the per-module and aggregate Go statement coverage. The final report also
compares the API responses exercised by Playwright with the generated OpenAPI
contract, including operation, 2xx/4xx/5xx status, and RFC problem-type
coverage, followed by the exact remaining gaps. Go tests always run with the
race detector. The test environment is left running afterward for inspection:

```bash
make test
```

## Publishing

```bash
make docker
make publish TAG=v1.2.3
```

Production deployment instructions live in [`deploy/`](deploy/README.md).
