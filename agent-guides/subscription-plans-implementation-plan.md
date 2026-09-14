# Hub subscription plans: implementation plan

Implements [`docs/subscriptions-plans.md`](../docs/subscriptions-plans.md).
That document is the requirement; this plan is how to build it in this
repository. Where the two disagree, the design document wins and this plan is
corrected.

Read before implementing, per [`AGENTS.md`](../AGENTS.md): `change-design.md`,
`review.md`, `verification.md`, `glossary.md`, `go.md`, `backend.md`,
`database.md`, `authorization.md`, `typespec.md`, `typescript.md`, `ui.md`,
and `playwright.md`.

Claims below are labelled where it matters:

- **Requested** — stated in the design document.
- **User direction** — decided by the product owner while this plan was
  reviewed, on 2026-09-12 and 2026-09-13. Record these in the design document
  (§11).
- **Fact** — verified in the repository when this plan was written.
- **Decision** — an inference this plan makes, with its reason, so a reviewer
  can challenge it.

## 1. Scope

In scope, all **requested**:

- Plan vocabulary and ranks in the TypeSpec contract, with Go and TypeScript
  companions, and seeded plan catalog rows.
- Per-tenant offered plans in backend configuration and `hub-ui` runtime
  configuration, across development, CI, and production files.
- One subscription per Hub user, created as `hub-free-tier` in the signup
  transaction.
- A read endpoint and an idempotent set-plan endpoint.
- Upgrade, downgrade, cancellation, clearing a scheduled change, and simulated
  renewal at period end, all audited. The worker applies period end, or a
  user's plan change applies it first (§2.1).
- The plan-requirement check and its `403` problem type, unit-tested and not
  yet declared by any endpoint.
- The Hub plan page, the home page invitation, and a public `/terms` page
  linked from signup, translated for `en-US`, `de-DE`, and `ta`.

Out of scope, **requested** as deferred or undecided:

- payment processors and payment records;
- proration and grace periods;
- tenant migration;
- plan withdrawal behavior;
- the first gated feature and its portal presentation;
- the Org portal's plans.

**Decision:** the admin portal does not display subscriptions. The design does
not ask for it, and doing so would need a new admin permission.

## 2. Settled rules and naming

### 2.1 Product rules settled during review

- **User direction — billing periods.** Each period boundary is computed from
  the day the paid series started (the anchor). A month without that day ends
  the period on its last day. Examples: an anchor of Jan 31 gives Feb 28, then
  Mar 31, then Apr 30. A Feb 29 annual anchor gives Feb 28, and Feb 29 in leap
  years.
- **User direction — production offerings.** `usa1`, `deu`, `sgp`, and `ind1`
  all offer `hub-silver-tier` at launch. `hub-free-tier` is always offered.
- **User direction (2026-09-13) — who applies period end.** Payments are
  simulated, so period end is pure bookkeeping on the user's row. Whichever
  touches a due row first applies it:
  - **The worker** applies it for users who make no request (**requested**:
    "At period end, a worker applies any scheduled change").
  - **Set-plan** applies it inside its own transaction, before deciding the
    user's change. The user's change then always starts from the current
    period, so no request is refused for being late.
  - **`GET my-subscription`** computes the same transition in memory for the
    response and writes nothing, so a lagging worker never shows an ended
    period.
  - The period-end rules exist once, in `billing.Advance` (§6.2), and every
    path above calls it.
  - **Audit.** A transition written by `hub-api` uses actor `system` /
    `subscription-renewal`, source `hub-api`, and the request's idempotency
    key. The design names only the Hub user and the worker as actors; the
    product owner approved this third actor for this case.

### 2.2 Naming

**Fact:** `agent-guides/glossary.md` defines "OID (`_oid`) — a seeded config
id (language, plan, capability, opening tag), byte-identical in every cell",
beside "DID (`_did`)". Schema and wire already use the DID suffix
(`hub_user_did`). **Requested:** the plan IDs "should be considered the plan
OIDs".

**Decision:** plan identifiers use the `_oid` suffix wherever this plan
introduces a name:

| Layer | Names |
| --- | --- |
| Database | `vetchium.hub_plans (hub_plan_oid)`; `hub_users.hub_plan_oid`, `hub_users.scheduled_hub_plan_oid` |
| Wire | `plan_oid`, `scheduled_change.plan_oid`, `required_plan_oid` |
| TypeSpec | `HubPlan` (closed enum), `HubPlanOID` (open scalar) |
| Go contract | `subscriptions.Plan`, `subscriptions.PlanOID` |
| TypeScript contract | `HubPlan`, `HubPlanOID` |

`preferred_language` predates this rule and is not renamed. The configuration
key `hubAPIServer.offeredPlans` and the variables `VETCHIUM_TENANT_ID` and
`VETCHIUM_HUB_PLANS` keep the names the design proposes.

Go packages and aliases:

| Package | Import alias outside itself |
| --- | --- |
| `github.com/vetchium/src/typespec/hub/subscriptions` (contract) | `subscriptionspec` in backend code |
| `github.com/vetchium/src/typespec/problem/hub` | `hubproblem` (**fact:** existing alias) |
| `backend/internal/hub/billing` (domain, §6) | `billing` |
| `backend/handlers/hub/subscriptions` (HTTP) | `hubsubscriptions` in `internal/routes` |

**Decision:** the domain package is `billing`, not `subscriptions`, so two
different packages never share a name in one import block.

## 3. Ownership map

| Owner | Change |
| --- | --- |
| `typespec/hub/subscriptions/` | New: plan vocabulary, ranks, upgrade rule, presence-tracking optional interval, wire types, two operations |
| `typespec/problem/hub/subscriptions.*` | New: plan-not-offered and plan-required problems |
| `typespec/problem/details.*` | `Body` interface so a problem can carry extension members |
| `typespec/package.json`, `typespec/tsconfig.json`, `typespec/hub/hub.tsp`, `typespec/scripts/` | Exports, imports, and an OpenAPI extension test |
| `Makefile` | `typespec-check-ready` runs the extension test after `compile`; `hub-ui-check-ready` runs `npm test` |
| `db/migrations/00001_init.sql` | Plan catalog, enums, subscription columns on `hub_users` (edited in place) |
| `backend/internal/db/queries/` | New `hub_subscriptions.sql`; `CompleteHubSignup` sets the default plan |
| `backend/internal/db/sqlc/` | Regenerated with `make sqlc` |
| `backend/internal/appconfig/` | `hubAPIServer.offeredPlans`, `workers.advanceHubSubscriptionsTimer`, consistency test |
| `backend/internal/apiserver/`, `backend/internal/idempotency/`, `backend/internal/handlerauth/` | Accept `problem.Body`; test updates |
| `backend/internal/hub/server.go`, `backend/cmd/hub-api/main.go` | `OfferedPlans` |
| `backend/internal/hub/billing/` | New: period arithmetic, advance, change decision, events, plan requirement |
| `backend/handlers/hub/subscriptions/` | New handlers and row adapters |
| `backend/internal/routes/hub_routes.go` | Two routes |
| `backend/internal/workers/` | New `advance-hub-subscriptions` job and its row adapter |
| `config/*.json`, `config/ci/*.json`, `deploy/*/config.json` | New keys |
| `docker-compose.json`, `docker-compose-ci.json`, `deploy/*/stack.json` | `hub-ui` environment |
| `hub-ui/runtime-config.sh`, `hub-ui/public/runtime-config.js`, `hub-ui/package.json`, `hub-ui/scripts/`, `hub-ui/README.md` | Tenant ID, offered plans, script test |
| `portal-ui/src/` | Shared runtime-config reader |
| `hub-ui/src/` | API client, subscription feature, plan, home, and terms pages, translations |
| `playwright/lib/`, `playwright/api/`, `playwright/ui/` | New specs, typed client methods, helpers; updates to existing Hub specs |
| `agent-guides/glossary.md`, `agent-guides/typespec.md`, `AGENTS.md`, `docs/subscriptions-plans.md`, `deploy/README.md` | Documentation |

Untouched: `backend/cmd/workers/main.go` (§8), `admin-api`, `orgs-api`,
`mesh-api`, `mcp-server`, `global-coordinator`, `dev-seed`, `db/db-seed`,
`Tiltfile`, `docker-bake.hcl`. **Fact:** no seed creates Hub users, and the
Tiltfile runs `docker-compose.json`, so the portal environment arrives through
that file.

## 4. Contract

### 4.1 Plans: `typespec/hub/subscriptions/plans.{tsp,go,ts}`

TypeSpec, namespace `Vetchium.Hub`:

```tsp
/** Hub plans this contract version defines. */
enum HubPlan {
  FreeTier: "hub-free-tier",
  SilverTier: "hub-silver-tier",
}

/**
 * An extensible plan OID returned to clients. A portal older than its API shows
 * an OID it does not recognize as the raw value.
 *
 * `x-vetchium-plan-ranks` gives each defined plan its unique rank. A higher
 * rank includes everything a lower rank allows.
 */
@format("vetchium-hub-plan-oid")
@TypeSpec.OpenAPI.extension("x-vetchium-known-values", #["hub-free-tier", "hub-silver-tier"])
@TypeSpec.OpenAPI.extension("x-vetchium-plan-ranks", #{ `hub-free-tier`: 1000, `hub-silver-tier`: 2000 })
scalar HubPlanOID extends string;

enum BillingInterval {
  Month: "month",
  Year: "year",
}
```

**Fact:** `AdminPermission` and `AdminPermissionID` in
`typespec/admin/authorization/types.tsp` use the same pattern: a closed enum
plus an open scalar carrying `x-vetchium-*` metadata that TypeSpec cannot
express natively.

Go, package `subscriptions`:

- `type Plan string` (`FreeTier`, `SilverTier`), `type PlanOID string`,
  `type BillingInterval string` (`Month`, `Year`).
