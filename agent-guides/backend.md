# Backend

Applies to API servers and workers under `backend/`. Read [`go.md`](go.md) and,
for anything touching PostgreSQL, [`database.md`](database.md).

## Package ownership

- `cmd/<executable>/` holds only that executable's dependency wiring. Shared
  process startup and shutdown live in `internal/service/`; executables call
  `service.Main`.
- `handlers/<portal>/<feature>/` owns HTTP handlers and endpoint orchestration.
  Keep handlers small; move reusable non-HTTP behavior into its owning package.
- `internal/admin/`, `internal/hub/`, `internal/orgs/` own portal-specific
  runtime dependencies and non-HTTP behavior. Add `internal/<portal>/<feature>/`
  only when there is non-HTTP behavior to own; no empty mirror packages.
- A portal-owned package must not import another portal (an architecture test
  enforces this).
- Shared behavior goes in a focused package directly under `internal/`, never a
  catch-all `lib`, `common`, `helpers`, or `utils`. Existing owners:
  `apiserver/` (HTTP response and request logging), `middleware/` (cross-cutting
  request behavior), `handlerauth/` (authentication flows shared by portals),
  `credentials/` (secret primitives), `dbvalue/` (database value conversion and
  identifier creation), `db/queries/` (sqlc sources; `db/sqlc/` is generated),
  `routes/` (composition of feature handlers and middleware).
- Feature packages do not register portal routes or import sibling handlers to
  compose them; `internal/routes/` does.

## Contracts and configuration

- TypeSpec owns public request, response, problem, and domain types. Import them
  from `github.com/vetchium/src/typespec`; never redefine them
  ([`typespec.md`](typespec.md)).
- JSON configuration keys are lower camelCase. Portal server sections are
  `adminAPIServer`, `hubAPIServer`, `orgsAPIServer`; each portal's normal session
  lifetime is `sessionTTL`.
- Containers listen on `apiserver.DefaultListenAddress`; `LISTEN_ADDRESS` may
  override it locally. The listen address stays out of tenant configuration.

## HTTP handlers

- Decode portal JSON bodies with `apiserver.Decode`, which enforces the JSON
  content type, rejects unknown or trailing data, normalizes, and validates. No
  `apiserver.DecodeJSON`, handler-local decoder, or re-normalizing/re-validating
  afterwards.
- No side effects before decoding and validation succeed.
- Respond only through `Runtime.Problem`, `Runtime.AuthenticationProblem`,
  `Runtime.JSON`, or `Runtime.Empty`; never `http.Error` or `w.WriteHeader`.
- Every `401` goes through `Runtime.AuthenticationProblem` with the
  `WWW-Authenticate` challenge; other problems through `Runtime.Problem`. Use
  `handlerauth.AuthenticationFailure` for replayable `401` results and
  `handlerauth.Failure` for other replayable problems.
- `401` for missing, invalid, or expired credentials; `403` when an
  authenticated principal lacks permission. Follow the TypeSpec contract for
  resource and state errors.
- Convert response timestamps to UTC before encoding.
- When a rejected request deliberately commits state (e.g. counting a wrong
  verification code), use `handlerauth.CommittedFailure` inside the idempotent
  transaction; ordinary `handlerauth.Failure` rolls back. Replays reproduce the
  stored problem without repeating the state change. Committed failures are
  non-401 4xx only.
- Handle response-encoding failures, logging them when headers were already
  sent.

## Logging and security

- Structured logs with stable event and attribute names. Expected failures at
  debug or warning; unexpected operational failures at error. Log successful
  changes only when operations need them.
- A `Runtime` helper logs each response exactly once; `apiserver.HealthCheck` is
  the only unlogged response.
- Log stable identifiers, not full request or response bodies. In multiline log
  calls keep each key beside its value, one pair per line.
- Never log passwords, tokens, authentication codes, database secrets, or full
  email addresses.
- Application logs are not audit records; [`database.md`](database.md) owns the
  audit trail.
- Enforce authentication, authorization, tenant ownership, state, and expiry in
  middleware and database predicates. UI checks are supplementary.

## Ingress and deployment

- Source rate limits, request-size limits, and proxy trust belong in Traefik. No
  public rate limits from process-local maps; add application-level ingress
  controls only when the task or contract requires them.
- No speculative infrastructure, security mechanisms, configuration, problems,
  or responses.
- `docker-compose.json` and `docker-compose-ci.json` stay separate files with
  repeated tenant service blocks written out. Apply every topology change to
  both, and mirror tenant and service additions in the root `Tiltfile`, which
  names development services explicitly for labels, links, and tenant subsets.
- Change `deploy/` only when the task includes production deployment.
- MCP is deliberately not public yet. `mcp-server` and tenant Traefik already
  share `*_mcp_access`, so exposing it is a routing/configuration change, not a
  topology change. Before adding a router for `mcp.<tenant-domain>/mcp`, add the
  MCP authorization flow, TLS, request limits, and an explicit allowed-origin
  policy. Never attach `mcp-server` directly to `*_ingress`.

## Tests

- The TypeSpec response union is the handler test matrix: test every declared
  success and error status the application can produce, and document why any
  declared response cannot be produced or tested.
- Cover malformed JSON, validation, authentication, authorization, missing
  resources, conflicts, invalid states, and concurrency outcomes, including
  every branch that selects a response such as `pgx.ErrNoRows`.
- Inject deterministic dependency failures for practical `5xx` coverage.
- Assert status, headers, body shape, and required log attributes.
- A shared test counts only when it names the endpoint and exercises the same
  observable behavior.
- Unit tests do not replace the portal API tests in
  [`playwright.md`](playwright.md).
- Never add test fixtures to production migrations.
