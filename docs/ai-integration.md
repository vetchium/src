# AI integration — design spec

Status: design on `features/ai-integration-init`. Temporary: at
implementation, distil the rules into `agent-guides/` (a new `ai.md` plus
updates to the subscription, openings, authorization, and backend guides),
move unresolved items to `todo.md`, and delete this file.

Representative operations (examples, not a feature list): an Org drafting an
Opening, an Org scoring candidates, a Hub user writing a blog post.

## 1. Decisions

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Billing unit | Vetchium AI credits. Each model has a credit rate per 1M input and per 1M output tokens; a credit has a price per tenant currency |
| D2 | Org payment | Prepaid credit packs, plus a monthly included grant by plan |
| D3 | Org access | Gold only: AI operations, monthly grant, and pack purchase need `org-gold-tier` |
| D4 | Hub access | Paid plans only (`hub-silver-tier`): monthly included grant plus prepaid packs |
| D5 | Credit expiry | Monthly grant lapses at the end of its month; purchased credits expire 12 months after purchase |
| D6 | Downgrade | Purchased credits stay usable after leaving the plan; only the monthly grant and new purchases need the plan |
| D7 | Model gate | Price is the only gate; no model needs a particular plan |
| D8 | Hosting | Self-hosted GPUs from day one, in each AI tenant |
| D9 | Third parties | Frontier models (Claude, GPT, Gemini) designed for, not launched. No bring-your-own-key; Orgs that want their own provider use MCP |
| D10 | Failures | Host error or timeout: free. User cancel: pay tokens produced. Crash-abandoned reservation: free. Output failing Vetchium validators: free |
| D11 | Retention | Keep prompt and output text for every call for a per-tenant period, 180 days everywhere initially |
| D12 | Text access | Tenant Admins with a new permission (every read audited), and the account itself |
| D13 | Response mode | Complete JSON responses in v1; no streaming |
| D14 | Topology | A shared Go package called from `orgs-api`, `hub-api`, and `workers`; no separate AI service |
| D15 | Pre-launch | Pack purchase is simulated: free and immediate, shown as not charged during development, like plan changes |
| D16 | Gateways | No OpenRouter or other external gateway |

## 2. Layers