- `DefaultPlan = FreeTier`, both the signup plan and the downgrade target.
- `Plans() []Plan` returns a copy in ascending rank order.
- `IsPlan(PlanOID) bool` and `IsBillingInterval(BillingInterval) bool`.
- `Rank(Plan) int`.
- `PlansAtOrAbove(minimum Plan) []Plan` returns a copy.
- `Includes(held PlanOID, required Plan) bool` is false for an unknown `held`.
- `RequiresBillingInterval(Plan) bool` is true except for `FreeTier`.
- `IsUpgrade(fromPlan Plan, fromInterval BillingInterval, toPlan Plan,
  toInterval BillingInterval) bool` is true when `toPlan` ranks higher, or when
  the plan is unchanged and the interval moves from `Month` to `Year`. An empty
  interval stands for the free plan. This is the single statement of the
  upgrade rule, and both the backend and `hub-ui` call it (**requested**: "Go
  and TypeScript compare them the same way").

TypeScript mirrors these:

- vocabulary: `hubPlanValues`, `HubPlan`, `HubPlanOID = string`, `FreeTier`,
  `SilverTier`, `DefaultPlan`, `plans`, `isHubPlan`, `billingIntervalValues`,
  `isBillingInterval`;
- helpers: `planRank`, `plansAtOrAbove`, `planIncludes`,
  `requiresBillingInterval`, `isUpgrade`.

### 4.2 Subscriptions: `typespec/hub/subscriptions/subscriptions.{tsp,go,ts}`

```tsp
model ScheduledPlanChange {
  plan_oid: HubPlanOID;
  /** Absent when the scheduled plan is `hub-free-tier`. */
  billing_interval?: BillingInterval;
}

model HubSubscription {
  plan_oid: HubPlanOID;
  /** Present exactly when the plan is paid. */
  billing_interval?: BillingInterval;
  current_period_start?: utcDateTime;
  current_period_end?: utcDateTime;
  cancel_at_period_end: boolean;
  scheduled_change?: ScheduledPlanChange;
}

model SetSubscriptionPlanRequest {
  plan_oid: HubPlan;
  /** Absent for `hub-free-tier`; required otherwise. Never null. */
  billing_interval?: BillingInterval;
}
```

**Decision:** responses carry the open `HubPlanOID`, and requests carry the
closed `HubPlan`.

- Responses must survive a plan the portal does not know (**requested**:
  shown as its raw ID).
- `authorization.md` keeps request fields open so that an older portal can
  return an unrecognized value instead of silently revoking it. That concern
  does not arise here:
  - a portal sends only a plan the user picked from its own runtime
    configuration, already narrowed to known plans;
  - when the current or scheduled plan is unknown, the portal disables every
    change action (§9.4);
  - not sending a plan revokes nothing, because the subscription keeps it.

**Decision:** `source` stays off the wire. The design's API read lists no
source, and `typespec.md` forbids backend-only fields.

Field rules:

- `cancel_at_period_end` is true exactly when `scheduled_change.plan_oid` is
  `hub-free-tier`.
- Response instants are UTC with at most microsecond precision (§6.1).
- Response optionals in Go are pointers with `omitempty`. They are only ever
  encoded, so explicit `null` cannot arise.

**Optional request field.** **Fact:** `apiserver.Decode` uses `encoding/json`,
which decodes both an absent member and an explicit `null` into a nil pointer.
The existing `LoginRequest.RememberMe *bool` accepts `null` this way. The
contract marks `billing_interval` optional but not nullable, and the design
says it is absent for free. Represent it with a presence-tracking field:

- **Type.** `type OptionalBillingInterval struct { Value BillingInterval;
  Present bool; Null bool }` in the contract package.
- **Decoding.** Its `UnmarshalJSON` sets `Present`, and sets `Null` for the
  literal `null`, then decodes the string into `Value`. **Fact:**
  `encoding/json` calls `UnmarshalJSON` with `null` for a non-pointer field
  implementing `json.Unmarshaler`. `DisallowUnknownFields` still applies to the
  enclosing request.
- **Encoding.** `MarshalJSON` and `IsZero` let the field use `json:",omitzero"`:
  - absent is omitted;
  - `Null` encodes as `null`;
  - a value encodes as its string.

  The idempotency request digest (`json.Marshal`) is then stable. A `null`
  never reaches the digest in practice, because `Validate` rejects it first.
- **Decoding errors.** A non-string, non-null value such as `1` fails decoding,
  so `apiserver.Decode` answers `400 invalid-json`, not `validation-failed`.
- **Validation.** `Validate()` reports:
  - `plan_oid` when it is not a defined `Plan`;
  - `billing_interval` when `Null`;
  - `billing_interval` when present with an undefined value;
  - `billing_interval` when absent for a paid plan, or present for
    `hub-free-tier`.
- `Normalize()` is empty.
- **TypeScript.** `validateSetSubscriptionPlanRequest(value: unknown)`
  applies the same rules to an untrusted object, including `null`.
- **Decision:** `RememberMe` keeps its current behavior. Changing login is out
  of scope.

Operations follow `typespec/hub/users/profile.tsp` and, for idempotency,
`typespec/hub/auth/signup.tsp`:

| Operation | Route | Auth | Responses |
| --- | --- | --- | --- |
| `mySubscription` | `GET /api/hub/my-subscription` | Bearer | `200 HubSubscription` with `Cache-Control: no-store`; `401` Hub authentication required; `500` |
| `setSubscriptionPlan` | `POST /api/hub/set-subscription-plan`; required `@header("Idempotency-Key")`; `@TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)` | Bearer | `200 HubSubscription` with `Cache-Control: no-store`; `400` invalid JSON; `400` validation failed; `401`; `403` plan not offered; `409` idempotency key conflict; `500` |

**Fact:** every operation taking `Idempotency-Key` declares the replay
extension; `completeSignup` uses `86400`. Here `86400` matches the ledger
expiry in §7.2.

**Decision:** set-plan does not require recent authentication.
`authorization.md` reserves step-up for credentials, and a simulated change
moves no money. Revisit this when a processor is integrated.

### 4.3 Problems: `typespec/problem/hub/subscriptions.{tsp,go,ts}`

**`HubPlanNotOfferedError`**

- `403`, type `vetchium-problem-details/hub-plan-not-offered`.
- Title "Hub plan not offered".
- Detail "This tenant does not offer that Hub plan".
- A plain `Details` constant.

**`HubPlanRequiredDetails`**

- `403`, type `vetchium-problem-details/hub-plan-required`.
- Title "Hub plan required".
- Detail "This operation requires a higher Hub plan".
- Extension member `required_plan_oid: HubPlanOID`.
- Modelled like `ValidationFailedDetails` in `typespec/problem/details.tsp`,
  with `alias HubPlanRequiredErrorResponse = Response<403,
  HubPlanRequiredDetails>`. **Requested:** no operation references it yet.
- Go: `type PlanRequiredDetails struct { problem.Details; RequiredPlanOID
  subscriptions.PlanOID \`json:"required_plan_oid"\` }`, plus
  `PlanRequiredError(required subscriptions.Plan) PlanRequiredDetails`.
- TypeScript: `PlanRequiredDetails extends Details`, a `PlanRequiredErrorType`
  constant, and `isPlanRequiredProblem(value: unknown)`.

**Fact:** `typespec/problem/hub` does not import `typespec/hub/subscriptions`
today, and the new contract files import nothing from `problem/hub`, so there
is no import cycle.

### 4.4 Problem bodies

**Fact:** `problem.Details` has fixed members, and `apiserver.Runtime.Problem`
encodes only that struct. Change:

- `typespec/problem/details.go` gains `type Body interface { ProblemDetails()
  Details }` and `func (d Details) ProblemDetails() Details { return d }`.
  Embedding promotes the method, so `PlanRequiredDetails` implements `Body`.
- `apiserver.Runtime.Problem` and `AuthenticationProblem` take a
  `problem.Body`. Status, type, and fields for logging and the status line come
  from `ProblemDetails()`, and the whole body is encoded. Callers that pass a
  `Details` compile unchanged.
- `idempotency.APIProblem.Details` becomes a `problem.Body`, and
  `handlerauth.Failure` and `handlerauth.AuthenticationFailure` take one.
  **Fact:** `backend/internal/handlerauth/idempotency_test.go` reads
  `got.Details.Type` at lines 19 and 38. Change both to
  `got.Details.ProblemDetails().Type`, and grep `backend/` for any other field
  access through `APIProblem.Details`.
- **Fact:** a problem returned from idempotent work rolls back and is never
  stored, so replay behavior is unchanged.
- TypeScript needs no runtime change.
- `agent-guides/typespec.md` gains one rule under "Changing a contract":
  - a problem with extension members is a TypeSpec model listing them;
  - in Go, a struct embedding `problem.Details`;
  - in TypeScript, an interface extending `Details`;
  - it is written through `Runtime.Problem`.

### 4.5 Contract tests

Go, `typespec/hub/subscriptions/plans_test.go` and `subscriptions_test.go`:

- `Plans()` order and copy independence; unique ranks; `PlansAtOrAbove` for
  every plan.
- `Includes` with known, unknown, and empty OIDs.
- `RequiresBillingInterval`.
- `IsUpgrade` for every pair of (plan, interval) combinations.
- `OptionalBillingInterval` decoding:
  - an absent member, `null`, `"month"`, and an unknown string each give the
    expected `Present` and `Null` flags;
  - `1` is a decoding error;
  - encoding round-trips for absent, `null`, and a value.
- Also check that an
  unknown member in the enclosing request is still rejected by
  `apiserver.DecodeJSON`. That last case belongs in a backend test, because
  the contract module has no transport.
- Every `Validate()` rule, alone and in combination.

Go, `typespec/problem/hub/subscriptions_test.go`: `PlanRequiredError` encodes
the base members and `required_plan_oid` at the top level.

TypeScript, in `typespec/hub/contract.test.ts` (**fact:** the `test:ts` glob
covers only `hub/*.test.ts`): the same vocabulary, rank, `isUpgrade`, and
validation tables, including `billing_interval: null`.

**OpenAPI extension test**, `typespec/scripts/openapi-extensions.test.ts`:

- Reads `tsp-output/schema/openapi.json` and finds
  `components.schemas["Hub.HubPlanOID"]`. **Fact:** the emitter namespaces
  schema keys, as in `Admin.AdminPermissionID`, and emits `x-vetchium-*`
  extensions on the schema.
- Asserts that `x-vetchium-known-values` equals `plans`, and that
  `x-vetchium-plan-ranks` equals `planRank` for every plan.
- Runs via a new npm script, `test:openapi` (`node --experimental-strip-types
  --test scripts/openapi-extensions.test.ts`), which the Makefile's
  `typespec-check-ready` runs after `npm run compile`. **Fact:** `compile` is
  that target's last step, and `test:ts` runs before it.
- Add `scripts/**/*.ts` to `include` in `typespec/tsconfig.json` so `npm run
  typecheck` checks it under strict TypeScript. **Fact:** `include` currently
  lists only the contract directories.
- **Decision:** the existing admin permission implications have no such test,
  and adding one is out of scope.

## 5. Database

**Fact:** `db/migrations/00001_init.sql` is the only migration, and recent
commits edit it in place. `database.md` forbids `ALTER TABLE` and data
migrations before production. Edit `00001_init.sql`, extend its `Down` section,
and treat development data as disposable (`make clean`).

### 5.1 Schema

**Requested:** every Hub user has *exactly one* current subscription.

**Decision:** the subscription is stored as columns on `vetchium.hub_users`.
One row per user makes exactly-one true by construction.

- A separate table with a primary key gives at most one per user. Getting at
  least one would need deferred constraint triggers on user insert and on
  subscription delete.
- A reverse foreign key would need `ALTER TABLE`, which the rules forbid.
- Future payment records are separate rows referencing `hub_user_did` either
  way.
- **Fact:** profile queries select explicit columns, so new columns change none
  of them.

Add before `vetchium.hub_users`:

```sql
-- Plan OIDs, identical in every tenant. Ranks live only in the TypeSpec
-- contract so there is one authority for ordering.
CREATE TABLE vetchium.hub_plans (
    hub_plan_oid text PRIMARY KEY
        CHECK (hub_plan_oid ~ '^hub-[a-z0-9]+(-[a-z0-9]+)*$')
);

INSERT INTO vetchium.hub_plans (hub_plan_oid)
VALUES ('hub-free-tier'), ('hub-silver-tier');

CREATE TYPE vetchium.hub_billing_interval AS ENUM ('month', 'year');
CREATE TYPE vetchium.hub_subscription_source AS ENUM ('simulated');
```

Add to `vetchium.hub_users`:

```sql
    hub_plan_oid text NOT NULL REFERENCES vetchium.hub_plans (hub_plan_oid),
    subscription_billing_interval vetchium.hub_billing_interval,
    subscription_anchor_at timestamptz,
    subscription_period_start timestamptz,
    subscription_period_end timestamptz,
    scheduled_hub_plan_oid text REFERENCES vetchium.hub_plans (hub_plan_oid),
    scheduled_billing_interval vetchium.hub_billing_interval,
    subscription_cancels_at_period_end boolean NOT NULL GENERATED ALWAYS AS (
        COALESCE(scheduled_hub_plan_oid = 'hub-free-tier', false)
    ) STORED,
    subscription_source vetchium.hub_subscription_source NOT NULL
        DEFAULT 'simulated',
```

`hub_plan_oid` has no default. The one insert path sets it explicitly (§5.2).

Named constraints:

- `hub_users_free_plan_has_no_period`. Two explicit branches, so a partially
  null row cannot pass as SQL `UNKNOWN`:

  ```sql
  (hub_plan_oid = 'hub-free-tier'
      AND subscription_billing_interval IS NULL
      AND subscription_anchor_at IS NULL
      AND subscription_period_start IS NULL
      AND subscription_period_end IS NULL)
  OR (hub_plan_oid <> 'hub-free-tier'
      AND subscription_billing_interval IS NOT NULL
      AND subscription_anchor_at IS NOT NULL
      AND subscription_period_start IS NOT NULL
      AND subscription_period_end IS NOT NULL)
  ```

  §10.1 test 15 covers it.
- `hub_users_subscription_period_ordered`: `subscription_anchor_at <=
  subscription_period_start AND subscription_period_start <
  subscription_period_end`.
  - On a free row every operand is null, so the expression is `UNKNOWN` and
    the row passes. That is intended; the presence constraint above governs
    free rows.
  - On a paid row the presence constraint makes every operand non-null, so
    the comparison is always determined.
- `hub_users_scheduled_plan_consistent`, with three explicit, null-determined
  branches:

  ```sql
  (scheduled_hub_plan_oid IS NULL
      AND scheduled_billing_interval IS NULL)
  OR (scheduled_hub_plan_oid IS NOT NULL
      AND scheduled_hub_plan_oid = 'hub-free-tier'
      AND scheduled_billing_interval IS NULL
      AND hub_plan_oid <> 'hub-free-tier')
  OR (scheduled_hub_plan_oid IS NOT NULL
      AND scheduled_hub_plan_oid <> 'hub-free-tier'
      AND scheduled_billing_interval IS NOT NULL
      AND hub_plan_oid <> 'hub-free-tier'
      AND (scheduled_hub_plan_oid, scheduled_billing_interval)
          IS DISTINCT FROM (hub_plan_oid, subscription_billing_interval))
  ```

  - The branches are: no schedule; a scheduled cancellation on a paid plan; a
    scheduled paid change on a paid plan that differs from the current plan
    and interval.
  - `hub_plan_oid` is `NOT NULL`, and each branch tests nullability first, so
    no branch can evaluate to `UNKNOWN`.
  - §10.1 test 15 covers it.

Reasons for the finer points:

- **Literals.** The `'hub-free-tier'` literals state the named invariant "the
  default plan has no price and no period" (`authorization.md` permits a
  literal that is the invariant). Queries take plan OIDs as parameters from the
  Go constants.
