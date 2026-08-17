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

Bring up the development environment:

```bash
make [dev]
```

Bring up the test environment and run all the tests. Note that if all tests succeed, `make test` will automatically run `make clean` to clean up the environment. If any test fails, it will leave the setup hanging for inspection without cleanup:

```bash
make test
```

## Publishing

```bash
make docker
make publish TAG=v1.2.3
```

Production deployment instructions live in [`deploy/`](deploy/README.md).
