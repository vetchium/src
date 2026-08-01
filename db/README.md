# Database

This directory contains the database source artifacts used by Vetchium:

- `bootstrap/` contains the one-time initialization files mounted into the
  pinned official PostgreSQL image.
- `migrations/` contains the versioned application schema managed by Goose.
- `dev-seed/` contains only local-development fixtures. Production data is not
  stored in this repository.

For a new, empty PostgreSQL data volume, the official image performs this order:

1. `initdb` creates the PostgreSQL cluster and `POSTGRES_DB`.
2. `bootstrap/entrypoint.sh` reads the application password file and delegates
   to the official PostgreSQL entrypoint.
3. The official entrypoint runs
   `/docker-entrypoint-initdb.d/10-vetchium.sql` as `POSTGRES_USER`.
4. The SQL creates the `vetchium_app` login, creates the `vetchium` schema,
   hardens schema access, and establishes default privileges for objects that
   the migration owner will create there.
5. PostgreSQL completes initialization and becomes ready.
6. The separate migration container runs Goose migrations.

The SQL initialization runs only when the data directory is empty. It does not
run after a restart, after a migration, or during an ordinary deployment.
Changing these files has no effect on an existing database; such a change needs
an explicit upgrade procedure appropriate to that change.

The same rule applies to `APP_POSTGRES_PASSWORD`: changing its secret file does
not alter an existing role password. Credential rotation must update the role
and the mounted runtime secret as one explicit operation.