- **Decision: no rank column.** The design puts ranks in the contract, so a
  database copy would be a second authority. Gated writes compare plan OIDs
  passed from Go (§6.4).
- **User direction (§2.1): `subscription_anchor_at`.** It stores the instant
  the paid series began. Period *n* runs from `anchor + n·months` to `anchor +
  (n+1)·months`, with the day of month clamped to the target month's last day.
- **Decision: a stored generated column.** The design says the record holds
  "whether it cancels at period end", and deriving it means it cannot
  contradict the scheduled plan. After `make sqlc`, confirm it appears in read
  models and in no insert parameter.
- **Decision: no row version column.** Both writers hold the row lock from
  their read until their single save statement (§7.2, §8). No unlocked writer
  exists, so optimistic concurrency would add nothing.
- **Decision: `FOR NO KEY UPDATE`, not `FOR UPDATE`.** Every subscription lock
  uses `FOR NO KEY UPDATE`, the mode a plain `UPDATE` of non-key columns
  already takes.
  - **Fact:** `hub_sessions` and other tables reference `hub_users`, and a
    child-row insert takes `FOR KEY SHARE` on the user row. `FOR NO KEY
    UPDATE` does not conflict with it, so an insert that only references the
    user is not blocked.
  - This does not keep logins or credential changes out of the way.
    **Fact:** `CreateHubSession` updates `hub_users.last_login_at`, and
    `LockHubUserCredentialMutation` and `LockHubEmailCredentialMutation` take
    `FOR UPDATE` on the user row. Those operations wait for a plan change, or
    a worker batch holding that user's row, to commit.
  - Both lock holders are short, a single save statement after one read, so
    the wait is bounded by one transaction.
- **No performance index.** `database.md` forbids them before profiling. The
  worker's `subscription_period_end` scan is the one to profile.

### 5.2 Queries: `backend/internal/db/queries/hub_subscriptions.sql`

Every query selects explicit columns.

1. **`GetHubMySubscription :one`**
   - Selects the subscription columns for `hub_session_id` and `hub_user_did`,
     with the session and active-user predicates `GetHubMyInfo` uses.
   - No row means `401`.

2. **`LockHubSubscriptionForChange :one`**
   - Selects the subscription columns `FROM vetchium.hub_users WHERE
     hub_user_did = $1 AND hub_user_state = 'active' FOR NO KEY UPDATE`.
   - No row means the user was disabled after authentication, which becomes
     `401`, as it does in the profile setters.

3. **`ClaimDueHubSubscriptions :many`**
   - Selects `hub_user_did` and the subscription columns.
   - `WHERE subscription_period_end <= sqlc.arg(at) AND hub_user_did <> ALL
     (COALESCE(sqlc.arg(skipped_hub_user_dids)::uuid[], '{}'))`
   - **Fact:** pgx v5 encodes a nil Go slice as SQL `NULL`, and `x <> ALL
     (NULL)` is never true, so without the `COALESCE` the first claim of every
     run would return nothing. The worker also passes a non-nil empty slice
     (§8).
   - `ORDER BY subscription_period_end, hub_user_did`
   - `LIMIT sqlc.arg(batch_size)`
   - `FOR NO KEY UPDATE SKIP LOCKED`

   The exclusion list holds the DIDs this run already skipped as invalid (§8).
   - **Decision:** no user-state filter. Renewal belongs to the subscription,
     the design does not tie it to account state, and a disabled user keeps
     the plan they had.

4. **`SaveHubSubscriptionStates :one`** is the single write statement shared
   by the set-plan handler and the worker.
   - A `states` CTE expands `sqlc.arg(states)::jsonb` with `jsonb_to_recordset`
     into these columns:
     - `hub_user_did uuid`
     - `hub_plan_oid text`
     - `subscription_billing_interval vetchium.hub_billing_interval`
     - `subscription_anchor_at timestamptz`
     - `subscription_period_start timestamptz`
     - `subscription_period_end timestamptz`
     - `scheduled_hub_plan_oid text`
     - `scheduled_billing_interval vetchium.hub_billing_interval`
   - An `updated` CTE updates `vetchium.hub_users` from `states` on
     `hub_user_did`. It sets every subscription column and `updated_at =
     now()`, and ends with `RETURNING hub_user_did`.
   - An `audit` CTE inserts into `vetchium.audit_events`:
     - rows come from `jsonb_to_recordset(sqlc.arg(events)::jsonb)` as
       `(hub_user_did uuid, action text, actor_type text, actor_id text,
       payload jsonb)`, inner-joined to `updated`;
     - `tenant_id`, `source`, and a nullable `idempotency_key` come from
       parameters;
     - `entity_type = 'hub_subscription'` and `entity_id =
       hub_user_did::text`;
     - it ends with `RETURNING audit_event_id, entity_id`. `RETURNING` can name
       only columns of the inserted table, and `entity_id` holds the DID.
   - The final select is:

     ```sql
     SELECT
         (SELECT count(*) FROM updated) AS updated_count,
         (SELECT count(*) FROM audit) AS audited_count,
         (SELECT count(DISTINCT entity_id) FROM audit) AS audited_user_count
     ```

   - The caller requires all three:
     - `updated_count` equals the states sent;
     - `audited_count` equals the events sent;
     - `audited_user_count` equals `updated_count`.

     Anything else is an error, and the transaction rolls back.
   - Checking totals alone would not be enough. A user whose catch-up produces
     two events could hide another user in the same batch who got none.

5. **`CompleteHubSignup`** (existing, `hub_signup.sql`).
   - `inserted_user` also inserts `hub_plan_oid =
     sqlc.arg(default_hub_plan_oid)`, and the handler passes
     `subscriptionspec.DefaultPlan`.
   - A new `subscription_audit` CTE writes action `hub.subscription.created`:
     - entity `hub_subscription`, entity ID the DID;
     - actor `anonymous`, source `hub-api`;
     - the signup idempotency key;
     - payload `{"hub_plan_oid": ...}`;
     - gated on `EXISTS (SELECT 1 FROM consumed)`, like the existing user
       audit.
   - Signup stays one statement.

**Decision:** the save takes JSON recordsets so one statement serves a
single-row caller and a batch caller. The alternative, parallel `unnest`
arrays, reads worse with eight columns. Existing queries write action names as
SQL literals. Here Go builds them, because the events depend on the decision
in §6. The action names are constants in `backend/internal/hub/billing`.

### 5.3 Audit events

Every event has:

- entity type `hub_subscription`, entity ID the user's DID, tenant from
  configuration;
- a payload of `before` and `after` snapshots of the state fields
  `hub_plan_oid`, `subscription_billing_interval`, `subscription_anchor_at`,
  `subscription_period_start`, `subscription_period_end`,
  `scheduled_hub_plan_oid`, and `scheduled_billing_interval`.

The exception is `hub.subscription.created`, whose payload is the creation
snapshot `{hub_plan_oid}`. No payload contains personal data.

| Action | Actor type / ID | Source | When |
| --- | --- | --- | --- |
| `hub.subscription.created` | `anonymous` | `hub-api` | Signup completion |
| `hub.subscription.upgraded` | `hub_user` / DID | `hub-api` | Immediate upgrade |
| `hub.subscription.change-scheduled` | `hub_user` / DID | `hub-api` | Downgrade or cancellation scheduled, or replaced |
| `hub.subscription.scheduled-change-cleared` | `hub_user` / DID | `hub-api` | Current plan chosen again |
| `hub.subscription.scheduled-change-applied` | `worker` / `subscription-renewal` from the worker; `system` / `subscription-renewal` from set-plan | `workers` or `hub-api` | A scheduled change applied at its effective boundary |
| `hub.subscription.renewed` | same as the row above | `workers` or `hub-api` | One or more new periods started; payload adds `periods_advanced` |

**Requested:** every change is audited "with the Hub user or the worker as
actor". **User direction (§2.1):** a period-end transition that set-plan
applies uses actor `system`, because the user did not cause it. Actor and source
therefore always name who acted and where (`database.md`). The request's
idempotency key links a `system` event to the operation that triggered it.

**Fact:** the email worker uses actor `worker` with a job-named actor ID and
source `workers`.

When one pass, by the worker or by set-plan, applies a scheduled paid change and
then crosses more periods, it writes two events:

- `scheduled-change-applied`, whose `after` is the state at the effective
  boundary: the new anchor, and the first period of the new series;
- `renewed`, from that state to the period containing `at`, with
  `periods_advanced`.

A pass that only renews writes one `renewed` event. Replays and unchanged
requests write none.

## 6. Backend domain package: `backend/internal/hub/billing/`

Pure, database-free Go. It owns period arithmetic, advancement, change rules,
and event building. It is tested at the lowest layer.

**Fact:** no Go test in the repository reaches PostgreSQL; only Playwright
does. **Decision:** month-end, leap-year, and catch-up arithmetic can only be
tested thoroughly as Go.

