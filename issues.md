# Vetchium — Cleanup, Consistency, and Usability Backlog

Audit date: 2026-08-28. Base commit: `eb671fa` ("fix: harden Hub account
security flows"), branch `main`, clean worktree.

This file lists concrete defects, inconsistencies, and maintainability problems
found in the repository as it stands today. Each item names the exact files
involved, the evidence that it is a problem, and what "fixed" means. Items are
ordered by how much they cost if new features are built on top of them.

Repository conventions that these items are measured against live in
`agent-guides/` (`go.md`, `backend.md`, `database.md`, `typespec.md`,
`typescript.md`, `ui.md`, `playwright.md`, `authorization.md`, `review.md`) and
in the scoped `AGENTS.md` routers. Where an item cites a rule, the rule is
already written down in this repository — these are violations of the project's
own documented conventions, not outside opinions.

---

## Tier 1 — Structural. These get more expensive with every new feature.

### 1.1 The Admin API writes no audit events at all

**Severity: high. This violates an explicit, written project invariant on the
most privileged surface in the system.**

`agent-guides/database.md` (section "Audit trail for every write", lines 69-127)
states:

> Every logical operation that commits an `INSERT`, `UPDATE`, or `DELETE` of
> persistent application data must also append one or more durable audit events.
> This applies regardless of whether the write originates in an admin, hub,
> org, or mesh API, a worker, or another internal process.

and

> Write the audit event in the same database transaction as the state change.

**Current state.** The Hub API complies. The Admin API does not, anywhere.

Files under `backend/internal/db/queries/` that reference `vetchium.audit_events`:

```
hub_auth.sql      (5 references)
hub_totp.sql      (5 references)
hub_email.sql     (4 references)
hub_password.sql  (3 references)
hub_signup.sql    (2 references)
hub_profile.sql   (2 references)
```

Files that do **not** reference it: every `admin_*.sql` file and `admin.sql`
(`admin_authorization.sql`, `admin_credential_lock.sql`,
`admin_housekeeping.sql`, `admin_invitations.sql`, `admin_password.sql`,
`admin_profile.sql`, `admin_totp.sql`, `admin_users.sql`, `admin.sql`) plus
`idempotency.sql`.

Side-by-side evidence. Hub session revocation
(`backend/internal/db/queries/hub_auth.sql:247`):

```sql
-- name: DeleteHubSessionByTokenHash :exec
WITH deleted AS (
    DELETE FROM vetchium.hub_sessions
    WHERE session_token_hash = sqlc.arg(session_token_hash)
    RETURNING hub_session_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.revoked',
        ...
```

Admin session revocation (`backend/internal/db/queries/admin.sql:193`):

```sql
-- name: DeleteAdminSessionByTokenHash :execrows
DELETE FROM vetchium.admin_sessions
WHERE session_token_hash = $1;
```

**Scope of the gap.** Approximately 30 mutating admin queries currently commit
state with no audit record. The full list, extracted from
`backend/internal/db/queries/admin*.sql`:

```
SetAdminPermissions                     CreateAdminTOTPEnrollment
PruneExpiredAdminSessions               GetAdminTOTPEnrollment
PruneAdminLoginChallenges               ConfirmAdminTOTPEnrollment
PruneAdminTOTPEnrollments               CompleteAdminRecoveryCodeLogin
PruneAdminPasswordResets                DisableAdminTOTP
PruneAdminInvitations                   RegenerateAdminTOTPRecoveryCodes
PruneConsumedAdminTOTPRecoveryCodes     DisableAdminUser
PruneAdminEmailOutbox                   EnableAdminUser
CreateAdminInvitation                   ReauthenticateAdminSession
CompleteAdminSetup                      CreateAdminSession
CreateAdminPasswordReset                CreateAdminLoginChallenge
CompleteAdminPasswordReset              GetAdminLoginChallenge
ChangeAdminPassword                     CompleteAdminTOTPLogin
SetAdminPreferredLanguage               DeleteAdminSession
SetAdminDisplayName                     DeleteAdminSessionByTokenHash
```

The security-relevant subset — `SetAdminPermissions`, `CreateAdminInvitation`,
`DisableAdminUser`, `EnableAdminUser`, `ChangeAdminPassword`,
`DisableAdminTOTP`, `RegenerateAdminTOTPRecoveryCodes`,
`CompleteAdminRecoveryCodeLogin` — is exactly the set where "who did this, to
whom, when" needs to be answerable.

Note that the housekeeping/prune queries are a legitimate design question:
`database.md` allows bulk operations to record "a bounded summary plus a stable
operation identifier" rather than per-entity events. Decide deliberately;
do not skip them by accident.

**Definition of done.**
- Every admin mutating query commits its audit event in the same statement or
  the same transaction, following the pattern already established in
  `hub_auth.sql`, `hub_totp.sql`, and `hub_password.sql`.
- Actor type and actor id distinguish administrators from Hub Users, services,
  and workers, per `database.md`.
- No passwords, TOTP secrets, recovery codes, session tokens, or raw
  authorization headers appear in audit payloads (`database.md` prohibits this
  explicitly).
- Idempotent replays do not double-write audit events (`database.md`).
- Tests assert both halves of the invariant, per `database.md`'s testing rule
  and `agent-guides/review.md:38`. `playwright/api/hub-audit.spec.ts` is the
  existing model for this; an `admin-audit.spec.ts` counterpart is missing.
- Run `make sqlc` after changing queries and commit the regenerated output.

---

### 1.2 `admin-ui` and `hub-ui` are a 37-file copy; `orgs-ui` would be the third

**Severity: high. This has a hard deadline — it must land before `orgs-ui` is
written, not after.**

`orgs-ui/` today contains only `Dockerfile`, `index.html`, and `nginx.conf`.
`agent-guides/ui.md` opens by stating it applies to `admin-ui/`, `hub-ui/`, and
`orgs-ui/` "after they are converted from static placeholders to TypeScript
applications" — so a third portal is planned and will inherit whatever shape
exists when it is written.

**Current duplication.** 37 files exist at the same relative path under both
`admin-ui/src/` and `hub-ui/src/`. Measured with
`diff admin-ui/src/<path> hub-ui/src/<path> | grep -c '^[<>]'`:

| Changed lines | File |
|---|---|
| 0 | `app/PreferencesContext.tsx` |
| 0 | `auth/navigation.ts` |
| 0 | `main.tsx` |
| 1 | `pages/NotFoundPage.tsx` |
| 2 | `app/AppProviders.tsx` |
| 2 | `components/common/ReauthenticationAlert.tsx` |
| 2 | `pages/SecurityPage.tsx` |
| 4 | `app/preferences.ts` |
| 8 | `features/profile/queries.ts` |
| 15 | `components/common/ProtectedRoute.tsx` |
| 18 | `app/PendingOperationContext.tsx` |
| 19 | `i18n/index.ts` |
| 21 | `features/security/RecoveryCodesModal.tsx` |
| 24 | `components/common/RecentAuthenticationRoute.tsx` |
| 25 | `styles.css` |
| 27 | `components/common/AppHeader.tsx` |
| 27 | `components/common/PublicShell.tsx` |
| 36 | `features/security/ChangePasswordCard.tsx` |
| 38 | `api/idempotency.ts` |
| 38 | `components/common/HeaderControls.tsx` |
| 42 | `features/security/RecoveryCodesContext.tsx` |
| 60 | `pages/ReauthenticatePage.tsx` |
| 63 | `app/App.tsx` |
| 67 | `components/common/AppShell.tsx` |
| 78 | `auth/session.ts` |
| 94 | `pages/ForgotPasswordPage.tsx` |
| 102 | `pages/HomePage.tsx` |
| 118 | `pages/LoginPage.tsx` |
| 136 | `auth/AuthContext.tsx` |
| 143 | `pages/TwoFactorPage.tsx` |
| 154 | `pages/ProfilePage.tsx` |
| 171 | `api/client.ts` |
| 221 | `pages/ResetPasswordPage.tsx` |
| 248 | `features/security/TwoFactorCard.tsx` |
| 465 | `i18n/locales/en.ts` |
| 468 | `i18n/locales/ta.ts` |
| 483 | `i18n/locales/de.ts` |

(The three locale files legitimately differ in content; they are listed for
completeness, not as extraction candidates.)

**The drift is already bidirectional**, which is the signal that this is
actively costing correctness and not just lines of code:

- `admin-ui/src/api/problems.ts` and `admin-ui/src/api/validation.ts` exist
  with no `hub-ui` counterpart.
- `hub-ui/src/components/common/APIErrorAlert.tsx` exists with no `admin-ui`
  counterpart.
- `admin-ui/src/styles.css` and `hub-ui/src/styles.css` differ by 25 lines, so
  the two portals' design tokens are diverging.

**Definition of done.**
- A shared workspace package (for example `portal-ui/` or `ui-shared/`) holds
  the portal shell, auth context, session handling, preferences, idempotency,
  API client, error presentation, and the security cards.
- `admin-ui` and `hub-ui` both consume it; neither keeps a private copy.
- The `api/problems.ts` / `api/validation.ts` / `APIErrorAlert.tsx` split is
  resolved into one error-handling approach used by both portals.
- `styles.css` and any design tokens live once.
- `agent-guides/ui.md` documents where shared portal code lives and when a
  portal may keep something private, so `orgs-ui` follows the rule rather than
  copying a third time.
- Both portals still pass `npm run format:check`, `npm run typecheck`, and
  `npm run build` (`make admin-ui-check` / `make hub-ui-check`).

---

### 1.3 Two 2085-line compose files that differ by 26 lines, plus four
### near-identical deploy stacks

**Severity: high. Adding `orgs-api` and `orgs-ui` currently means hand-editing
six large JSON files in lockstep.**

```
docker-compose.json       2085 lines, 55 services, 27 networks
docker-compose-ci.json    2085 lines, 55 services, 27 networks
diff between them:        52 diff-output lines (26 changed lines)
```

The entire difference is:
- `config/<tenant>.json` -> `config/ci/<tenant>.json` for 5 config entries.
- 8 `VETCHIUM_DEFAULT_LANGUAGE` values: `${ADMIN_UI_DEU_DEFAULT_LANGUAGE:-de-DE}`
  in dev vs the literal `de-DE` in CI, and the same for the other three tenants
  and for `HUB_UI_*`.

Inside each file, the four tenants (`sgp`, `usa1`, `deu`, `ind1`) each repeat
the same ~11 service blocks: `admin-api`, `admin-ui`, `hub-api`, `hub-ui`,
`orgs-api`, `orgs-ui`, `mesh-api`, `mcp-server`, `workers`, `db`, `migrate`,
`seed`, `traefik`.

The production side repeats the same shape a third time:

```
deploy/sgp/stack.json     638 lines
deploy/usa1/stack.json    638 lines   (36 diff-output lines vs sgp)
deploy/ind1/stack.json    638 lines
deploy/deu/stack.json     643 lines
deploy/sgp/traefik.json   110 lines
deploy/usa1/traefik.json  110 lines   (24 diff-output lines vs sgp)
deploy/ind1/traefik.json  110 lines
deploy/deu/traefik.json   110 lines
```

`deploy/deu/stack.json` has additionally drifted in *formatting* — its
`configs` array is expanded across six lines where the other three regions have
it on one — because nothing formats JSON in this repository (see item 3.7).

`AGENTS.md` states that tenants are `sgp`, `usa1`, `deu`, `ind1` "and more can
be added in future". Adding a fifth tenant today means copying ~11 service
blocks into two compose files and creating a fourth 638-line stack file by
hand.

**Definition of done.**
- The compose files and the per-region deploy stacks are generated from one
  source of truth (a tenant list plus a service template), the way `sqlc` output
  and the OpenAPI document are already generated in this repo.
- A `make` target regenerates them, and a verification target fails when the
  committed output is stale — mirroring the existing `sqlc-verify` pattern in
  the `Makefile`.
- `AGENTS.md`'s "Do not hand-edit generated artifacts when a source file and
  generator are available" then covers these files.
- Adding a tenant or a service is a one-place change.

---

## Tier 2 — Real drift and rule violations found by comparison

### 2.1 The Hub and Admin TOTP handlers disagree on replay-window expiry

**Severity: medium-high. One of these two is wrong; decide which before a third
portal copies one of them.**

`backend/handlers/admin/totp.go` clamps the idempotency replay window so it can
never outlive the session it belongs to:

```go
replayExpiresAt := now.Add(5 * time.Minute)
if sessionExpiry := now.Add(s.AdminSessionTTL); sessionExpiry.Before(
    replayExpiresAt,
) {
    replayExpiresAt = sessionExpiry
}
```

`backend/handlers/hub/totp.go`, at the structurally identical position, does
not clamp:

```go
now.Add(5*time.Minute),
```

This matters because the CI configuration deliberately runs with very short
session lifetimes — `config/ci/sgp.json` sets `"adminSessionTTL": "30s"` where
`config/sgp.json` sets `"24h"`. A 5-minute replay record for a 30-second
session is exactly the case the admin-side clamp was written to prevent.

Establish which behavior is correct, apply it to both, and add a regression test
in whichever of `backend/handlers/admin/auth_test.go` /
`backend/handlers/hub/auth_test.go` covers the flow.

### 2.2 The Hub and Admin auth handlers are ~90% duplicated and drifting

The two handler packages implement the same flows with the same structure:

```
backend/handlers/admin/    backend/handlers/hub/
  login.go        224        login.go        231
  logout.go        26        logout.go        30
  password.go     180        password.go     191
  totp.go         446        totp.go         473
  credential_lock.go 58      credential_lock.go 56
  idempotency.go   67        idempotency.go   67
  profile.go       74        profile.go      116
```

Substituting `admin`/`hub` tokens and diffing shows `idempotency.go` is
identical except for import ordering, and `credential_lock.go` is identical
except for one comment. Specific drift:

- **`hub/helpers.go` (23 lines) has `decodeAndValidate`; `admin/` has no
  equivalent** and repeats the decode-then-validate boilerplate inline in every
  handler. Compare `backend/handlers/hub/login.go:27-30` against
  `backend/handlers/admin/login.go:28-34` (in `Reauthenticate`, and repeated in
  every other admin handler).
- **`hub/` has `invalidLoginChallengeResult[T]()`; `admin/totp.go` inlines the
  same struct literal**:
  ```go
  return idempotentResult[adminauth.AuthenticatedSessionResponse]{},
      &apiProblem{
          details:         adminproblem.InvalidLoginChallengeError,
          wwwAuthenticate: adminapi.LoginTokenChallenge,
      }, nil
  ```
- **`withAdminCredentialLock` carries the comment explaining the `s.DB == nil`
  branch** ("Handler unit tests use a query stub without a pool. Production
  servers always take the transaction-scoped row-lock path below."). The
  otherwise-identical `withHubCredentialLock` has the same branch with no
  comment, so the next reader has to rediscover why it exists.
- **Import ordering differs** between the two packages for the same import set;
  `agent-guides/go.md` names `backend/handlers/admin/login.go` as *the*
  repository example, so `hub/` is the one out of line.
- **Session TTL modeling differs**: `adminapi.Server` has
  `AdminSessionTTL time.Duration`; `hubapi.Server` has `SessionTTL`,
  `RememberedSessionTTL`, and `SessionDuration(remembered bool)`. Same concept,
  two shapes and two names. `admin_sessions` also has no `remembered` column
  while `hub_sessions` does (`db/migrations/00001_init.sql`).
- **Tenant scoping differs**: `DeleteHubSessionByTokenHash` takes a `tenant_id`
  parameter (used for the audit row); `DeleteAdminSessionByTokenHash` takes only
  the hash. Resolving item 1.1 should make these consistent.

**Definition of done.** Shared credential-lock, idempotency, request-decode, and
problem-construction helpers live once (for example under
`backend/internal/apiserver/` or a new shared handler-support package), both
packages use them, and `orgs-api` can adopt them without a third copy.

### 2.3 Raw SQL embedded in handlers

`agent-guides/database.md:9` states: "Use the sqlc query interface from backend
code instead of embedding ad hoc SQL."

Two handlers violate this:

- `backend/handlers/org/ping.go:16`
- `backend/handlers/hub/ping.go:16`

Both contain:

```go
query := `SELECT gen_random_uuid()::text, clock_timestamp()`
row := s.DB.QueryRow(r.Context(), query)
```

These are the only two `QueryRow`/`Exec` call sites outside generated `sqlc/`
code and tests. Move the query into a `.sql` file under
`backend/internal/db/queries/`, run `make sqlc`, and call the generated method.
The two ping handlers are otherwise byte-identical apart from the string
`"org"`/`"hub"` — consider collapsing them while you are there.

---

## Tier 3 — Consistency and usability. One mechanical sweep.

### 3.1 Go filenames mix three conventions with nothing documenting a choice

`agent-guides/go.md` covers formatting, imports, line width, and implementation
practices, but says nothing about file naming. The result:

Snake case: `backend/handlers/admin/credential_lock.go`,
`backend/handlers/hub/credential_lock.go`,
`backend/internal/workers/deliver_hub_email.go`

Kebab case: `backend/handlers/admin/hub-signup-domains.go`,
`backend/handlers/admin/my-info.go`, `backend/internal/middleware/admin-auth.go`,
`backend/internal/middleware/hub-auth.go`,
`backend/internal/middleware/request-logger.go`,
`backend/internal/routes/*-routes.go`,
`backend/internal/workers/prune-admin-sessions.go`,
`backend/internal/workers/prune-admin-ephemeral-data.go`,
`backend/internal/workers/prune-idempotency.go`,
`typespec/common/security-effects.go`,
`typespec/global-coordinator/global-coordinator.go`,
`typespec/problem/admin/hub-signup-domains.go`

`backend/internal/workers/` contains both styles side by side. So does
`backend/handlers/admin/`. Note also that
`backend/handlers/admin/hub-signup-domains.go` (kebab) is backed by
`backend/internal/db/queries/hub_signup_domains.sql` (snake).

Pick one convention, record it in `agent-guides/go.md`, and rename. Keep
`backend/cmd/<name>/` directories matching their container image names
(`admin-api`, `hub-api`, `orgs-api`, `mesh-api`, `mcp-server`,
`global-coordinator`) regardless of the file-level choice.

### 3.2 `org` versus `orgs`

The same component is named both ways:

```
backend/cmd/orgs-api/          backend/handlers/org/       (package org)
backend/internal/orgsapi/      backend/handlers/org/ping.go -> Portal: "org"
routes.RegisterOrgsRoutes()    route path: GET /api/org/ping
orgs-ui/                       typespec/ has no orgs directory yet
```

`AGENTS.md` consistently uses "orgs-api" and "orgs-ui". Standardize on one
spelling across the package name, handler directory, route path, and the
`Portal` value in the ping response — and do it before the Orgs API is built
out, so the wire path does not have to change later.

### 3.3 Configuration key style mixes kebab-case and camelCase in one file

`backend/internal/appconfig/config.go:100-154`:

```go
TenantID          string  `json:"tenantId"`          // camel
AdminAPIServer    ...     `json:"admin-api-server"`  // kebab
GlobalCoordinator ...     `json:"global-coordinator"`// kebab
HubAPIServer      ...     `json:"hub-api-server"`    // kebab
OrgsAPIServer     ...     `json:"orgs-api-server"`   // kebab
MCPServer         ...     `json:"mcp-server"`        // kebab
// nested:
AdminSessionTTL   string  `json:"adminSessionTTL"`   // camel
PasswordFile      string  `json:"passwordFile"`      // camel
StartTLS          string  `json:"startTLS"`          // camel
```

Also note the naming asymmetry inside the nested blocks: the admin block uses
`adminSessionTTL` while the hub block uses `sessionTTL` for the same concept
(see item 2.2).

Changing these touches `config/*.json`, `config/ci/*.json`, and
`deploy/*/config.json` (12 files). Decide whether the churn is worth it; if
not, at minimum document the intended rule in `agent-guides/backend.md` so new
keys stop being a coin flip.

### 3.4 Tool and dependency version drift across workspaces

| Package | admin-ui | hub-ui | typespec | playwright |
|---|---|---|---|---|
| `@biomejs/biome` | 2.5.8 | 2.5.8 | 2.5.7 | 2.5.7 |
| `@types/node` | 26.2.0 | 26.2.0 | 22.20.1 | 22.20.1 |
| `typescript` | 7.0.2 | 7.0.2 | 7.0.2 | 7.0.2 |
| `packageManager` field | absent | absent | npm@12.0.2 | npm@12.0.2 |

All four run Biome against the same shared `biome.json` at the repo root, whose
`$schema` is pinned to `https://biomejs.dev/schemas/2.5.7/schema.json` — so the
two UIs run a Biome newer than the schema their config declares.

Align the Biome version across all four, align `@types/node`, update the
`$schema` URL to match, and add `packageManager` to both UIs.

### 3.5 `typespec` dependencies are the only unpinned versions in the repo

`typespec/package.json`:

```json
"dependencies": {
  "@typespec/compiler": "latest",
  "@typespec/http": "latest",
  "@typespec/rest": "latest",
  "@typespec/openapi": "latest",
  "@typespec/openapi3": "latest"
}
```

This is inconsistent with pinning discipline everywhere else in the repository:

- `Makefile` pins `sqlc` to `v1.29.0`, `govulncheck` to `v1.7.0`,
  `golangci-lint` to `v2.12.2`, and `sqlfluff` to
  `sqlfluff/sqlfluff:4.2.2@sha256:7e8f4f1b...`.
- `docker-compose.json` pins `postgres:17.6-alpine@sha256:ef257d85...` and
  `axllent/mailpit:v1.31.0@sha256:c96991d9...`.

`agent-guides/database.md:131` even says "The root Makefile pins sqlc to version
`v1.29.0`; do not generate with an[other]" — the project clearly intends
reproducible tooling. `latest` on the compiler that generates the OpenAPI
document means the contract output can change without any commit in this repo.

Pin all five to the versions currently in `typespec/package-lock.json`.

### 3.6 `traefik:v3.4.1` is the only container image not pinned by digest

Five services in each of `docker-compose.json` and `docker-compose-ci.json`
(`edge`, `traefik-sgp`, `traefik-usa1`, `traefik-deu`, `traefik-ind1`) use
`traefik:v3.4.1` with no `@sha256:` digest, while every other image in both
files is digest-pinned. `deploy/*/stack.json` should be checked for the same
issue. Add the digest.

### 3.7 No formatter covers JSON, and JSON has already drifted

`biome.json`'s `files.includes` lists only `**/*.js`, `**/*.mjs`, `**/*.cjs`,
`**/*.ts`, `**/*.mts`, `**/*.cts`, `**/*.tsx`. The repository contains roughly
7,400 lines of hand-maintained JSON that nothing formats or checks:

```
docker-compose.json          2085
docker-compose-ci.json       2085
deploy/*/stack.json          638 x 3 + 643
deploy/*/traefik.json        110 x 4
deploy/global-coordinator/stack.json   69
config/*.json, config/ci/*.json, deploy/*/config.json
```

The observable consequence is `deploy/deu/stack.json`, whose `configs` array is
formatted differently from the identical array in the other three regions:

```json
// deploy/sgp/stack.json:58
"configs": [{"source": "app_config", "target": "/etc/vetchium/config.json"}],

// deploy/deu/stack.json:58
"configs": [
  {
    "source": "app_config",
    "target": "/etc/vetchium/config.json"
  }
],
```

Add JSON to the Biome `includes` (excluding `package-lock.json` and
`tsp-output/`) and run the formatter, or fold this into item 1.3 by generating
the files. Note that item 1.3, if done, makes most of this moot.

### 3.8 The UIs and Playwright import the contracts two different ways

`playwright/package.json` declares `"typespec": "file:../typespec"` and imports
through the `exports` map in `typespec/package.json`.

`admin-ui` and `hub-ui` declare no dependency on `typespec` and instead reach
across the tree with relative paths, for example:

```
admin-ui/src/app/PreferencesContext.tsx:3
  import type { FrontendLocale } from "../../../typespec/common/localization.ts";
admin-ui/src/features/security/RecoveryCodesModal.tsx:3
  import type { TOTPRecoveryCode } from "../../../../typespec/common/authentication.ts";
admin-ui/src/features/security/TwoFactorCard.tsx:26
  import { IncorrectTOTPCodeError } from "../../../../typespec/problem/admin/authentication.ts";
```

`agent-guides/ui.md` says "Import API wire types from `typespec/<path>`", which
reads as the package specifier, not a relative path.

Compounding this: `admin-ui/tsconfig.app.json` and `hub-ui/tsconfig.app.json`
both set `"include": ["src"]`, so these cross-tree files are pulled in only as
followed imports and are compiled under the UI's own compiler options.

Make the UIs consume the `typespec` package the way `playwright` does, and add
whatever `exports` entries are missing.

### 3.9 `typespec/package.json` `exports` is hand-maintained and unverified

The block is 37 entries long and its last three are formatted with leading
commas, indicating manual editing:

```json
    "./problem/global-coordinator/authentication": "./problem/global-coordinator/authentication.ts"
    ,"./problem/hub/authentication": "./problem/hub/authentication.ts"
    ,"./problem/hub/signup": "./problem/hub/signup.ts"
    ,"./problem/hub/totp": "./problem/hub/totp.ts"
```

`typespec/scripts/check-contract-files.mjs` verifies that every `.tsp` file has
matching `.go` and `.ts` siblings, but nothing verifies that `exports` matches
the files on disk. A contract file added without an `exports` entry is invisible
to `playwright` (and to the UIs once item 3.8 is done) with no failing check.

Extend `check-contract-files.mjs` — it already walks the tree — to also assert
`exports` completeness, and reformat the block.

### 3.10 `AGENTS.md` omits `ui.md` and the two portal routers from its lists

`AGENTS.md` (and therefore `CLAUDE.md`, which is a symlink to it) has a "Before
changing files, read every guide that applies" list containing `go.md`,
`backend.md`, `authorization.md`, `database.md`, `typespec.md`,
`typescript.md`, and `playwright.md`. **`ui.md` is missing**, even though the
same file references it twice:

- `AGENTS.md:76` — "adding a permission to the admin portal requires
  `authorization.md`, `typespec.md`, `database.md`, and `ui.md`"
- `AGENTS.md:109` — "Keep shared UI conventions in `agent-guides/ui.md`"

The "Scoped routers make these requirements visible near the code" list names
`backend/AGENTS.md`, `backend/internal/db/AGENTS.md`, `typespec/AGENTS.md`, and
`playwright/AGENTS.md`, but **omits `admin-ui/AGENTS.md` and
`hub-ui/AGENTS.md`**, both of which exist.

`agent-guides/glossary.md` is also mentioned in prose but not in the guide list.

Add the missing entries.

### 3.11 Documentation contradicts configuration

- `hub-ui/README.md` says "Use Node.js 22.22 or newer";
  `hub-ui/package.json` declares `"engines": {"node": ">=22.13.0"}`.
  `admin-ui/README.md` states no Node version at all. Pick one number and state
  it in the same place for both.
- `admin-ui/README.md` lists Ajv in its stack; `hub-ui/README.md` does not —
  correctly, since `hub-ui` never imports it. But `hub-ui/package.json` still
  declares `"ajv": "8.20.0"` as a dependency. The only Ajv import in either
  portal is `admin-ui/src/api/validation.ts:1`. Either remove the unused
  dependency from `hub-ui` or use it; `agent-guides/ui.md` says "Use Ajv when
  runtime validation uses a JSON Schema supplied by the API", so this is
  probably an unused dependency to drop.

### 3.12 Both dev servers proxy `/api` to the same port

`admin-ui/vite.config.ts` and `hub-ui/vite.config.ts` are byte-identical in
their proxy block:

```ts
server: { proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } } }
```

They front different backends (`admin-api` and `hub-api`). Running both dev
servers at once sends one portal's requests to the other portal's API. Both
READMEs document the same `http://localhost:8080` target. Give each portal a
distinct default port, or document the intended workflow explicitly.

### 3.13 Nothing enforces locale key parity

`admin-ui/src/i18n/locales/{en,de,ta}.ts` and
`hub-ui/src/i18n/locales/{en,de,ta}.ts` are currently in sync (291 keyed lines
each in admin-ui, 180 each in hub-ui), so there is no bug today. But
`agent-guides/ui.md` requires that every user-visible string be translated, and
no check would catch a key added to `en.ts` and forgotten in `de.ts`/`ta.ts` —
`npm run typecheck` will not fail if the locale objects are not typed against a
shared key union.

Either type the locale modules against a shared key type so `tsc` enforces it,
or add a parity test to the UI check targets in the `Makefile`.

### 3.14 No `make fmt` target

The `Makefile` has `test-go-static` (which *checks* `gofmt` and fails on drift)
and each npm workspace has `npm run format`, but there is no single target that
*applies* formatting. Formatting a change today means remembering `gofmt`, then
`npm run format` in `admin-ui`, `hub-ui`, `typespec`, and `playwright`
separately. `AGENTS.md` tells agents to "Use the commands documented in every
applicable guide to format" — there is no one command.

Add a `fmt` target that runs `gofmt -w` over `$(GO_MODULES)` and `npm run
format` in each JS workspace.

### 3.15 `make clean` only names one compose file

```make
clean:
	docker compose -f docker-compose.json down --remove-orphans --volumes
```

`make test` brings up `docker-compose-ci.json` (via `test-stack`) but `clean`
never names it. This currently works, because both files live in the same
directory and therefore share a Compose project name, and because their volume
declarations are identical — so the `down` sweeps up CI containers too. That is
an implicit dependency on two 2085-line files staying identical in their
`volumes` sections. Name both files explicitly in `clean`, or resolve it as part
of item 1.3.

### 3.16 Unimplemented surfaces to track deliberately

Not defects, but they are the shape the above items will be judged against:

- `backend/handlers/mesh/sync.go:12` — `// TODO: authenticate the calling
  tenant.` This is the only TODO marker in the hand-written source tree.
- `backend/internal/orgsapi/server.go` and `backend/internal/meshapi/server.go`
  are 8-line stubs with only `TenantID`.
- `backend/handlers/org/` contains only `ping.go`; `typespec/` has no `orgs`
  contract directory.
- `playwright/ui/` has four `admin-*` specs and one `hub-foundation.spec.ts`;
  Hub UI coverage is thin relative to Admin UI.
- `AGENTS.md` describes "a S3 compatible object store" per tenant; no such
  service exists in either compose file.

---

## Suggested order

1. **1.1 Admin audit events** — a written invariant is violated on the most
   privileged surface, and every new admin feature widens the gap.
2. **1.2 Shared portal package** — the only item with a hard deadline: it must
   land before `orgs-ui` is written. Resolving 2.1 and 2.2 folds in naturally.
3. **1.3 Generate compose and deploy stacks** — smallest of the three, and it
   turns adding `orgs-api` into a one-line change. Subsumes 3.6, 3.7, and 3.15.
4. **Tier 2 remainder** (2.3) — a ten-minute fix.
5. **Tier 3 sweep** — mechanical and low-risk once the conventions in 3.1, 3.2,
   and 3.3 are decided. Best done before the codebase triples in size.

## Verification for any of the above

Per `AGENTS.md` and `agent-guides/review.md`, before calling any of this done:

```
make sql-check      # sqlc vet, generated-output freshness, SQLFluff
make test-go        # unit tests, race detector, coverage
make test-go-static # gofmt + go vet
make test-go-lint   # pinned golangci-lint
make test-go-vuln   # govulncheck
make test           # full suite: the above plus UI, contract, and Playwright
```

`make test` and `make clean` may be run without asking; dev containers,
volumes, secrets, and database data are disposable.
