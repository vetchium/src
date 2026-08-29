# Backend Guide

This guide applies to API-server and worker implementation under `backend/`.
Use it together with `go.md`. Also read `database.md` for any database access.

## Architecture and ownership

- `cmd/` contains executable entry points. Keep only the dependency wiring
  that differs between services there. The process lifecycle every service
  shares — the `healthcheck` subcommand, the JSON process logger, signal
  handling, and graceful HTTP shutdown — lives in `internal/service/`, so a
  new executable calls `service.Main` rather than repeating it.
- `handlers/` owns portal and mesh HTTP handlers.
- `internal/apiserver/` owns shared HTTP response and logging behavior.
- `internal/middleware/` owns cross-cutting request behavior.
- `internal/db/queries/` contains hand-maintained sqlc queries. Generated Go
  database access lives in `internal/db/sqlc/`.
- Portal packages own only what is specific to their portal.
  `internal/adminapi/`, `internal/hubapi/`, and `internal/orgsapi/`, together
  with their handler packages under `handlers/`, must never import one
  another. Behavior that more than one portal needs belongs in a
  portal-agnostic package under `internal/`, so a third portal adopts it
  without copying or reaching into a sibling. `internal/credentials/` owns
  secret handling, `internal/dbvalue/` owns pgtype conversions and identifier
  generation, `internal/handlerauth/` owns shared handler support, and
  `internal/apiserver/` owns shared HTTP behavior. Anything a portal package
  still exports must differ by portal, such as the credential domain that
  separates one portal's derived keys from another's. `internal/architecture/`
  enforces this boundary as a test.
- `typespec/` is a separate contract module. Backend code consumes its exported
  API types through the replacement in `backend/go.mod`.
- Use lower camelCase for JSON application-config keys at every nesting level.
  Name portal server sections `adminAPIServer`, `hubAPIServer`, and
  `orgsAPIServer`; use the shared `sessionTTL` key for each portal's ordinary
  session lifetime.
- `service.Main` resolves the HTTP listen address and passes it to `run`.
  Every service listens on `apiserver.DefaultListenAddress` inside its own
  container, so the address stays out of the per-tenant config file, which one
  tenant's services all share. The `LISTEN_ADDRESS` environment
  variable overrides it per process, which is how several APIs run side by side
  on a development host.
- Keep controls in the layer that owns them. Generic public-ingress concerns
  such as source rate limits, request-body size limits, and proxy trust belong
  in Traefik or deployment configuration by default. Do not duplicate them in
  API processes unless the task or an established contract explicitly requires
  application-level enforcement.
- Do not add speculative infrastructure, security mechanisms, configuration,
  problem types, or contract responses. Implement the requested behavior and
  the existing TypeSpec contract. Raise additional hardening as a recommendation
  instead of silently expanding implementation scope.
- Do not use process-local maps for public API rate limiting. They are neither
  shared across replicas nor durable across restarts. If application-specific
  abuse protection is explicitly required, establish its owner and distributed
  state design before implementation.

## Deployment topology

- `docker-compose.json` and `docker-compose-ci.json` are intentionally near
  duplicates. They describe the same topology for two environments and stay
  separate on purpose: each file is readable and diffable on its own, and a
  change to one environment cannot silently alter the other. Do not merge them,
  generate them from a shared template, or report the repetition between them
  as a defect. Apply a topology change to both files.
- Per-tenant service blocks repeat inside each compose file for the same
  reason. Adding a tenant means copying its block for every service.
- `deploy/` holds the production stacks and is maintained separately from this
  guide's scope. Leave it alone unless a task names it.

## API handlers

- Import request, response, problem, and domain types from the `typespec`
  module. Do not define replacement wire structs in handlers.
- Decode every JSON request body in admin, hub, and org portal handlers with
  `apiserver.DecodeJSON`; do not construct an endpoint-local `json.Decoder`.
  The helper enforces the shared `application/json` Content-Type requirement
  and rejects unknown fields, trailing data, and multiple JSON values.
  Request-body size limits are ingress concerns and must not be added to this
  helper.
- Keep handler flow explicit: decode, normalize, validate, call dependencies,
  check state, and encode the typed response. Validate before database calls or
  other side effects.
- Use `internal/apiserver/` helpers and stable problem types for errors. Do not
  introduce endpoint-local error envelopes or use `http.Error` for API
  responses.
- Distinguish authentication from authorization. Missing, invalid, or expired
  credentials are `401`; an authenticated principal lacking permission is
  `403`. Follow the TypeSpec contract for resource and state errors.
- Handle response-encoding failures. If headers were already written, log the
  failure instead of attempting to replace the response.
- Keep handlers small and move reusable behavior to the package that owns it.

## Logging and security

- Use structured logging with stable event and attribute names. Expected,
  handled failures belong at debug or warning level; unexpected operational
  failures belong at error level.
- Structured application logs are operational telemetry, not the durable audit
  trail for database changes. Follow `database.md` for every write, including
  actor and correlation propagation into the transaction that changes state.
- Log successful state changes only when they are operationally useful. Include
  stable identifiers rather than entire request or response payloads.
- Never log passwords, session tokens, authentication codes, database secrets,
  or full email addresses. Hash, redact, or omit sensitive identifiers when
  correlation is required.
- Treat UI authorization as defense in depth. Authentication, authorization,
  tenant ownership, state, and expiry checks must be enforced by backend
  middleware and database predicates.

## Backend tests and verification

- Treat the TypeSpec response union as a mandatory test matrix whenever a
  handler is added or changed. Add or update automated tests in the same
  change for every declared success and error status, including malformed
  JSON, validation, authentication, authorization, missing-resource,
  conflict, invalid-state, and concurrency outcomes. A shared middleware or
  table-driven test may cover a response only when it explicitly includes the
  endpoint and exercises the same externally observable behavior.
- Cover every materially distinct handler-owned branch that maps to a response,
  including `pgx.ErrNoRows` results caused by atomic state predicates or a
  state change between dependent calls. Inject deterministic dependency
  failures for `5xx` paths where practical; if a declared response cannot be
  produced or tested by the implementation and deployed middleware, document
  the concrete reason before considering the handler complete. Keep responses
  owned by planned or deployed shared ingress middleware, such as `429` source
  rate limits, in the contract and add their integration coverage when that
  middleware becomes available in the test topology; do not remove them merely
  because an application handler cannot produce them directly.
- Do not consider a new or changed handler complete when only its happy path is
  tested. Backend unit tests do not replace the portal-level API coverage
  required by `playwright.md`.
- Assert status, response headers, body shape, and important structured log
  attributes where those are part of the behavior.
- Do not add test fixtures to production migrations.
- Run `(cd backend && go test ./...)` from the repository root.
