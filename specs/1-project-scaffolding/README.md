Status: IN_PROGRESS
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- A proper README.md file with instructions on how to bring up the backend and frontend systems
- Database migrations are applied
- Backend can connect to the Database
- Frontends can connect to the Backend

## Scope

- Create directories for the `api-server` golang backend, `hub-ui` vite frontend sources
- Create Dockerfiles for containerizing them and a docker-compose file to bring up all the required containers
- Document the steps to bring up the setup in a README.md file on the top-level directory
- One Global Database running
- Three Regional Databases running
- Three replicas of the APIServer running on Three different regions
- Each replica of the APIServer can connect to the global and all the regional databases
- The connection strings for each region should be made available to each replica of the APIServer via its own config values which get mounted as environment variables
- The database queries and migrations should come from [sqlc](https://sqlc.dev/)
- github.com/golang-migrate should be used for migrations in conjunction with sqlc
- A container to route the traffic from the frontends to load-balance across the three replicas of the APIServers
- The backend APIServer can expose a simple / endpoint, which can take a hardcoded SQL response and can return the value. The `hub-ui` application can call this endpoint and render the returned hardcoded value from the backend.

### Database Schema

```dbml
enum global.region {
	ind1
	usa1
	deu1
	sgp1
	// more in future
}

enum global.hub_user_status {
	active
	disabled
	deleted
}

enum global.email_address_hashing_algorithm {
	SHA-256
}

Table global.hub_users {
	hub_user_global_id uuid [primary key, not null]
	handle text [not null, unique, note: 'Globally unique handle']
	email_address_hash bytea [not null, unique]
	hashing_algorithm global.email_address_hashing_algorithm
	status global.hub_user_status [not null]
	preferred_language global.language [not null]
	created_at timestamp [default: `now()`]

	// No PII here. Profile data is in regional tables.
}

Table regional.hub_users {
  hub_user_id uuid [primary key, note: 'Regional ID']
  hub_user_global_id uuid [not null, note: 'Link to global identity']
  email_address text [not null, unique, note: 'Primary login email']
  password_hash bytea [note: 'Only if using email/password']
  created_at timestamp
}

Ref: regional.hub_users.hub_user_global_id > global.hub_users.hub_user_global_id
```
