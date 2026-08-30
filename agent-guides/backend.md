# Backend Guide

This guide applies to API servers and workers under `backend/`. Read `go.md`
for Go rules. Read `database.md` for database work.

## Package ownership

- `cmd/` contains executable-specific dependency wiring.
- Shared process startup and shutdown belong in `internal/service/`.
  Executables call `service.Main`.
- `handlers/<portal>/<feature>/` owns HTTP handlers and endpoint orchestration.
- `internal/admin/`, `internal/hub/`, and `internal/orgs/` own portal-specific
  runtime dependencies and non-HTTP behavior.
- Add `internal/<portal>/<feature>/` only when the feature has non-HTTP behavior
  to own. Do not create empty mirror packages.
- Portal-owned packages must not import another portal. The architecture test
  enforces this rule.
- Shared behavior belongs in a focused package directly under `internal/`.
- Do not create catch-all packages named `lib`, `common`, `helpers`, or `utils`.
- `internal/apiserver/` owns HTTP response and request-log behavior.
- `internal/middleware/` owns cross-cutting request behavior.
- `internal/handlerauth/` owns authentication flows shared by portals.
- `internal/credentials/` owns secret and credential primitives.
- `internal/dbvalue/` owns database value conversions and identifier creation.
- `internal/db/queries/` owns sqlc queries. Generated database code belongs in
  `internal/db/sqlc/`.
- `internal/routes/` composes feature handlers and middleware. Feature packages
  do not register portal routes or import sibling handlers for composition.

## Contracts and configuration

- TypeSpec owns public request, response, problem, and domain types.
- Import wire types from `github.com/vetchium/src/typespec`. Do not redefine
  them in the backend.
- Use lower camelCase for JSON configuration keys.
- Name portal server sections `adminAPIServer`, `hubAPIServer`, and
  `orgsAPIServer`.
- Use `sessionTTL` for each portal's normal session lifetime.
- Services listen on `apiserver.DefaultListenAddress` in containers.
- `LISTEN_ADDRESS` may override the address for local development.
- Keep the listen address out of tenant configuration.

## HTTP handlers

- Decode portal JSON bodies with `apiserver.Decode`.
- `Decode` enforces the JSON content type, rejects unknown or trailing data,
  normalizes the request, and validates it.
- Do not call `apiserver.DecodeJSON` or create a handler-local JSON decoder.
- Do not normalize or validate a request again after `Decode` succeeds.
- Perform no side effects before request decoding and validation succeeds.
- Use `Runtime.Problem`, `Runtime.AuthenticationProblem`, `Runtime.JSON`, or
  `Runtime.Empty` for every handler response.
- Do not use `http.Error` or call `w.WriteHeader` from a handler.
- Use `Runtime.AuthenticationProblem` for every `401`. Always provide the
  `WWW-Authenticate` challenge.
- Use `Runtime.Problem` for non-`401` problems.
- Use `handlerauth.AuthenticationFailure` for replayable `401` results. Use
  `handlerauth.Failure` for other replayable problems.
- Return `401` for missing, invalid, or expired credentials.
- Return `403` when an authenticated principal lacks permission.
- Follow the TypeSpec contract for resource and state errors.
- Convert response timestamps to UTC before encoding.
- Handle response-encoding failures. If headers were sent, log the failure.
- Keep handlers small. Move reusable non-HTTP behavior to its owning internal
  package.

## Logging and security

- Use structured logs with stable event and attribute names.
- Log expected failures at debug or warning level. Log unexpected operational
  failures at error level.
- Return through a `Runtime` response helper so each handler response is logged
  once. `apiserver.HealthCheck` is the only unlogged response.
- Application logs are not audit records. Follow `database.md` for durable
  audit events.
- Log successful changes only when they help operations.
- Log stable identifiers instead of full request or response bodies.
- In multiline log calls, keep each key beside its value. Use one pair per line.
- Never log passwords, tokens, authentication codes, database secrets, or full
  email addresses.
- Enforce authentication, authorization, tenant ownership, state, and expiry
  in backend middleware and database predicates. UI checks are supplementary.

## Ingress and deployment

- Put source rate limits, request-size limits, and proxy trust in Traefik by
  default.
- Do not implement public rate limits with process-local maps.
- Add application-level ingress controls only when the task or contract
  requires them.
- Do not add speculative infrastructure, security mechanisms, configuration,
  problems, or responses.
- Keep `docker-compose.json` and `docker-compose-ci.json` separate.
- Apply topology changes to both Compose files.
- Keep repeated tenant service blocks explicit in each Compose file.
- Change `deploy/` only when the task includes production deployment.

## Backend tests

- Use the TypeSpec response union as the handler test matrix.
- Test every declared success and error status that the application can
  produce.
- A shared test counts only when it names the endpoint and exercises the same
  observable behavior.
- Cover malformed JSON, validation, authentication, authorization, missing
  resources, conflicts, invalid states, and concurrency outcomes.
- Cover every handler branch that selects a response, including
  `pgx.ErrNoRows` and concurrent state changes.
- Inject deterministic dependency failures for practical `5xx` coverage.
- Document why any declared response cannot be produced or tested.
- Keep ingress-owned responses such as `429` in the contract. Add integration
  coverage when that middleware exists.
- Assert status, headers, body shape, and required log attributes.
- Backend unit tests do not replace portal API tests from `playwright.md`.
- Do not add test fixtures to production migrations.

## Verification

- Run the Go checks required by `go.md`.
- Run `make test` for the complete repository and portal API suite.