### 6.1 `instant.go`, `state.go`, `period.go`

**`Instant(t time.Time) time.Time`** returns
`t.UTC().Truncate(time.Microsecond)`.

- **Fact:** `timestamptz` stores microseconds.
- Callers pass `billing.Instant(now)` as `at`, and every instant read from the
  database also goes through `Instant`.
- A response built from a decided state therefore equals the later `GET`, and
  responses are UTC as `backend.md` requires.

**`Stored`** is the database-free input:

- `HubUserDID string`;
- `PlanOID string`, `Interval string` (empty when null);
- `AnchorAt`, `PeriodStart`, and `PeriodEnd` as `*time.Time`;
- `ScheduledPlanOID string` and `ScheduledInterval string` (empty when null).

**Fact:** sqlc emits a distinct row struct per multi-column query, such as
`GetHubMyInfoRow`. Each caller therefore converts its own row type in a small
adapter beside it:

- `storedFromMySubscription(sqlc.GetHubMySubscriptionRow)` and
  `storedFromLock(sqlc.LockHubSubscriptionForChangeRow)` in the handler
  package;
- `storedFromClaim(sqlc.ClaimDueHubSubscriptionsRow)` in the worker.

Each adapter maps the `pgtype` and nullable enum types to `Stored`, and has a
unit test.

**`StateFromStored(Stored) (State, error)`** builds a validated `State`: plan,
interval, anchor, period, and an optional scheduled plan and interval. It
rejects:

- a plan or scheduled plan the contract does not define;
- a paid state whose period is not a boundary pair of its anchor.

A rejected state becomes a `500` in handlers, or a skipped row in the worker
(§8), logged with the DID and the raw OID.

**`Boundary(anchor, interval, n)`** adds `n·1` or `n·12` months to the anchor's
year and month.

- The day is `min(anchor.Day(), lastDay(targetYear, targetMonth))`.
- The time of day is the anchor's, and the result is UTC.
- Never `time.AddDate`, which turns Jan 31 plus one month into Mar 3.

**`PeriodContaining(anchor, interval, at)`** returns the period for the largest
`n >= 0` with `Boundary(n) <= at`. It estimates `n` from the whole-month
difference, then corrects by at most one step each way.

### 6.2 `advance.go`, `change.go`

**`Advance(state, at) (State, []Transition)`** is the only statement of the
period-end rules. Three callers use it: the worker, set-plan before `Decide`,
and `GET` in memory (§2.1).

- **Free, or `at` before the stored period end:** unchanged, no transitions.
  This includes `at` before the period start, which absorbs clock skew between
  hosts.
- **Scheduled change present:** apply it at the old period end.
  - Free target: clear the interval, anchor, and period.
  - Paid target: the anchor becomes the old period end, and the period becomes
    `Boundary(newAnchor, newInterval, 0)` to `Boundary(newAnchor,
    newInterval, 1)`.
  - Emit a `scheduled-change-applied` transition to that state.
  - If `at` is at or after that first period's end, also emit a `renewed`
    transition to `PeriodContaining(newAnchor, newInterval, at)`, with
    `periods_advanced`.
- **No scheduled change:** emit a `renewed` transition to
  `PeriodContaining(anchor, interval, at)`, with `periods_advanced`.

**`Decide(current State, plan subscriptionspec.Plan, interval
subscriptionspec.BillingInterval, at time.Time) (State, *Transition,
Outcome)`** runs on the state `Advance` returned for the same `at`, so the
current period is never already over.

| Condition | Outcome | Result |
| --- | --- | --- |
| Target equals current plan and interval, nothing scheduled | `Unchanged` | No write |
| Target equals current plan and interval, change scheduled | `ScheduledChangeCleared` | Schedule cleared |
| `subscriptionspec.IsUpgrade(current.Plan, current.Interval, plan, interval)` | `Upgraded` | Plan and interval set; anchor and start = `at`; end = `Boundary(at, interval, 1)`; schedule cleared |
| Otherwise, target equals the existing scheduled change | `Unchanged` | No write |
| Otherwise | `ChangeScheduled` | Schedule set to the target, replacing any existing one |

The **requested** rules this implements:

- An upgrade applies immediately and starts a new period, with no proration.
- Monthly to annual on the same plan is an upgrade.
- A lower rank, annual to monthly, and cancellation to `hub-free-tier` are all
  scheduled downgrades.
- Choosing the current plan and interval clears a scheduled change.
- An upgrade clears a scheduled downgrade and applies immediately.

**Decisions:**

- A second downgrade replaces the first.
- Re-choosing the already-scheduled target is `Unchanged`.
- A due scheduled change is always applied before `Decide` runs. A user can
  therefore clear or replace only a change whose period end has not yet
  arrived, which matches the design's "before period end" (**requested**).

### 6.3 `events.go`

- The audit action constants from §5.3.
- `StateRecord(did, state)` builds a `states` recordset element.
- `Events(did, before, transitions, decision, actor)` builds the `events`
  recordset, with `before` and `after` snapshots per event, chained through
  the transitions.

### 6.4 `requirement.go`

- `AllowedPlanOIDs(minimum subscriptionspec.Plan) []string` returns the OIDs at
  or above `minimum`, ready to pass as a sqlc `text[]` parameter to a gated
  write's `hub_plan_oid = ANY(...)` predicate (**requested**).
- `Refusal(minimum subscriptionspec.Plan) hubproblem.PlanRequiredDetails`.
- The package documentation says a gated statement predicates on the committed
  `hub_users.hub_plan_oid`. A due change counts only once the worker or a
  set-plan has written it. A gated feature that cannot accept that lag must
  apply due transitions first in its own transaction, with `Advance` and
  `SaveHubSubscriptionStates`, as set-plan does.

### 6.5 Tests

Table-driven, parallel, fixed instants.

- **`Instant`:** truncates nanoseconds and converts to UTC.
- **Adapters:** every nullable column is null in one case and set in another.
- **`Boundary`:**
  - a Jan 31 monthly anchor gives Feb 28 in 2027, Feb 29 in 2028, then Mar 31
    and Apr 30;
  - a Feb 29 annual anchor gives Feb 28 in 2029 and Feb 29 in 2032;
  - time of day is preserved;
  - output is UTC even for non-UTC input.
- **`PeriodContaining`:** exactly on a boundary, one microsecond before, many
  periods later, and on clamped boundaries.
- **`Advance`:**
  - free;
  - not yet due;
  - `at` before the period start;
  - one period due, and many periods due;
  - a due scheduled cancellation;
  - a due annual-to-monthly change with no further period;
  - the same change crossing several more periods, which emits both events;
  - exactly on the boundary instant.
- **`Decide`:** every table row, for every combination of current state,
  scheduled change, and target, always on a state `Advance` has already
  brought up to `at`.
- **`StateFromStored`:** an unknown plan, an unknown scheduled plan, and an
  inconsistent period.
- **`Events` and `StateRecord`:** the JSON field names match the recordset
  columns in §5.2, and chained snapshots include the anchor.
- **`AllowedPlanOIDs` and `Refusal`:** including encoding through
  `apiserver.Runtime.Problem` (§7.4).

## 7. Backend API

### 7.1 Configuration, `backend/internal/appconfig/config.go`

Two new required keys, with no default.

**Decision:** a silent default for offered plans would let the backend and
portal disagree without anyone editing either file.

**`hubAPIServer.offeredPlans`** (**requested** name) becomes
`HubAPIServer.OfferedPlans []subscriptionspec.Plan`. Loading fails when the
list:

- is missing or empty;
- contains an unknown OID;
- contains a duplicate;
- lacks `hub-free-tier`.

**`workers.advanceHubSubscriptionsTimer`** becomes
`Workers.AdvanceHubSubscriptionsTimer`, a positive duration.

| Files | `offeredPlans` | Timer |
| --- | --- | --- |
| `config/<tenant>.json` (dev) | both plans, every tenant | `1m` |
| `config/ci/<tenant>.json` | both plans for `sgp`, `ind1`, `deu`; only `hub-free-tier` for `usa1` | `1s` |
| `deploy/<tenant>/config.json` | both plans, every tenant (**user direction**) | `1m` |

**Decision, CI `usa1`:** this is a test fixture, not evidence about production
policy. Playwright must exercise the not-offered `403` against a real tenant,
and `usa1` accepts signup in CI while `deu` does not (**fact:**
`config/ci/deu.json` has `signup.enabled: false`).

Tests in `config_test.go`:

- update `writeConfig`;
- one failing case per `offeredPlans` rule;
- the timer is required and must be positive;
- `TestCheckedInConfigs` keeps loading every checked-in file.

**New test: `TestCheckedInHubPlansMatchPortalConfiguration`.** For each
tenant it compares `hubAPIServer.offeredPlans` with `VETCHIUM_HUB_PLANS`, and
`tenantId` with `VETCHIUM_TENANT_ID`:

| Backend config | Portal environment |
| --- | --- |
| `config/<tenant>.json` | `docker-compose.json` service `hub-ui-<tenant>` |
| `config/ci/<tenant>.json` | `docker-compose-ci.json` service `hub-ui-<tenant>` |
| `deploy/<tenant>/config.json` | `deploy/<tenant>/stack.json` service `hub-ui` |

**Requested:** nothing can compare them at startup. **Decision:** a
repository test can compare the checked-in files, which catches drift before
deployment. This relies on the portal values being literals (§9.3).

### 7.2 Handlers, `backend/handlers/hub/subscriptions/subscriptions.go`

`hubruntime.Server` gains `OfferedPlans []subscriptionspec.Plan` and
`Offers(subscriptionspec.Plan) bool`, wired from configuration in
`cmd/hub-api/main.go`.

**`MySubscription(s)`**

1. Read the identity from `middleware.HubIdentityFromContext`.
2. Call `GetHubMySubscription`. `pgx.ErrNoRows` becomes the bearer `401`
   problem, as in `MyInfo`; any other error is `500`.
3. Run `storedFromMySubscription`, then `StateFromStored`. An invalid state is
   `500`.
4. Run `Advance(state, billing.Instant(s.CurrentTime()))` in memory and
   respond `200` with the result. `GET` writes nothing (§2.1).

**`SetSubscriptionPlan(s)`**

1. `apiserver.Decode` the `SetSubscriptionPlanRequest`, then
   `handlerauth.IdempotencyKey`. No side effects happen before both succeed.
2. `handlerauth.RunIdempotent(s, w, r, "hub:set-subscription-plan", did, key,
   request, s.CurrentTime().Add(24*time.Hour), work)`. `did` is the formatted
   DID, and `work` calls:

   ```go
   func setPlan(
       ctx context.Context, env setPlanEnv, q setPlanQueries,
       did pgtype.UUID, request subscriptionspec.SetSubscriptionPlanRequest,
       key common.IdempotencyKey,
   ) (handlerauth.Result[subscriptionspec.HubSubscription], *handlerauth.Problem, error)
   ```

   - `setPlanQueries` holds `LockHubSubscriptionForChange` and
     `SaveHubSubscriptionStates`; `*sqlc.Queries` satisfies it.
   - `setPlanEnv` supplies `TenantID`, `Offers`, and `Now`.
   - **Fact:** `idempotency.Run` begins its transaction through `Runtime.DB`,
     then calls `work` with a `*sqlc.Queries` bound to it. Extracting `setPlan`
     is what makes these branches unit-testable.
