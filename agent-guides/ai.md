# AI

Applies to AI operations, the model catalog, AI credits, usage metering, kept
prompts, and the `ai-dev` stand-in. Compose with [`backend.md`](backend.md),
[`database.md`](database.md), [`org-subscriptions.md`](org-subscriptions.md)
(entitlements), and [`authorization.md`](authorization.md). Only Org AI is
built; Hub AI is in [`../docs/todo.md`](../docs/todo.md).

## Layers

- Keep four concerns apart: the model (a Vetchium OID), its host (tenant
  config), metering (the usage ledger), and charging (credit lots).
- A model is not a host. Run a model only on a host in the tenant's own
  region; never call a vendor's API that sends data out of the region, and
  never call another tenant's model over the mesh.
- Code against the OpenAI-compatible chat completions protocol
  (`backend/internal/chatmodel`), not a server product. Docker Model Runner,
  vLLM, and llama.cpp all serve it.
- No external gateway (OpenRouter or similar) and no customer API keys. An Org
  with its own provider uses MCP instead.

## Catalog

- Tenant config `ai` is the only authority for offered models, their host
  (`baseURL`, `hostModel`, optional `apiKeyFile`), credit rates, packs,
  operation defaults, timeouts, and text retention
  (`backend/internal/appconfig/ai.go`). A tenant without the block offers no
  AI: every AI route answers `org-ai-unavailable` and portals hide AI.
- A model OID is a stable lowercase slug, independent of the host model id. A
  model with `withdrawsAt` is `deprecated` until then and not offered from
  then on. An operation default must name a model without a withdrawal date.
- Rates are charged, so the server owns them and the API lists them; portals
  never compile prices or rates.
- Record each model's licence and check it before offering the model.
- A tenant's packs share one currency, the tenant's.

## Operations

- An operation (`org-opening-draft`) is a contract enum. Its required
  permission and the permission that reads its kept text live in
  `internal/orgs/ai` (`OperationPermission`, `TextReadPermission`); an
  operation the code does not know is runnable and readable by nobody.
- Output only fills something a person reviews and saves through the normal
  write (drafting returns `OpeningContent`; nothing is saved). Run the
  operation's own validators on the output, keep the valid fields, and report
  the dropped ones. No usable field is `org-ai-output-unusable`.
- The model gets no tool with side effects. Treat every input as untrusted
  data; the system prompt says so.
- Prefer structured output (`jsonSchemaOutput`) and strip `<think>` blocks
  and Markdown fences from answers.

## Org policy

- `org:manage_ai` (implied by `org:superadmin`; only a superadmin grants it)
  turns AI on, accepts the AI terms, sets per-operation policies, buys packs,
  and reads usage.
- Turning AI on needs `OrgAITermsVersion` accepted, now or earlier; a stale
  version is refused with `org-ai-terms-required`. Acceptance is recorded with
  who and when. Changing the terms text means a new version.
- A policy lists allowed models and a default among them. Without a policy an
  operation allows every offered model and preselects the region default. A
  stored model the region no longer offers drops out; a withdrawn default
  falls back to the region default.
- Saving unchanged settings writes nothing.

## Credits

- Credits are integers. A call costs
  `ceil((input × inputRate + output × outputRate) / 1,000,000)`
  (`internal/aicredits`).
- Lots: a `grant` per UTC month for plans with `ai_credits_per_month`
  (lapses at month end, usable only while the plan has `allows_ai`), and a
  `purchase` per pack (expires twelve months after purchase, usable on any
  plan). Spend grants first, then purchases by earliest expiry.
- Running an operation needs AI on and either a plan with `allows_ai` or
  purchased credits left; otherwise `org-plan-required` naming Gold. Buying a
  pack needs `allows_ai`.
- Payment is simulated: buying grants the lot at once and the audit records
  `payment: simulated`. Real payments follow
  [`org-subscriptions.md`](org-subscriptions.md).
- The `workers` grant job issues the month's grant to every active Org on a
  plan with monthly credits, at most once per Org and month.

## Metering

- One ledger row per model call (`org_ai_usage`). Never hold a transaction
  across a model call:
  1. Reserve: lock the idempotency key, then the Org's credit advisory lock;
     check every precondition; reserve the worst case
     (`aicredits.Reservation`: prompt bytes bound input tokens, plus the
     operation's maximum output); insert the `reserved` row. A shortfall is
     `org-ai-credits-insufficient` and reserves nothing.
  2. Call the model with the tenant's request timeout.
  3. Settle a usable answer: lock the row, charge `min(actual, reserved)`
     across usable lots, keep the text, store the replay. Release a failure:
     charge nothing, keep the text and any answer.
- Every lock order is idempotency key, credit lock, usage row.
- Token counts come from the host's `usage`; an answer without usage is a
  model failure.
- Charge nothing for a host error, timeout, missing usage, unusable output, or
  a reservation the reaper abandoned (`reservationTimeout`, which exceeds
  `requestTimeout`).
- A replay returns the stored answer without charging. A failed attempt keeps
  its idempotency record incomplete, so the same key may retry; a second
  request while one is reserved is `org-ai-request-in-progress`.
- Settling and releasing run on a context detached from the request, so a
  client that disconnects cannot strand a reservation.

## Kept text

- Keep every call's prompt messages and answer for the tenant's
  `textRetention` (180 days initially); a worker deletes it afterwards.
- An Org user reads kept text only with `org:manage_ai` and the operation's
  read permission; otherwise `org-ai-usage-not-found`.
- A tenant administrator reads it with `admin:view_ai_usage`; the read and its
  audit event are one statement.

## Development and tests

- `cmd/ai-dev` relays to Docker Model Runner in development
  (`AI_DEV_UPSTREAM`) and is a deterministic fake in CI. Never deploy it.
- The fake's tokens are a quarter of the characters, rounded up. Markers in the
  request choose failures: `[ai-dev:fail]`, `[ai-dev:slow]` (outlasts the CI
  request timeout), `[ai-dev:no-usage]`, `[ai-dev:invalid]`,
  `[ai-dev:partial]`.
- `orgs-api-unavailable` has no `ai` block; use it for
  `org-ai-unavailable`.
- Keep the development models in `make dev-ai-models` equal to the
  `hostModel` values in `config/*.json`.
