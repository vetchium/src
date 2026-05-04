# Phase 1 Implementation Plan

This is the orchestration document that tells a Haiku-tier implementer what to build, in what order, and where each spec lives. Every step's _details_ live inside the linked spec — this file is purely the order-of-operations.

## Spec inventory

| #   | Spec              | Path                                | Status                  |
| --- | ----------------- | ----------------------------------- | ----------------------- |
| 1   | Company Addresses | `specs/company-addresses/README.md` | Stage 1 + Stage 2 ready |
| 2   | Hub Profile       | `specs/hub-profile/README.md`       | Stage 1 + Stage 2 ready |
| 3   | Hub Employer IDs  | `specs/hub-employer-ids/README.md`  | Stage 1 + Stage 2 ready |
| 4   | Hub Connections   | `specs/hub-connections/README.md`   | Stage 1 + Stage 2 ready |
| 5   | Job Openings      | `specs/job-openings/README.md`      | Stage 1 + Stage 2 ready |

Glossary lives at `specs/Glossary.md`. The cross-spec rules in `CLAUDE.md` (HTTP conventions, transaction patterns, RBAC test policy, etc.) apply to **every** step below.

## Dependency graph

```
                       ┌──────────────────────────┐
                       │  company-addresses (1)   │
                       └──────────┬───────────────┘
                                  │ (org address book; on_site/hybrid openings reference one or more)
                                  ▼
                       ┌──────────────────────────┐
                       │     job-openings (5)     │
                       └──────────────────────────┘

                       ┌──────────────────────────┐
                       │    hub-profile (2)       │ ← exact-handle profile pages, photo, bio
                       └──────────┬───────────────┘
                                  │
                                  │ (page chrome hosts the connect-button widget;
                                  │  also renders verified-employers card)
                                  ▼
                       ┌──────────────────────────┐
                       │ hub-employer-ids (3)     │ ← work-email stints, verification, re-verify worker
                       └──────────┬───────────────┘
                                  │ (overlapping stints gate eligibility)
                                  ▼
                       ┌──────────────────────────┐
                       │   hub-connections (4)    │ ← send/accept/reject/withdraw/disconnect/block/unblock
                       └──────────────────────────┘
```

`company-addresses` is independent of all the Hub specs; `job-openings` depends on it. The Hub branch (profile → employer-ids → connections) is independent of the Org branch and can run in parallel.

## Recommended implementation order

If a single team / single implementer works in series:

1. **company-addresses** (independent; smallest change)
2. **hub-profile** (adds columns to `hub_users`; lays the page chrome that hub-connections will plug into)
3. **hub-employer-ids** (introduces the stints table + global mirror + workers)
4. **hub-connections** (joins on stints; renders into hub-profile's widget slot)
5. **job-openings** (org-side feature; can actually start in parallel after step 1, since it does not touch hub specs)

If two parallel implementers are available, they can run:

- Track A: `company-addresses` → `job-openings`
- Track B: `hub-profile` → `hub-employer-ids` → `hub-connections`

## What lands in shared files

These files are touched by multiple specs and must be merged carefully:

- `api-server/db/migrations/regional/00000000000001_initial_schema.sql` — regional schema. Each spec's "Database Schema" section lists its additions; never delete an existing block.
- `api-server/db/migrations/global/00000000000001_initial_schema.sql` — global schema. `hub-employer-ids` adds `hub_work_email_index` and `personal_domain_blocklist` and seeds the latter; `hub-connections` adds `hub_connection_pair_routes` and `hub_block_routes`. `hub-profile` adds nothing new globally.
- `specs/typespec/common/roles.ts` and `roles.go` — append to `VALID_ROLE_NAMES`. Every spec's RBAC section names the constants to add. Never reorder existing entries.
- `specs/typespec/{hub,org,admin}/<feature>.tsp/.ts/.go` — one new feature file per spec; cross-feature imports use the package convention spelled out in CLAUDE.md.
- `playwright/lib/db.ts` and `playwright/lib/{hub,org,admin}-api-client.ts` — each spec lists the new helpers and client methods to add. They are additive only.

## RBAC roles introduced

Every new role must land in `roles.ts`, `roles.go`, the relevant `<portal>-users.{ts,go}` constants file, AND the `roles` seed in the appropriate initial-schema migration.

| Role                                     | Portal | Spec              |
| ---------------------------------------- | ------ | ----------------- |
| `org:view_addresses`                     | org    | company-addresses |
| `org:manage_addresses`                   | org    | company-addresses |
| `org:view_openings`                      | org    | job-openings      |
| `org:manage_openings`                    | org    | job-openings      |
| `admin:manage_personal_domain_blocklist` | admin  | hub-employer-ids  |

`hub-profile` and `hub-connections` add **no** new roles — `HubAuth` plus an active session is sufficient.

## Workers introduced

| Worker                                        | Cadence    | Spec             |
| --------------------------------------------- | ---------- | ---------------- |
| `expire_pending_work_emails`                  | 30 minutes | hub-employer-ids |
| `manage_active_work_emails` (issue + timeout) | 6 hours    | hub-employer-ids |
| `expire_openings`                             | 6 hours    | job-openings     |

Each worker runs per-region and writes audit-log rows with `actor_user_id = NULL`.

## Endpoint count

| Spec              | Hub    | Org    | Admin | Worker |
| ----------------- | ------ | ------ | ----- | ------ |
| company-addresses | 0      | 6      | 0     | 0      |
| hub-profile       | 6      | 0      | 0     | 0      |
| hub-employer-ids  | 8      | 0      | 3     | 2      |
| hub-connections   | 14     | 0      | 0     | 0      |
| job-openings      | 0      | 13     | 0     | 1      |
| **total**         | **28** | **19** | **3** | **3**  |

## Per-spec implementation checklist

For each spec, the implementer follows this sequence (the spec itself contains the per-step detail):

1. **Schema** — extend the relevant `00000000000001_initial_schema.sql` with the spec's new tables, ENUM types, indexes, partial unique constraints, and RBAC role seeds. Run `goose up` and confirm clean migration on a fresh DB.
2. **TypeSpec / TS / Go types** — add `.tsp` and matching `.ts` + `.go` under `specs/typespec/...` per the spec's "API Contract" section. Run `cd specs/typespec && bun install && tsp compile .`. The validators (`validate{TypeName}`) must mirror the field-constraint table.
3. **sqlc queries** — add the queries from the spec's "sqlc Queries" section, then `cd api-server && sqlc generate`.
4. **Handlers** — implement each handler following the spec's per-handler step list. Use `s.WithRegionalTx` / `s.WithGlobalTx` for every write; emit audit log entries inside the same transaction. Per CLAUDE.md, do not exceed one round-trip per logical DB per request.
5. **Route registration** — register handlers in `api-server/internal/routes/{hub,org,admin}-routes.go` per the spec's "Endpoint registration" snippet. Wrap with the documented middleware chain.
6. **Workers** — for any worker the spec defines, add the file under `api-server/cmd/regional-worker/...` and register it in the worker scheduler.
7. **Frontend pages** — add the routes from the spec's "New Routes" table; implement each page per the layout description, importing types from `vetchium-specs/...`. Wrap network calls with `<Spin>`. Disable submit while validation errors remain.
8. **i18n** — add the `en-US`, `de-DE`, `ta-IN` keys from the spec's "i18n" section. `de-DE` and `ta-IN` may start as English-text placeholders; do not skip the files.
9. **Playwright tests** — implement the matrix in the spec's "Test Matrix" section. Add `db.ts` helpers and `*-api-client.ts` methods first; then write tests. Cover RBAC positive + negative pairs (where applicable), all 4xx codes, audit-log presence/absence, and cross-region scenarios where listed.
10. **Regression** — run the full Playwright suite. `docker compose -f docker-compose-ci.json up --build -d` then `cd playwright && npm test`.

## What the implementer should NOT do

- Do not invent endpoints, fields, or state-machine transitions that are not in the relevant spec.
- Do not deviate from the spec's HTTP status codes (especially the custom 4xx codes in `hub-connections`).
- Do not write SQL inside Go files; all queries live in `*.sql` files via sqlc.
- Do not add new typespec features without updating both `.ts` and `.go` to match.
- Do not skip `de-DE` or `ta-IN` placeholder translation files; CI will lint for parity.
- Do not auto-archive, auto-extend, or otherwise touch state machines beyond the documented transitions.
- Do not use deprecated APIs from any library; run `bun run lint` before committing.

## When the implementation is done

The five Phase 1 specs are complete when:

- All 50 endpoints + 3 workers in the table above are live and pass the Playwright suite.
- Every audit-log event listed across the five specs writes inside the originating transaction and never on a 4xx path.
- The schema migrations apply cleanly on a fresh DB; no out-of-band migrations are required.
- The RBAC roles are seeded and at least one positive + one negative test exists per role-protected endpoint.
- `cd api-server && go build ./... && go vet ./...` is clean.
- `cd hub-ui && bun run build && bun run lint` is clean (also for `org-ui` and `admin-ui`).
- `cd specs/typespec && tsp compile .` is clean.

After Phase 1 lands, the next-phase specs `hub-job-discovery` and `hub-job-applications` can be drafted; they will reuse the connections + employer-ids primitives that this phase ships.