3. Inside `setPlan`:
   1. If `!env.Offers(request.PlanOID)`, return
      `handlerauth.Failure(hubproblem.PlanNotOfferedError)`.
      **Decision:** the target must always be offered, even when re-choosing a
      current plan the tenant has since withdrawn. Withdrawal is an open
      question, and refusing is the conservative reading of "refuses a change
      to a plan the tenant does not offer".
   2. `LockHubSubscriptionForChange`. `pgx.ErrNoRows` returns
      `handlerauth.AuthenticationFailure(hubproblem.AuthenticationRequiredError,
      hubauthn.BearerChallenge)`.
   3. `at := billing.Instant(env.Now())`, taken after the lock is held.
   4. Run `storedFromLock`, then `StateFromStored`, then `advanced,
      transitions := Advance(state, at)`, then `Decide(advanced,
      request.PlanOID, request.BillingInterval.Value, at)`.
   5. With no transitions and an `Unchanged` outcome, return `200` with
      `advanced` and write nothing.
   6. Otherwise, make one `SaveHubSubscriptionStates` call with source
      `hub-api` and the idempotency key, carrying:
      - one state record, the final state;
      - a `system` / `subscription-renewal` event for each transition;
      - a `hub_user` event for the decision, unless it is `Unchanged`.

      Check all three counts (§5.2).
   7. Return `200` with the final state.

**Concurrency.** §10.1 tests 13 and 14 cover the skip and the serialization
points. The committed-version re-check is PostgreSQL behavior that no test can
arrange deterministically, so it is argued here instead.

- `RunIdempotent` takes the idempotency advisory lock first, then `setPlan`
  takes the row lock.
- Two requests for one user with different keys serialize on the row lock. The
  second decides from the first's committed result.
- The worker claims with `SKIP LOCKED` and never waits, so no lock-order
  deadlock exists. A row a set-plan request holds is skipped and handled on a
  later pass, if it is still due.
- A worker claim that reaches a row just committed by a set-plan re-checks
  `subscription_period_end <= at` against the committed version, as READ
  COMMITTED does for `FOR NO KEY UPDATE`. It then holds the lock until its
  save, so one period-end transition cannot be applied twice.
- The worker and `hub-api` read different host clocks, and nothing depends on
  ordering between them. An upgrade starts at the handler's `at`, and the
  worker advances only what is due by its own `at`.

**Routes** in `hub_routes.go`:

- `GET /api/hub/my-subscription` →
  `hubAuth(hubsubscriptions.MySubscription(s))`
- `POST /api/hub/set-subscription-plan` →
  `hubAuth(hubsubscriptions.SetSubscriptionPlan(s))`

### 7.3 Handler tests, `backend/handlers/hub/subscriptions/subscriptions_test.go`

Use stubs and a fixed `Now` containing nanoseconds. The TypeSpec response union
is the matrix, and each row is covered at the lowest layer that reaches it:

| Response | Unit (Go) | Playwright API (§10.1) |
| --- | --- | --- |
| `GET` `200` | `MySubscription` with a `sqlc.Querier` stub: free, paid, scheduled change, stored period already past returned advanced with no write, instants truncated | Tests 1, 6, 8–11 |
| `GET` `401` from middleware | — | Test 3 |
| `GET` `401` from query `ErrNoRows` | Stub returns `ErrNoRows` | Unit only: `AuthenticateHubSession` already requires an active user, so this happens only when a user is disabled between middleware and query |
| `GET` `500` | Database error; stored state with an unknown plan | Not injectable without weakening isolation; unit only |
| `POST` `200` | `setPlan` with a `setPlanQueries` stub: one case per `Decide` outcome; a due transition alone with an `Unchanged` decision, which writes only `system` events; and a due transition followed by a change. Asserts the saved state, events, actors, and microsecond instants | Tests 5–8, 13, 14, 16 |
| `POST` `400` invalid JSON | `SetSubscriptionPlan` HTTP test, which fails before the transaction | Test 4 |
| `POST` `400` validation | Same, per field, including `billing_interval: null` and combinations | Test 4 |
| `POST` `400` `Idempotency-Key` | Same, missing and malformed | Test 4 |
| `POST` `401` from middleware | — | Test 4: no token, and a disabled user |
| `POST` `401` from lock `ErrNoRows` | `setPlan` | Unit only, for the reason given for the `GET` query |
| `POST` `403` not offered | `setPlan`, asserting the lock is never called | Test 5 |
| `POST` `409` idempotency key conflict | Needs the ledger transaction | Test 7 |
| `POST` `500` | `setPlan`: lock error, save error, `updated_count` 0, short `audited_count`, `audited_user_count` mismatch, unknown plan in the row | Test 12 (audit insert failure) |

Assert status, `Content-Type`, and body shape everywhere. Assert
`Cache-Control: no-store` only on responses whose union member declares it and
on authenticated responses.

**Fact:** `PortalAuthentication` sets `no-store` only after authentication
succeeds (`backend/internal/middleware/portal_auth.go`), and `Runtime.Problem`
does not set it. So a `401` rejected by the middleware is not asserted for it.

The test file's header comment records the split. The idempotency-key-conflict
`409` and replay need the ledger transaction, so they are covered in
Playwright.

### 7.4 Problem runtime tests

- `backend/internal/apiserver`: `Runtime.Problem` with `PlanRequiredDetails`
  writes `403`, the problem media type, and a body containing
  `required_plan_oid`, and it logs the problem type.
- `backend/internal/apiserver`: `DecodeJSON` into `SetSubscriptionPlanRequest`
  still rejects unknown members when `billing_interval` is present.
- `backend/internal/idempotency`: an `APIProblem` with a non-`Details` body is
  written unchanged.
- `backend/internal/handlerauth`: the updated assertions from §4.4.

## 8. Worker, `backend/internal/workers/advance_hub_subscriptions.go`

**Job.** `advance-hub-subscriptions`, with interval
`config.AdvanceHubSubscriptionsTimer`, added in `workers.New`.

**Transactions.** **Fact:** `workers.New(db *pgxpool.Pool, log, tenantID,
config, hubEmailDelivery ...*HubEmailDelivery)` keeps only `sqlc.New(db)`.

- Add an unexported `subscriptionTransactions` field, with method
  `InTransaction(ctx, func(subscriptionQueries) error) error`. `New` builds it
  from `db` without changing its signature.
- The implementation calls `db.Begin` only when invoked, so the existing
  `New(nil, ...)` tests stay valid.
- `subscriptionQueries` holds `ClaimDueHubSubscriptions` and
  `SaveHubSubscriptionStates`.
- Tests replace the field with a stub. `cmd/workers/main.go` needs no change.

**Each run** processes at most `maxHubSubscriptionBatches` (10) batches of
`hubSubscriptionBatchSize` (100). Each batch is one transaction:

1. `at := billing.Instant(now())`, with `now` injectable.
2. Claim up to the batch size, excluding DIDs this run already skipped. The
   exclusion list starts as a non-nil empty slice (`make([]pgtype.UUID, 0)`),
   and the query also coalesces `NULL` (§5.2). The rows stay locked until
   commit.
3. For each row, run `storedFromClaim`, `StateFromStored`, and `Advance`. A row
   that fails `StateFromStored` is added to the run's skipped set, with its DID
   and raw OID, and left unchanged so it stays due. It is not logged
   individually.
4. If any valid row changed, make one `SaveHubSubscriptionStates` call with
   source `workers`, actor `worker` / `subscription-renewal`, and a null
   idempotency key. All three counts from §5.2 must match, or the batch
   returns an error.
5. Commit.

Stop when a batch claims fewer rows than the batch size.

**Skipped rows.** The skipped set is deduplicated across the run's batches, and
each later claim excludes it, so one invalid row is claimed once per run. At
the end, a run with skipped rows logs one aggregate error with the count, DIDs,
and raw OIDs, then returns `nil`. The valid rows have already been committed.

- **Fact:** `runPeriodicJob` retries a failed run after one second, doubling
  up to `retryBackoffLimit` (`backend/internal/workers/workers.go`).
- Returning an error for a row no retry can fix would re-run the job quickly
  and repeatedly. Returning `nil` keeps the normal interval, with one error log
  per pass.
- Claim errors, save errors, and count mismatches still return errors, because
  a retry can fix those.

**Decision:** skipping lets valid renewals continue past a row no retry can
fix. Its limits:

- Invalid rows sort first, but later claims in a run exclude them, so they use
  only part of the run's 1,000-row budget. When 1,000 or more invalid rows are
  due, they use the whole budget and valid renewals stall for that run. The
  skipped set resets at the start of each run, so that stall recurs every run
  until the rows are fixed.
- An unknown OID can only come from a database newer than the binary. When a
  plan is added, migrate first, then deploy `workers` and `hub-api` from the
  same release. `deploy/README.md` states this.

**Bounded work.** A backlog above 1,000 due rows completes over later runs.

**Tests.**

- `TestNewUsesConfiguredJobInterval` sets `AdvanceHubSubscriptionsTimer` to the
  shared `interval` and expects four jobs.
- One batch saved with the correct states, events, and instants.
- A scheduled change crossing further periods saves two events for that row.
- **Mixed batch:** one user with a two-event catch-up and one with a single
  renewal save two states and three events, reported for two distinct users.
  A stubbed `audited_user_count` of 1 with correct totals is rejected.
- A short batch stops the run, and the batch limit is respected.
- A claim error, a save error, and each count mismatch return an error with no
  later batch.
- An invalid row is skipped while valid rows in its batch are saved.
  - Its DID is passed as excluded to every later claim in the run.
  - The first claim of a run receives a non-nil, empty exclusion slice.
  - The run logs exactly one aggregate error and returns `nil`.

## 9. Portals

### 9.1 Shared runtime configuration, `portal-ui`

**Fact:** `portal-ui/src/preferences.tsx` reads `globalThis.__VETCHIUM_CONFIG__`
privately.

- Add `portal-ui/src/runtime-config.ts` exporting `runtimeConfigValue(name:
  string): unknown`. It returns `undefined` when the global or the member is
  absent.
- Use it from `preferences.tsx`, and add `./runtime-config` to the `exports`
  map.
- It stays portal-agnostic: callers name the member and validate the value.

Verify with `make portal-ui-check admin-ui-check hub-ui-check`.

### 9.2 `hub-ui` runtime configuration

**`hub-ui/runtime-config.sh`** (**requested** variable names):

- **`VETCHIUM_TENANT_ID`** is required and must match
  `^[a-z][a-z0-9-]{0,62}$`. **Fact:** this is the backend's
  `regions.IsTenantID` rule in `backend/internal/regions/catalog.go`.
- **`VETCHIUM_HUB_PLANS`** is required. It is comma-separated, with no empty
  items, every item in `hub-free-tier hub-silver-tier`, no duplicates, and
  `hub-free-tier` present.
- **Failure:** a one-line reason on stderr and exit `1`, like the language
  check.
- **Output:** `Object.freeze({ defaultLanguage: "...", tenantId: "...",
  hubPlans: Object.freeze([...]) })`. Values are interpolated only after
  validation limits them to a safe character set.
- **Output path:** `VETCHIUM_RUNTIME_CONFIG_PATH`, defaulting to the current
  `/tmp/vetchium-runtime-config.js`, so the script test can write to a
  temporary directory. The nginx alias still reads the default path.
- **Duplication:** the plan list duplicates the contract, as the locale list
  already does (**fact**). A comment beside it says the §7.1 test covers the
  checked-in environments but not this list.

**Script test**, `hub-ui/scripts/runtime-config.test.mjs`, uses `node:test` and
`child_process`. **Fact:** `hub-ui/package.json` has no test script today.

- **Run by:** a new `"test": "node --test scripts/*.test.mjs"` script, which
  the Makefile's `hub-ui-check-ready` runs. A bare directory argument would make
  Node 24 treat the directory itself as a test file.
