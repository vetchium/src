# Database setup

Database administration is kept separate from application schema migrations.

- `post-install.sql` runs as the database owner after migrations. It creates or
  updates the `vetchium_app` login, applies the runtime access policy to current
  objects, and sets default privileges for objects created by later migrations.
- `../migrations/common/` contains only versioned application tables, indexes,
  constraints, and other schema changes managed by Goose.
- `dev-seeds/` contains idempotent local-development fixtures; it is not part of
  production migration history.

The post-install script is idempotent and is deliberately run after every
migration pass. That makes first-time installation and later reconciliation use
the same path, while role and privilege changes remain outside migration
rollback semantics.
