# specs/ — Feature Specifications

This directory holds **spec-driven-development feature specs**: the requirements and
implementation plans for features that are **not yet built** (or in progress). It does **not**
hold the API contract or durable design docs — those live elsewhere:

| You want…                                  | Look in                                         |
| ------------------------------------------ | ----------------------------------------------- |
| The API contract (TypeSpec `.tsp` + types) | [`../api-schema/`](../api-schema/) — it's code  |
| How the system works & why (durable)       | [`../docs/`](../docs/) — ADRs, design, glossary |
| What we plan to build next                 | here                                            |

## The two-stage flow

Each spec is authored with the template in
[`spec-template-README.md`](./spec-template-README.md), driven by the slash commands:

1. `/new-spec` → **Stage 1: Requirements** (acceptance criteria, screens). Get it APPROVED.
2. `/fill-spec` → **Stage 2: Implementation Plan**.

Then implement against `../api-schema/` (contract first), the Go handlers, the UIs, and
Playwright tests.

## Lifecycle: what happens to a spec once it ships

A spec is forward-looking. Once a feature is fully implemented, the **code + tests become the
source of truth**, so the verbose spec is removed from `specs/`. Any durable design rationale
worth keeping (state machines, non-obvious decisions) is first **distilled into
[`../docs/design/`](../docs/design/)** — see `hiring-lifecycle.md` and `agency-referrals.md`,
which were distilled from now-deleted specs. Git history preserves the originals.

## Current contents

- `spec-template-README.md` — the spec template.
- `Ideas.md` — backlog of unscheduled enhancement ideas.
- `candidacy-discussion-improvements.md` — a not-yet-started feature PRD.
- `financial-calculator.html` — standalone SaaS financial-projection tool (kept here by choice).