- **Rejections:** each case exits non-zero and writes no output file:
  - `VETCHIUM_TENANT_ID` missing, or containing uppercase letters or `/`;
  - `VETCHIUM_HUB_PLANS` missing, or with an empty item;
  - an unknown plan, a duplicate plan, or no `hub-free-tier`.
- **Language check:** the existing check is still enforced.
- **Success:** the emitted file, evaluated in a `node:vm` context, defines a
  frozen `__VETCHIUM_CONFIG__` with the expected `defaultLanguage`,
  `tenantId`, and frozen `hubPlans`.

**`hub-ui/public/runtime-config.js`** (Vite development) adds `tenantId:
"sgp"` and `hubPlans: ["hub-free-tier", "hub-silver-tier"]`.

**`hub-ui/src/app/runtime-config.ts`:**

- `configuredTenantID(): string | null`;
- `configuredPlans(): readonly HubPlan[]`, which keeps known plans in rank
  order, drops unknown values, and always includes `hub-free-tier`.

**Decision:** a missing or malformed value degrades to the free plan only,
rather than breaking the portal.

**`hub-ui/README.md`** documents both variables and says they must match the
tenant's `hubAPIServer.offeredPlans`.

### 9.3 Compose and deployment

- **`docker-compose.json` and `docker-compose-ci.json`:** each
  `hub-ui-<tenant>` service gains literal `VETCHIUM_TENANT_ID` and
  `VETCHIUM_HUB_PLANS` values matching §7.1. The existing
  `VETCHIUM_DEFAULT_LANGUAGE` substitution stays.
- **`deploy/<tenant>/stack.json`:** service `hub-ui` gains the same two
  literals.
  **Decision:** literals, not `.env` substitutions. They must agree with
  `config.json` in the same directory, and an operator override would break
  that silently.
- **`deploy/README.md`:** add a paragraph beside the existing
  `hubAPIServer.signup.enabled` agreement rule. It says:
  - `offeredPlans` and `VETCHIUM_HUB_PLANS` change together;
  - what each disagreement looks like (**requested**);
  - simulated payments let any production signup take a paid plan free
    (**requested**);
  - adding a plan means migrating first, then deploying `hub-api` and
    `workers` from the same release (§8).

### 9.4 `hub-ui` feature: `hub-ui/src/features/subscriptions/`

**`hub-ui/src/api/hub.ts`:** add `mySubscription()` and
`setSubscriptionPlan(body, idempotencyKey)`, with types from
`typespec/hub/subscriptions/subscriptions`.

**`queries.ts`:**

- `mySubscriptionQueryKey = ["hub", "my-subscription"]` and
  `useMySubscriptionQuery()`.
- `useSetSubscriptionPlan()` uses `useIdempotencyKey()` from
  `hub-ui/src/api/idempotency.ts`.
  - Rotate the key after success and whenever the chosen target changes. A
    retry of one choice then replays, and a new choice gets a new key.
  - On success, call `setQueryData` with the response.

**`prices.ts`**, keyed by tenant ID, paid plan, and billing interval
(**requested** keying):

```ts
export const prices = {
  usa1: { currency: "USD", plans: { "hub-silver-tier": { month: 10, year: 110 } } },
  deu: { currency: "EUR", plans: { "hub-silver-tier": { month: 10, year: 110 } } },
  sgp: { currency: "SGD", plans: { "hub-silver-tier": { month: 10, year: 110 } } },
  ind1: { currency: "INR", plans: { "hub-silver-tier": { month: 1000, year: 11000 } } },
} as const satisfies Record<string, TenantPrices>;
```

- `hub-free-tier` has no entry.
- `planPrice(tenantID, plan, interval)` returns `{ amount, currency } |
  undefined`.
- The UI test that walks every tenant (§10.2) checks that annual is eleven
  months.

**`format.ts`:** `formatPrice(amount, currency, locale)` uses
`Intl.NumberFormat(locale, { style: "currency", currency })`.

**Decision:** also pass `trailingZeroDisplay: "stripIfInteger"`, so whole
amounts show no `.00`. Confirm the option is in the installed TypeScript `lib`
typings; if not, omit it rather than cast.

**`offeredPlans.ts`:** `presentablePlans(tenantID, configured)` keeps
`hub-free-tier`, plus each paid plan with both a monthly and an annual price
for the tenant (**requested**: hide a paid plan without a price).

**`planLabel(t, planOID)`:** the translated `plans.names.<oid>` for a known
plan; otherwise the raw OID (**requested**).

**`PlanOptions.tsx`:**

- One Ant Design `Card` per presentable plan, showing its name. Paid plans also
  show monthly and annual prices, and the actions.
- Action labels come from `isUpgrade` and the current state:
  - "Current plan", disabled;
  - "Keep this plan", which clears a scheduled change;
  - "Upgrade" or "Switch to annual", which apply immediately;
  - "Switch at period end" and "Cancel at period end", which are scheduled.
- Scheduled changes and cancellations confirm through
  `App.useApp().modal.confirm`, showing the effective date. No browser
  dialogs.
- If the current or scheduled plan OID is not a known `HubPlan`, every change
  action is disabled. An Ant Design `Alert` says the plan cannot be changed in
  this version of the portal, and the raw OID is shown.
- Paid cards show the **requested** bullet "The paid plans will support the
  development of the Vetchium FOSS project." as an Ant Design `Alert` with
  `type="success"` and `showIcon`, with no custom CSS.
- Actions are disabled while a change is pending. Mutation errors render
  through `APIErrorAlert`.

**`CurrentSubscriptionCard.tsx`:**

- Shows the plan name, the interval, period dates via `Intl.DateTimeFormat` in
  the interface language, and any scheduled change or cancellation with its
  effective date.
- **Decision:** no special handling for a page left open past period end. `GET`
  always returns the advanced state (§7.2), and TanStack Query refetches on
  focus. A choice made from a stale page is applied by set-plan after the due
  transition, so the result is still correct.

**Query states for `GET my-subscription`, both pages:**

- **Loading:** an Ant Design `Skeleton` in the card area, with a translated
  accessible label.
- **Error:** `APIErrorAlert` plus a translated "Try again" `Button` that calls
  `refetch`. Plan actions are not rendered until data arrives.
- **`401`:** the shared API client's authentication failure handling clears the
  session and returns to sign-in. **Fact:** "an API authentication failure
  clears the matching session" covers that behavior today. The plan page adds
  no handling of its own.
- **Home page:** the plan and profile invitations render immediately and do not
  wait on the query. The paid-plan request appears only once data shows
  `hub-free-tier`. On loading or error it is omitted, with no alert on the home
  page.

Before handoff, read the installed `antd` declarations for `Card`, `Alert`,
`Modal`/`App`, `Descriptions`, `Button`, `Skeleton`, the interval selector
(`Segmented` or `Radio`), and `Tag`. Use nothing marked `@deprecated`, per
`ui.md`.

### 9.5 `hub-ui` pages and routes

**`PlanPage.tsx`**, route `plan` under `AppShell` inside `ProtectedRoute`:

- composes `CurrentSubscriptionCard` and `PlanOptions`, with a document title;
- `AppShell.tsx` gains a navigation item for it, using an icon from the
  installed `@ant-design/icons`, and extends `selectedKey`.

**`HomePage.tsx`** replaces the placeholder with:

- a card inviting the user to choose a plan, linking to `/plan`;
- a card inviting them to fill in basic profile information, linking to
  `/settings/profile`;
- while the plan is `hub-free-tier`, a line asking them to consider a paid
  plan.

**Decision:** both invitations show on every visit, and the paid-plan request
only on the free plan. The design says "after sign-in" and gives no dismissal
rule.

**`TermsPage.tsx`**, route `terms` in the first public `PublicShell` group, so
it is reachable signed in or out (**requested**: one public `/terms`, the same
for every tenant):

- all content comes from translations: a title, a short general placeholder
  section, and a "Payments" section of generic placeholder text saying payment
  terms will be published before real payments are taken;
- no legal commitments, and no acceptance control (**requested**: acceptance
  not recorded).

**`SignupPage.tsx`:** add a `Link` to `/terms` beside the existing sign-in
prompt.

**`components/common/APIErrorAlert.tsx`:** map `PlanNotOfferedError.type` to
`errors.planNotOffered`.

**Decision:** no mapping for the plan-required problem yet. The design says no
endpoint declares it until the first gated feature, and that "the portal
decides per feature" how to present a locked feature.

**Translations** in `hub-ui/src/i18n/locales/{en,de,ta}.ts`, all complete and
kept aligned by the `LocaleResource` type:

- `navigation.plan`;
- `plans.*`: names for both OIDs, titles, interval labels, action labels,
  confirmation text, scheduled-change text, the FOSS bullet, the unknown-plan
  alert, the loading label, and "Try again";
- `home.*`: the invitations, replacing `home.placeholder`;
- `terms.*`;
- `signup.terms`;
- `errors.planNotOffered`.

## 10. Playwright

Follow `playwright.md`: fully parallel, UUID-backed identifiers, per-test
cleanup in `try`/`finally` or an automatic fixture, role and test-id locators,
and no fixed sleeps.

### 10.1 API: `playwright/api/hub-subscriptions.spec.ts`

**Client.** `HubAPI` in `playwright/lib/hub-api.ts` gains an optional tenant
in its constructor, `new HubAPI(request, tenant?)`.

- Its origin becomes `http://hub-ui.${tenant}.localhost`, following the
  cross-tenant `signup()` helper.
- With no tenant it keeps today's `HUB_ORIGIN`.
- **Fact:** today it always calls `${HUB_ORIGIN}/api/hub`, which defaults to
  sgp.
- Test 5 on `usa1` constructs its client with that tenant.

It also gains typed methods:

- `mySubscription(token)`;
- `setSubscriptionPlan(body: SetSubscriptionPlanRequest, { token,
  idempotencyKey, timeout? })`, which forwards `timeout` to Playwright's
  request call for tests 13 and 14;
- `setSubscriptionPlanRaw(body: Record<string, unknown> | string, { token?,
  idempotencyKey? })` for malformed and invalid payloads (`playwright.md`).

**Fact:** the class exposes only generic `post`, `postRaw`, and `get` today.

**Signup.** Move the cross-tenant `signup()` helper from
`playwright/api/signup-regions.spec.ts` into `playwright/lib/hub-signup.ts`.

- Parameterize the display name, language, and resident country, and return
  the DID and password.
- Update `signup-regions.spec.ts` to import it.
- Add a login step that returns a session token.
- Setup seeds the test domain with `seedHubSignupDomain(domain, tenant)`.
- Use resident country `FR`, as today. **Fact:** every CI tenant's catalog
  entry has `allowedCountries: []`, which admits every country.

**Cleanup**, in `finally`:

- `cleanupHubUser(email, tenant)`, which removes the user and so its
  subscription columns;
- `cleanupHubSignupDomain(domain, tenant)`;
- `cleanupHubIdempotency(keys, tenant)`;
- the remover returned by `installHubAuditInsertFailure`, in its own nested
  `finally`, as `playwright/api/hub-audit.spec.ts` already does;
- `cleanupHubSubscriptionAudit(did, tenant)`, which deletes `audit_events`
  rows with `entity_type = 'hub_subscription'` and `entity_id = did`.

Every test deletes everything it created (`playwright.md`). `database.md`'s
append-only rule governs application paths, not test teardown scoped to
test-owned identifiers. The helper refuses a malformed DID, like the existing
audit helpers.