| Layer | Question | Owner |
| --- | --- | --- |
| Model | Which model family (Gemma, Mistral, DeepSeek, Qwen, Vetchium's own) | Product catalog |
| Host | Where it runs: Vetchium GPUs in region now; a third-party in-region API later | Tenant config |
| Metering | What was consumed, by whom, for which operation | Per-tenant usage ledger |
| Charging | How consumption draws down credits, and how credits are bought | Credit ledger; later the payment provider |

- A model is not a host. DeepSeek in DEU means DeepSeek weights on Vetchium
  GPUs in DEU, never DeepSeek's own API.

## 3. Model catalog

- Each model has a stable Vetchium OID (e.g. `ai-gemma-3-27b`), independent of
  the host's model id, declared as an extensible value on responses.
- Tenant config is authoritative, in an `ai` block. A tenant without the block
  offers no AI, and its portals hide AI. Per model:
  - OID, display name, vendor, licence
  - host base URL, host model id, optional secret file
  - capabilities: context length, JSON-schema output, languages
  - credit rates per 1M input and output tokens, with a price version
  - status: `offered`, `deprecated` (with a withdrawal date), `withdrawn`
- The same block holds the credit price per pack, the packs offered, and the
  text retention period (D11).
- Metered rates are charged, so the server owns them: an API lists the
  tenant's models, rates, and packs. Portals never compile them, unlike plan
  display prices.
- Withdrawing a model moves Org policies that use it to the tenant default for
  that operation, and the Org is told. Ledger rows keep the OID forever.
- Licences travel with the weights; record each and check it before offering:
  DeepSeek V3/R1 MIT; DeepSeek distills follow their base (Qwen or Llama);
  most Qwen Apache 2.0; Mistral varies per model; Gemma (at least Gemma 3) has
  the Gemma Terms with a prohibited-use policy passed down to users. A
  Vetchium fine-tune inherits its base licence.
- Initial intent: `usa1`, `sgp`, `ind1` offer Gemma; `deu` offers DeepSeek and
  Mistral; a future China tenant DeepSeek and Qwen (needs filing and labelling
  there). Any tenant may add Vetchium's own models. Exact versions and sizes
  follow GPU sizing (section 6).

## 4. Operations

A registry in code; each operation declares:

- OID (e.g. `org.opening.draft`, `org.candidate.score`, `hub.post.assist`),
  owner portal, and the existing permission it needs (drafting needs
  `org:manage_openings`; there is no generic "use AI" permission).
- Mode: interactive (in `orgs-api`/`hub-api`, complete JSON response) or batch
  (a `workers` job).
- Required capabilities, max input and output tokens, prompt template version,
  output schema.

Rules:

- Output only fills something a person reviews (e.g. an Opening working copy)
  and passes the same validators as human input.
- The model gets no tool with side effects. Every input (a resume, a post) is
  untrusted; prompt injection can only change the returned text.
- Batch jobs show an estimated credit cost and need confirmation; each item
  reserves and settles on its own; the job stops cleanly when credits run out.

## 5. Choice per operation

- New Org permission `org:manage_ai`, implied by `org:superadmin`; only a
  superadmin grants it. It allows: enabling AI, accepting the AI terms addendum
  (recorded by version, like `OrgTermsVersion`), choosing allowed models and a
  default per operation, buying packs, and reading the Org's AI history.
- A user running an operation picks among the allowed models and sees the
  estimated credit cost first.
- A Hub user picks per operation among the tenant's models.

## 6. Hosting

- Every AI tenant runs its own model servers on GPUs in its region, reachable
  only on the tenant's private network; no Traefik route.
- Code against the OpenAI-compatible chat completions protocol, not a product.
  Docker Model Runner serves development and may serve production through its
  vLLM backend (Linux, NVIDIA); plain vLLM or SGLang can replace it without
  code changes.
- GPU sizing decides model sizes: DeepSeek V3/R1 at full size needs a
  multi-GPU node; distills, Mistral Small, and Gemma fit one GPU. Decide per
  tenant before choosing versions.
- Capacity is a fixed cost whatever the usage; credit rates must cover it.
- Back-pressure: a per-call deadline and a bounded wait on the model server's
  queue. Exhausted capacity is a `503` AI-busy problem, charged nothing.
- Third-party hosts later (D9) are another host kind in the same catalog, only
  through in-region enterprise endpoints with a data processing agreement.
- MCP is the answer for Orgs with their own provider: their assistant calls
  Vetchium operations through `mcp-server` under the user's permissions.
  Vetchium stores no customer key.

## 7. Credits

- Credit lots per billing account (an Org, or a Hub user): `grant` (monthly,
  lapses at month end) or `purchase` (expires 12 months after purchase), each
  with amount, remaining, and expiry.
- Spending order: the current monthly grant, then purchased lots by earliest
  expiry.
- A worker issues the monthly grant on the first of the month, UTC, to every
  account whose plan includes it. The amount is a plan entitlement
  (`ai_credits_per_month`) in the plan contracts; zero below Gold for Orgs and
  below Silver for Hub users.
- Using AI needs either a plan that includes AI or a positive purchased
  balance (D6). Buying a pack needs the plan.
- Packs and their prices are per tenant, in the tenant currency. The server
  maps tenant and pack to the charged amount; never accept an amount from the
  browser.
- Before real payments: buying a pack grants the lot at once, shown as not
  charged during development (D15). After: a lot is granted only from a
  verified payment-provider event; refunds, tax, and invoices follow the
  payments project.

## 8. Metering

Usage ledger, one row per model call, in the tenant database:

- billing account, acting user, operation OID, model OID, host, input, output,
  and cached tokens, rate price version, credits charged, state (`reserved`,
  `settled`, `released`, `abandoned`), failure reason, idempotency key,
  timestamps.

Flow (never hold a transaction across a model call):

1. Transaction 1 locks the account's credit row (not the Org row) and reserves
   the worst case: input tokens plus max output tokens, at the model's rates.
   Not enough credits is a refusal that charges nothing.
2. Call the model.
3. Transaction 2 settles the actual usage per D10 and releases the rest.
4. A worker marks stale reservations `abandoned` and releases them.

- Token counts come from the host's `usage` field.
- Tokens differ between models; rates are per model.
- Limits: a Vetchium safety limit per plan (plus Traefik rate limits) and the
  credit balance; the stricter applies.
- AI policy changes and pack purchases write audit events; the ledger is the
  usage record.

## 9. Retention and access (D11, D12)

- Store prompt and output text for every call, keyed by the ledger row, in the
  tenant. A worker deletes it after the tenant's retention period (180 days
  initially).
- Tenant Admins read it with a new admin permission; every read writes an
  audit event.
- The account reads its own history: an Org through `org:manage_ai`, a Hub user
  their own. An Org user sees a call's text only if they may also read the
  underlying resource (e.g. the candidate or Opening); otherwise metadata only.
- Disclose retention and Admin access in the Hub and Org terms and the AI terms
  addendum. Account deletion (not built) must delete the text.

## 10. Tenancy and legal

- Inference runs in the billing account's home tenant on that tenant's
  catalog. Never call another tenant's model over the mesh; the global
  coordinator is not involved.
- A DEU Org scoring a USA1 candidate infers in DEU on data the application flow
  already gave the Org; AI moves no extra data between regions.
- Candidate scoring is a high-risk system under the EU AI Act (Annex III,
  employment). Shipping it under Vetchium's name makes Vetchium its provider:
  risk management, logging, human oversight, transparency. The application
  dates are in flux; verify at implementation. The 180-day retention matches
  the Act's six-month minimum for deployer logs.
- USA1: NYC Local Law 144 (bias audits for automated employment decision
  tools). GDPR Art. 22 (automated decisions).

## 11. Development and CI

- Development: Docker Model Runner with a small model (e.g. `ai/smollm2` or
  `ai/gemma3` 1B Q4), declared through Compose `models:` and the Tiltfile.
- CI: `cmd/ai-dev`, a fake OpenAI-compatible server like `cmd/oidc-dev`,
  returning deterministic output and token counts, with switches for errors,
  timeouts, and invalid output so Playwright asserts metering, reservations,
  races, and D10. Never in `deploy/`.
- `dev-seed` gives the Gold Org and a Silver Hub user AI policies, a purchased
  pack, and some usage.

## 12. Still open

- Credit price per tenant, pack sizes, monthly grant amounts, per-model rates.
- GPU sizing and exact model versions per tenant.
- AI terms addendum text; Hub and Org terms changes for retention and Admin
  access.
- Refunds, tax, and invoices for packs (with the payments project).
- The name of the admin permission and whether reading text needs step-up.
