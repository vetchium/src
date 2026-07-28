# Multi-tenant API Architecture

This repository contains the architecture for a multi-tenant API. 
The components include:
- A `backend` Go application which runs a `portal-api`, `mesh-api`, `mcp-server`, and periodic tasks.
- A set of database migrations run using `pressly/goose` and `psql` containing a common schema and tenant-specific data seeds.
- Static UI portals (`orgs-ui`, `hub-ui`, `admin-ui`).
- A `docker-compose-dev.yml` to bring up the environment with `traefik` entrypoints and PostgreSQL databases for 4 tenants (`sgp`, `usa1`, `deu`, `ind1`).

## Setup

1. Start all containers:
```bash
docker-compose -f docker-compose-dev.yml up --build -d
```
2. The UI portals can be accessed at:
- `http://orgs-ui.<tenant>.localhost:<port>/`
- `http://hub-ui.<tenant>.localhost:<port>/`
- `http://admin-ui.<tenant>.localhost:<port>/`

The tenants are mapped to the following Traefik ports:
- `sgp`: 8001
- `usa1`: 8002
- `deu`: 8003
- `ind1`: 8004

For example, to access the Hub portal for Singapore:
`http://hub-ui.sgp.localhost:8001/`

And its backend API endpoint is accessible at:
`http://hub-ui.sgp.localhost:8001/api/health`

## Development Status

- ✅ Directory structure created
- ✅ Go `backend` application created with `portal-api`, `mesh-api` and `mcp-server`
- ✅ Common migrations created with `pressly/goose`
- ✅ Tenant specific seed data configured
- ✅ UI Dockerfiles added for serving static content
- ✅ Docker-compose file generated
- ⏳ Future: Secure the mesh-api with Wireguard for inter-instance communication (TODO added to code)