**DB helpers** in `playwright/lib/admin-db.ts` are for setup, audit
inspection, and lock control only. They are scoped to test-owned DIDs, use the
existing assertion style, and take a tenant.

- **`setHubSubscriptionPeriod(did, tenant, { anchor, start, end })`**
  - Sets the anchor and period columns.
  - Its batch form, `setHubSubscriptionPeriods(tenant, entries)`, applies
    several in one `psql` invocation.
  - Tests 9–11 and 16 choose the first day of a month at `00:00Z`, so their
    expected boundaries need no clamping.
  - Test 13 passes pairs from `boundaryPairEndingAt`.
  - The instants passed are always a boundary pair of the anchor.
- **`hubSubscriptionAuditEvents(did, tenant)`**
  - Returns `hub_subscription` events for the DID, ordered by
    `created_at, audit_event_id`.
  - Uses `sqlScalarForTenant`. **Fact:** `auditEventJSON` uses the sgp-only
    `sqlScalar`.
- **`databaseNow(tenant)`** returns the database's `now()`, so tests compute
  instants on the database clock.
- **`holdHubUserRowLock(did, tenant)`** spawns a `psql` session, following
  `credentialRefreshPruneRace`.
  - It runs `BEGIN; SELECT 1 FROM vetchium.hub_users WHERE hub_user_did = ...
    FOR NO KEY UPDATE;`, then `SELECT pg_backend_pid(), clock_timestamp();`,
    and prints both values with a ready marker. `clock_timestamp()` is taken
    after the lock is granted; `now()` would give the transaction start.
  - It returns `{ holderPID, lockedAt, release(period?) }`.
    - `release` optionally applies a `{ anchor, start, end }` period with the
      same `UPDATE` as `setHubSubscriptionPeriod` inside the held transaction,
      then sends `COMMIT` and awaits exit.
    - The test calls it in `finally`.
- **`waitForBlockedBy(tenant, holderPID, n)`** polls until at least `n`
  backends are transitively blocked by that holder.
  - A second waiter on the same row waits on the first waiter's tuple lock, so
    `pg_blocking_pids` names the first waiter, not the holder. The query
    therefore follows the chain:

    ```sql
    WITH RECURSIVE blocked(pid) AS (
        SELECT pid FROM pg_stat_activity
        WHERE ${holderPID} = ANY (pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity AS a
        JOIN blocked AS b ON b.pid = ANY (pg_blocking_pids(a.pid))
    )
    SELECT count(*) FROM blocked
    ```

  - `holderPID` must match `/^\d+$/` and is then interpolated, following the
    existing assertion helpers. **Fact:** `sqlScalarForTenant` runs `psql`
    with a SQL string and has no parameter binding.
  - The count starts from the test's own holder, so parallel tests waiting on
    other rows are never counted.

Add `playwright/lib/billing-periods.ts`, the test oracle for §2.1.

- `boundary(anchor, interval, n)` implements the clamped anchor-day rule.
- `boundaryPairEndingAt(end, interval)` returns `{ anchor, start, end }` by
  searching backwards from `end` in whole intervals:
  - For `k = 1, 2, …`, the candidate anchor has `end`'s day of month and time
    of day (UTC).
    - Monthly: the candidate is `k` months before `end`.
    - Annual: it is `k` years before `end`, in the same month.
  - Take the first `k` whose candidate date exists without clamping.
    - Monthly, `k ≤ 2`: every month adjacent to a month lacking day 29, 30, or
      31 has it.
    - Annual, `k ≤ 8`: Feb 29 can be skipped across a non-leap century year.
    - Fail loudly if the bound is exceeded.
  - Then `anchor` is that candidate, `start = boundary(anchor, interval, k -
    1)`, and `end = boundary(anchor, interval, k)`. The last holds because the
    anchor's day exists in `end`'s month.
- A committed period can therefore end at any chosen instant and still pass
  `StateFromStored`'s boundary-pair rule.
- The oracle is tested in the same spec file. Every calendar day of 2027 and
  2028, at a non-midnight time, for both intervals, must satisfy
  `boundary(anchor, interval, k - 1) == start`, `boundary(anchor, interval, k)
  == end`, and `anchor <= start < end`. The test also covers:
  - the §2.1 Jan 31 and Feb 29 examples;
  - the maximum annual search bound: an end of `2104-02-29` anchors at
    `2096-02-29`, with `k = 8`;
  - the maximum monthly search bound: an end of `2027-03-31` anchors at
    `2027-01-31`, with `k = 2`.

**Tests**

1. **Signup creates the free subscription.**
   - `GET` returns `200`: `hub-free-tier`, no interval, no period,
     `cancel_at_period_end: false`, no scheduled change.
   - Exactly one `hub.subscription.created` event.
2. **Signup rollback.** With `installHubAuditInsertFailure` matching
   `hub.subscription.created` and the completion key, completion returns
   `500`. No user exists, and the signup request is not consumed.
3. **`GET` `401`.** Missing token, invalid token, and a disabled user
   (`setHubUserState`).
4. **`POST` rejections.** Each leaves the subscription unchanged.
   - `400` invalid JSON, for malformed JSON and for `billing_interval: 1`.
   - `400` validation, asserting `fields`, for: an unknown `plan_oid`; an
     interval with `hub-free-tier`; `billing_interval: null` with
     `hub-free-tier`; a missing interval for silver; `billing_interval: null`
     with silver; an unknown interval.
   - `400` for a missing `Idempotency-Key`.
   - `401` with no token, and `401` for a disabled user.
5. **Not offered, tenant `usa1`.**
   - Silver returns `403` plan-not-offered. The subscription stays free, and
     there is no event after creation.
   - `hub-free-tier` returns `200` unchanged.
6. **Upgrade.** Free to silver monthly returns `200`.
   - `current_period_start` is within a safe margin of the request time, and
     `current_period_end` is one calendar month later.
   - The response equals the following `GET` exactly.
   - One `hub.subscription.upgraded` event, with snapshots including the
     anchor.
7. **Idempotency.**
   - The same key and body replays the identical body with no new event.
   - The same key with a different body returns `409`.
8. **Change rules.** Each step asserts that the response equals the following
   `GET`, and asserts its event.
   - Silver monthly to annual: immediate, with a new period.
   - Annual to monthly: scheduled.
   - Annual again: clears the schedule.
   - Silver to free: sets `cancel_at_period_end`.
   - An upgrade while a cancellation is scheduled clears it.
   - The current plan with nothing scheduled: `200`, with no event.
9. **Renewal.**
   - Setup: silver monthly, then `setHubSubscriptionPeriod` with the anchor
     and start on the first of the month three months ago, and the end one
     month after that.
   - `expect.poll` until `GET` shows the period containing now, on calendar
     boundaries from the anchor.
   - Then exactly one `hub.subscription.renewed` event, with `periods_advanced
     >= 3`, actor `worker`, and source `workers`.
10. **Scheduled cancellation applied.**
    - Schedule a cancellation, then move the period into the past the same
      way.
    - Poll until `GET` shows `hub-free-tier`.
    - Then one `hub.subscription.scheduled-change-applied` event with actor
      `worker`, and no `renewed` event.
11. **Scheduled interval change with catch-up.**
    - Setup: silver annual with a scheduled monthly.
    - `setHubSubscriptionPeriod` with the anchor and start on the first of the
      month 14 months ago, and the end 12 months after that. The annual period
      ends two months ago.
    - Poll until `GET` shows a monthly subscription: `current_period_start` on
      the first of a month at `00:00Z`, `current_period_end` one calendar month
      later, and the period containing now.
    - Then exactly one `scheduled-change-applied` event, whose `after` anchor
      is the old annual end.
    - And exactly one `renewed` event, with `periods_advanced >= 2`.
    - Both events are written by one statement, so their `created_at` is equal
      and IDs are random. Select them by action, not by order, and assert that
      `scheduled.after` equals `renewed.before`.
12. **Audit failure.** With `installHubAuditInsertFailure` matching
    `hub.subscription.upgraded` and the user's DID, set-plan returns `500`,
    and the subscription is unchanged.
