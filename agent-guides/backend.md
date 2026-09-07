# Backend

Applies to API servers and workers under `backend/`. Read [`go.md`](go.md) and,
for anything touching PostgreSQL, [`database.md`](database.md).

## Package ownership

- `cmd/<executable>/` holds only that executable's dependency wiring. Shared
  process startup and shutdown live in `internal/service/`; executables call
  `service.Main`.
- `handlers/<portal>/<feature>/` owns HTTP handlers and endpoint
  orchestration. Keep handlers small and move reusable non-HTTP behavior into
  the package that owns it.
- `internal/admin/`, `internal/hub/`, and `internal/orgs/` own portal-specific
  runtime dependencies and non-HTTP behavior. Add
  `internal/<portal>/<feature>/` only when there is non-HTTP behavior to own;
  no empty mirror packages.
- A portal-owned package must not import another portal. An architecture test
  enforces this.
- Shared behavior goes in a focused package directly under `internal/`. Never
  in a catch-all named `lib`, `common`, `helpers`, or `utils`.
- Existing shared owners: `internal/apiserver/` (HTTP response and request
  logging), `internal/middleware/` (cross-cutting request behavior),
  `internal/handlerauth/` (authentication flows shared by portals),
  `internal/credentials/` (secret primitives), `internal/dbvalue/` (database
  value conversion and identifier creation), `internal/db/queries/` (sqlc
  sources; `internal/db/sqlc/` is generated), `internal/routes/` (composition
  of feature handlers and middleware).
- Feature packages do not register portal routes or import sibling handlers to
  compose them. `internal/routes/` does that.

## Contracts and configuration

- TypeSpec owns public request, response, problem, and domain types. Import
  them from `github.com/vetchium/src/typespec`; never redefine them here. See
  [`typespec.md`](typespec.md).
- JSON configuration keys are lower camelCase. Portal server sections are
  `adminAPIServer`, `hubAPIServer`, and `orgsAPIServer`. Each portal's normal
  session lifetime is `sessionTTL`.
- Services listen on `apiserver.DefaultListenAddress` in containers.
  `LISTEN_ADDRESS` may override it locally. The listen address stays out of
  tenant configuration.

## HTTP handlers

- Decode portal JSON bodies with `apiserver.Decode`. It enforces the JSON
  content type, rejects unknown or trailing data, normalizes, and validates.
  Do not call `apiserver.DecodeJSON`, write a handler-local decoder, or
  re-normalize and re-validate after it succeeds.
- No side effects before decoding and validation succeed.
- Respond only through `Runtime.Problem`, `Runtime.AuthenticationProblem`,
  `Runtime.JSON`, or `Runtime.Empty`. Never `http.Error` or `w.WriteHeader`.
- Every `401` goes through `Runtime.AuthenticationProblem` and carries the
  `WWW-Authenticate` challenge; other problems go through `Runtime.Problem`.
  Use `handlerauth.AuthenticationFailure` for replayable `401` results and
  `handlerauth.Failure` for other replayable problems.
- `401` for missing, invalid, or expired credentials; `403` when an
  authenticated principal lacks permission. Follow the TypeSpec contract for
  resource and state errors.
- Convert response timestamps to UTC before encoding.
- Handle response-encoding failures, and log them when headers were already
  sent.

## Logging and security

- Structured logs with stable event and attribute names. Expected failures at
  debug or warning; unexpected operational failures at error. Log successful
  changes only when operations need them.
- Returning through a `Runtime` helper logs each response exactly once.
  `apiserver.HealthCheck` is the only unlogged response.
- Log stable identifiers, not full request or response bodies. In multiline log
  calls keep each key beside its value, one pair per line.
- Never log passwords, tokens, authentication codes, database secrets, or full
  email addresses.
- Application logs are not audit records. [`database.md`](database.md) owns the
  durable audit trail.
- Enforce authentication, authorization, tenant ownership, state, and expiry in
  middleware and database predicates. UI checks are supplementary.

## Ingress and deployment

- Source rate limits, request-size limits, and proxy trust belong in Traefik.
  Do not build public rate limits from process-local maps. Add
  application-level ingress controls only when the task or contract requires
  them.
- Add no speculative infrastructure, security mechanisms, configuration,
  problems, or responses.
- `docker-compose.json` and `docker-compose-ci.json` stay separate files with
  repeated tenant service blocks written out explicitly. Apply every topology
  change to both, and mirror tenant and service additions in the root
  `Tiltfile`, which names development services explicitly for its labels,
  links, and tenant subsets.
- Change `deploy/` only when the task includes production deployment.

## Tests

- The TypeSpec response union is the handler test matrix. Test every declared
  success and error status the application can produce, and document why any
  declared response cannot be produced or tested.
- Cover malformed JSON, validation, authentication, authorization, missing
  resources, conflicts, invalid states, and concurrency outcomes, including
  every branch that selects a response such as `pgx.ErrNoRows`.
- Inject deterministic dependency failures for practical `5xx` coverage.
- Assert status, headers, body shape, and required log attributes.
- A shared test counts only when it names the endpoint and exercises the same
  observable behavior.
- Keep ingress-owned responses such as `429` in the contract and add
  integration coverage once that middleware exists.
- Unit tests do not replace the portal API tests in
  [`playwright.md`](playwright.md).
- Never add test fixtures to production migrations.

## Verification

See [`verification.md`](verification.md).
