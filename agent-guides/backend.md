# Backend

Applies to API servers and workers under `backend/`.

## Packages

- `cmd/<name>/` holds only dependency wiring; executables call
  `service.Main` (`internal/service/`).
- `handlers/<portal>/<feature>/` owns HTTP handlers. Keep them small; move
  non-HTTP behavior to its owning package.
- `internal/admin/`, `internal/hub/`, `internal/orgs/` own portal-specific
  non-HTTP behavior. Add `internal/<portal>/<feature>/` only when there is such
  behavior. A portal package never imports another portal (architecture test).
- Shared code goes in a focused package under `internal/`, never `lib`,
  `common`, `helpers`, or `utils`. Existing: `apiserver/` (responses, request
  logging), `middleware/`, `handlerauth/` (auth flows shared by portals),
  `credentials/`, `dbvalue/`, `db/queries/` (sqlc sources; `db/sqlc/` is
  generated), `routes/` (only place that composes handlers and middleware).

## Contracts and configuration

- Import public types from `github.com/vetchium/src/typespec`; never redefine
  them.
- Config keys are lowerCamelCase; portal sections are `adminAPIServer`,
  `hubAPIServer`, `orgsAPIServer`, each with `sessionTTL`.
- Containers listen on `apiserver.DefaultListenAddress`; `LISTEN_ADDRESS`
  overrides it locally and never appears in tenant config.

## Handlers

- Decode with `apiserver.Decode` (content type, unknown and trailing data,
  normalize, validate). No other decoder, and no re-validation afterwards.
- No side effects before decoding and validation succeed.
- Respond only through `Runtime.Problem`, `Runtime.AuthenticationProblem`
  (every `401`, with `WWW-Authenticate`), `Runtime.JSON`, or `Runtime.Empty`;
  never `http.Error` or `w.WriteHeader`.
- Replayable failures: `handlerauth.AuthenticationFailure` (401),
  `handlerauth.Failure` (other problems, rolls back),
  `handlerauth.CommittedFailure` (non-401 4xx that must commit state, such as
  counting a wrong code; replays never repeat the state change).
- `401` for missing, invalid, or expired credentials; `403` for a missing
  permission; everything else as the contract declares.
- Encode timestamps in UTC. Log encoding failures after headers are sent.

## Logging and security

- Structured logs with stable event and attribute names. Expected failures at
  debug or warning, unexpected ones at error.
- `Runtime` logs each response once; only `apiserver.HealthCheck` is unlogged.
- Log identifiers, never bodies, passwords, tokens, codes, secrets, or full
  email addresses. Multiline log calls keep each key beside its value.
- Logs are not audit records ([`database.md`](database.md)).
- Enforce authentication, authorization, tenant ownership, state, and expiry in
  middleware and database predicates; UI checks are extra.

## Ingress

- Rate limits, request-size limits, and proxy trust belong in Traefik, never
  in process-local maps.
- Hub and Orgs APIs are served from each region's own host,
  `<region>.api.<domain>` (`/api/hub/` to `hub-api`, `/api/orgs/` to
  `orgs-api`), never same-origin with the portals or behind a shared proxy or
  the static host's edge — that would put a shared key or DNS credential on a
  VM or a third party in the TLS path. Each API, media, and Admin host resolves
  to one VM, which gets its certificate by ACME HTTP-01.
- CORS is answered by Traefik's headers middleware; Go never answers
  preflights. One origin per prefix (that portal's `publicBaseURL`), `GET` and
  `POST`, headers `Authorization`, `Content-Type`, `Idempotency-Key`, max age
  `86400`, no credentials. A new request header goes into every
  `traefik/<tenant>.json` and `deploy/<tenant>/traefik.json`.
- No global load balancer or nearest-region routing; each account lives in one
  region.
- Expand, then contract: an API addition ships to every region before any
  portal uses it; old behavior goes only after no published portal needs it.
- Problems and emailed links name a region by tenant id, never by URL.
- `docker-compose.json` and `docker-compose-ci.json` stay separate, with tenant
  blocks written out. Change both, and mirror new services in the `Tiltfile`.
- Change `deploy/` only when the task includes production.
- MCP is not public. Before a `mcp.<tenant-domain>/mcp` router: authorization
  flow, TLS, request limits, and an allowed-origin policy. Never attach
  `mcp-server` to `*_ingress`.
- No speculative infrastructure, settings, problems, or responses.

## Tests

- The contract's response union is the test matrix: cover every status the
  handler can produce, and document any that cannot be produced.
- Cover malformed JSON, validation, authentication, authorization, missing
  resources, conflicts, invalid states, concurrency, and every branch that
  picks a response (such as `pgx.ErrNoRows`). Inject failures for `5xx`.
- Assert status, headers, body, and required log attributes. A shared test
  counts only if it names the endpoint.
- Unit tests do not replace Playwright API tests ([`playwright.md`](playwright.md)).