13. **The worker skips a committed due row a user change holds.** Tenant `sgp`.
    User A and control user B are made silver monthly through the API during
    setup. The test sets `test.setTimeout(120_000)`.
    1. `T = databaseNow() + 15s`. The margin covers `docker compose exec` round
       trips on a cold CI host, and the `lockedAt < T` assertion still guards
       it.
    2. In one `psql` invocation, `setHubSubscriptionPeriods(tenant, [[A,
       boundaryPairEndingAt(T, month)], [B, boundaryPairEndingAt(T + 2s,
       month)]])`. Both periods are committed and not yet due.
    3. `holdHubUserRowLock(A)`. Assert `lockedAt < T`. If setup overran the
       margin, fail with that message rather than passing vacuously.
    4. Start `setSubscriptionPlan(A, silver annual)` with key `K13` and an
       explicit request `timeout` of 60s. Keep its promise without awaiting
       it. Then
       `waitForBlockedBy(tenant, holderPID, 1)`.
    5. Poll for B's `hub.subscription.renewed` event, with a timeout of `(T +
       2s − databaseNow()) + 10s`.
       - B was due only from `T + 2s`, so a worker pass ran with `at >= T +
         2s`.
       - In that pass A was committed, due, and ordered before B. `SKIP LOCKED`
         rows do not count toward `LIMIT`, so the claim reached A and skipped
         it.
       - Without `SKIP LOCKED` the worker would block on A and B would never
         renew, so a regression fails here.
    6. Assert A has no `renewed` or `scheduled-change-applied` event. This is
       the proof that the worker skipped the locked row.
    7. Call `release(boundaryPairEndingAt(databaseNow() + 1 month, month))`
       explicitly here, moving A to a future period inside the held
       transaction. The test's `finally` calls `release()` again as a guard;
       `release` does nothing once the session has exited.
       - At commit A is no longer due, so no worker claim can take A between
         commit and the waiting request's relock.
       - A committed but lock-free due row could be claimed there.
    8. The request returns `200`: silver annual, with `current_period_start`
       after `T`. `GET` equals the response.
    9. The `hub.subscription.upgraded` events with idempotency key `K13` number
       exactly one. Selecting by key excludes setup's earlier upgrade.
14. **Concurrent changes for one user serialize.** Tenant `sgp`, with
    `test.setTimeout(60_000)`.
    1. `holdHubUserRowLock(A)` on a user made silver monthly during setup.
    2. Send two `setSubscriptionPlan(silver annual)` requests with keys `K14a`
       and `K14b` and an explicit 30s timeout each, without awaiting them.
    3. `waitForBlockedBy(tenant, holderPID, 2)` proves both are blocked,
       directly or transitively, by this holder. Then `release()` in
       `finally`.
    4. Both return `200` with an identical body, equal to the following `GET`.
    5. Across keys `K14a` and `K14b` there is exactly one
       `hub.subscription.upgraded` event. The second request decided
       `Unchanged` from the first's committed state.
15. **Database constraints for subscription shape.**
    - The behavior under test is the schema itself. No API can produce these
      rows, so the database helper is the subject here, not setup.
    - **Fact:** `admin-housekeeping.spec.ts` (`credentialRefreshPruneRace`),
      `admin-login-concurrency.spec.ts`, and
      `admin-credential-replacement-concurrency.spec.ts` already test database
      behavior through `admin-db.ts` helpers, so this follows precedent.
    - `expectHubUserSubscriptionRejected(did, tenant, violation)` takes a named
      violation from a fixed list, never raw SQL. It runs the matching `UPDATE`
      on a test-owned user and asserts that `psql` fails with the expected
      constraint name in its error text. **Fact:** the tenant `psql` helper
      runs at default verbosity, which prints no SQLSTATE.
    - Violations for `hub_users_free_plan_has_no_period`:
      - free with each one of the four period fields set;
      - paid with each one of the four fields null.
    - Violations for `hub_users_subscription_period_ordered`:
      - start not before end;
      - anchor after start.
    - Violations for `hub_users_scheduled_plan_consistent`:
      - a scheduled paid plan without an interval;
      - a scheduled free plan with an interval;
      - no scheduled plan but a scheduled interval;
      - a scheduled change on a free plan;
      - a scheduled change equal to the current plan and interval.
    - After each case, `GET` shows the subscription unchanged.
16. **A plan change applies a due period end first.** Tenant `sgp`.
    - The worker may apply the due transition before the request arrives. The
      assertions hold either way, so the test is deterministic. Unit tests
      (§7.3) prove the `system`-actor path specifically.
    1. User 1 is silver monthly with a scheduled cancellation. Move its period
       into the past with a first-of-month pair, then immediately choose silver
       annual.
       - The response is `200`: silver annual, with a period starting after the
         request began.
       - There is exactly one `scheduled-change-applied` event. It has either
         actor `worker` with source `workers`, or actor `system` with source
         `hub-api` and the request's idempotency key.
       - There is exactly one `upgraded` event with the request's key, whose
         `before` plan is `hub-free-tier`.
    2. User 2 is silver monthly with no schedule. Move its period into the
       past, then immediately choose silver monthly.
       - The response is `200`, with a period containing now.
       - There is exactly one `renewed` event, from either actor as above.
       - There is no `hub_user` event.
    3. For both users, `GET` equals the response.

Tests 9–11 and 13 depend on the `sgp` CI worker timer (`1s`, §7.1).

- Each sets `test.setTimeout` explicitly, because the config default is
  `30_000`.
- Each gives its polls a timeout computed from the target instant plus several
  intervals, never the `5_000` expect default.
- Every lock holder is released in `finally`.
- Tests 13 and 14 keep every request promise they start. Their `finally` first
  releases the holder, then awaits `Promise.allSettled` on those promises, and
  only then deletes users, ledger rows, or audit events. A failed poll or
  blocker check therefore cannot leave a request running into cleanup, or
  leave an unobserved rejection.

**Existing API specs**

- `playwright/api/hub-audit.spec.ts`: the signup-completion assertion that
  expects one event for the completion key now expects `hub.user.created` and
  `hub.subscription.created`.
- `playwright/api/hub-auth.spec.ts`: grep for exact audit counts keyed by a
  signup completion key, and update them the same way.
- `playwright/api/signup-regions.spec.ts`: import the moved `signup()` helper.

### 10.2 UI: `playwright/ui/hub-plans.spec.ts`

Use mocked API routes and a stored session, following
`playwright/ui/hub-foundation.spec.ts`. Override runtime configuration per test
with `page.route("**/runtime-config.js", ...)`.

- **Route guard:** `/plan` without a session redirects to `/login`.
- **Loading:** with `my-subscription` held open, a skeleton with its
  accessible label is visible and no plan action renders. After release, the
  plans render.
- **Load failure:** a mocked `500` shows the generic error with "Try again".
  Retrying against a now-successful mock renders the plans.
- **Session expiry:** a mocked `401` on `my-subscription` clears the session and
  shows sign-in.
- **Plan page, `sgp`, both plans, `en-US`:**
  - both plans with translated names;
  - silver shows monthly and annual prices equal to `Intl.NumberFormat` output
    with the §9.4 options for SGD 10 and 110;
  - the FOSS bullet appears only on the paid card;
  - the current free subscription is shown.
- **Prices for every tenant:** for each of `usa1`, `deu`, `sgp`, and `ind1`,
  override `tenantId`. Assert the currency and the §9.4 amounts, and that the
  annual amount is eleven times the monthly one.
- **Hidden plans:** `tenantId: "zz9"` hides silver (no price), and `hubPlans:
  ["hub-free-tier"]` hides silver.
- **Upgrade:** one `POST` with an `Idempotency-Key` and the expected body; the
  mocked `200` updates the current card.
- **Downgrade:** the dialog opens; cancel sends no request; confirm sends one,
  and the scheduled change appears with its date.
- **Keep this plan:** with a scheduled change, it sends the current plan and
  interval.
- **Mutation errors:** a mocked `403` plan-not-offered shows its translated
  message, and a mocked `500` shows the generic one. Actions re-enable after
  both.
- **Retry:** a mocked network failure, then a retry of the same choice, sends
  the same `Idempotency-Key`.
- **Unknown plan:** `plan_oid: "hub-gold-tier"` shows the raw OID and the
  unknown-plan alert, and every change action is disabled.
- **Unknown scheduled plan:** a known current plan with
  `scheduled_change.plan_oid: "hub-gold-tier"` also shows the raw OID and the
  alert, and every change action is disabled.
- **Locales:** `de-DE` and `ta` show translated plan names and locale-formatted
  prices.
- **Home page:**
  - on free, both invitations and the paid-plan request appear, and both links
    navigate;
  - on silver, the paid-plan request is absent;
  - with `my-subscription` failing, both invitations still appear, the
    paid-plan request does not, and no error alert is shown.
- **Terms:** in `en-US`, `de-DE`, and `ta`, `/terms` shows the translated title
  and payments heading signed out. It is also reachable signed in, and the
  signup page links to it.

**Existing UI specs.** `playwright/ui/hub-foundation.spec.ts`:

- Add `provideMySubscription(page)` beside `provideMyInfo`, and call it wherever
  `provideMyInfo` is used. That includes tests starting on
  `/settings/profile`, where it is harmless.
- **"a visitor with a stored session sees the placeholder home":** rename it
  for the new home. Replace the "Vetchium home page" heading check with the plan
  and profile invitations, and change the `menuitem` count from 3 to 4.
- **"the single home entry remains usable on a narrow viewport":** expect 4 menu
  items: Home, My profile, Security, Plan.
- Re-read the assertions of the other tests that render the home page:
  - "an authenticated language change reaches the server and updates the
    session";
  - "a rejected authenticated language change keeps the current language";
  - "sign out clears the stored session and returns to sign in";
  - "password sign in stores the returned session and opens the home page".
- Grep `playwright/ui/` for `my-info` to find any others.

Before calling this done, walk the §4.2 response matrix and every behavior
above, and name a test for each row (`playwright.md`). The API coverage report
must show no undeclared status or problem type.

## 11. Glossary and documentation

**`agent-guides/glossary.md`** gains a `## Subscriptions` section:

- **Plan** — a Hub subscription tier identified by its plan OID, with a unique
  rank. A higher rank includes everything a lower rank allows.
- **Subscription** — a Hub user's single current plan, billing interval,
  period, and scheduled change, stored on the user's row in the home tenant.
- **Offered plans** — the plans a tenant sells, configured in both the backend
  and `hub-ui`.

**Fact:** the most recent commit renamed the marketplace term to
`ServiceConsumer`, freeing "Subscription" for this meaning.

**`docs/subscriptions-plans.md`:**

- Replace "Designed, not implemented" with the implementation date.
- Record the **user direction** rules from §2.1 as settled decisions:
  - 2026-09-12: the anchor-day, clamped period rule with its examples;
  - 2026-09-12: silver offered by all four production tenants;
  - 2026-09-13: period end is applied by the worker, or first by set-plan in
    its own transaction; `GET` computes it in memory; transitions written by
    `hub-api` use the `system` actor.
- Add a short "Implementation notes" section for the non-policy choices a
  future reader needs:
  - `_oid` naming;
  - subscription columns on `hub_users`;
  - `billing.Advance` as the single statement of period-end rules;
  - gated features read the committed plan, which can lag a due change until
    the worker or a set-plan writes it (§6.4);
  - CI fixture: `usa1` offers only the free plan;
  - literal portal variables with the consistency test;
  - portal behavior for unknown plans.
- Keep every open question unchanged.

**`AGENTS.md`** (and `CLAUDE.md` if it is a separate copy): the `docs/`
sentence links `subscriptions-plans.md`.

**`agent-guides/typespec.md`:** the problem-body rule (§4.4).

**`hub-ui/README.md` and `deploy/README.md`:** the changes in §9.2 and §9.3.

## 12. Implementation order

Each step leaves the tree building.

1. **Contract (§4).** `make typespec-check`, then `make test-go`.
2. **Schema and queries (§5).** `make sqlc`, then `make sql-check`. Read the
   generated diff for the generated column, the enum types, and nullability.
3. **Problem-body runtime change (§4.4, §7.4).** `go test ./...` in `backend`.
4. **Domain package (§6).**
5. **Configuration (§7.1),** with every checked-in config, compose, and stack
   file.
6. **Handlers, routes, wiring, and signup** (§7.2, §7.3, §5.2 item 5).
7. **Worker (§8).**
8. **`portal-ui` runtime config, then `hub-ui` (§9).** `make portal-ui-check
   admin-ui-check hub-ui-check`.
9. **Playwright (§10).** `make playwright-check`, then `make playwright-test`.
10. **Documentation (§11).**
11. **Final checks.** `make fmt`, then `make test`, `make test-go-lint`,
    `make test-go-vuln`, `make repository-json-check`, `git diff --check`,
    and `git status`.

## 13. Review checklist

Run `review.md` against the whole diff with the design document beside it, and
confirm:

- **Literals:** no plan OID literal in a handler, component, or query outside
  the named schema invariant and the seeded catalog. Ranks appear only in the
  contract.
- **One upgrade rule:** `IsUpgrade`, used by both the backend and `hub-ui`.
- **Period end:** `billing.Advance` is the only statement of the rules. The
  worker and set-plan write transitions, and `GET` computes them in memory and
  writes nothing.
- **Audit:**
  - every subscription write appends its events in the same statement, and
    all three counts are checked, including distinct audited users;
  - replays and unchanged requests write nothing;
  - an audit failure rolls back the change (§10.1 tests 2 and 12);
  - actors are only `anonymous` for creation, `hub_user`, `worker`, and
    `system` for transitions written by `hub-api`;
  - a catch-up after a scheduled change writes both events.
- **Instants:** every instant is truncated to microseconds, so the response,
  the replay, and the later `GET` agree.
- **Locking:**
  - subscription locks are `FOR NO KEY UPDATE`;
  - `at` is read after the row lock;
  - the worker never waits on a lock;
  - tests 13 and 14 pass.
- **`billing_interval: null`** is rejected in the contract, the handler, and
  Playwright.
- **Constraints:**
  - The presence constraint (`hub_users_free_plan_has_no_period`) and the
    scheduled-plan constraint use explicit null-determined branches.
  - The ordering constraint relies on the presence constraint for paid rows.
  - §10.1 test 15 passes.
- **Due period end before a change:** set-plan applies it first, in the same
  transaction, and never refuses a request for arriving late (§10.1 test 16).
- **Test cleanup:** Playwright tests delete the subscription audit rows they
  created.
- **No money from the browser:** no amount, price, or currency reaches the
  backend.
- **Offered plans agree** across `config/`, `config/ci/`, `deploy/`, both
  compose files, and every `stack.json`, and the consistency test passes.
- **Portal UI:**
  - no untranslated string, and `de` and `ta` are complete;
  - no deprecated Ant Design API;
  - loading, error, retry, and unknown-plan states exist and are tested.
- **Plan-required problem:** no operation declares it, and the design document
  still says so.
- **Scope:** nothing built for processors, payment records, proration, grace
  periods, migration, or withdrawal.
