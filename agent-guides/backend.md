# Backend Guide

This guide applies to API-server and worker implementation under `backend/`.
Use it together with `go.md`. Also read `database.md` for any database access.

## Architecture and ownership

- `cmd/` contains executable entry points. Keep startup, shutdown, and
  dependency wiring there; put reusable behavior in packages.
- `handlers/` owns portal and mesh HTTP handlers.
- `internal/apiserver/` owns shared HTTP response and logging behavior.
- `internal/middleware/` owns cross-cutting request behavior.
- `internal/db/queries/` contains hand-maintained sqlc queries. Generated Go
  database access lives in `internal/db/sqlc/`.
- `typespec/` is a separate contract module. Backend code consumes its exported
  API types through the replacement in `backend/go.mod`.
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
- Log successful state changes only when they are operationally useful. Include
  stable identifiers rather than entire request or response payloads.
- Never log passwords, session tokens, authentication codes, database secrets,
  or full email addresses. Hash, redact, or omit sensitive identifiers when
  correlation is required.
- Treat UI authorization as defense in depth. Authentication, authorization,
  tenant ownership, state, and expiry checks must be enforced by backend
  middleware and database predicates.

## Backend tests and verification

- Cover success and relevant malformed JSON, validation, authentication,
  authorization, missing-resource, conflict, invalid-state, and
  dependency-failure paths.
- Assert status, response headers, body shape, and important structured log
  attributes where those are part of the behavior.
- Do not add test fixtures to production migrations.
- Run `(cd backend && go test ./...)` from the repository root.
