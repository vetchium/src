# docs/ — Engineering Knowledge Base

Durable "how the system works and why" documentation. Stable reference material, distinct from
[`../specs/`](../specs/) (what we _plan_ to build) and [`../api-schema/`](../api-schema/) (the API
contract, which is code).

**For AI tools / new contributors:** before generating or changing code, consult the
[glossary](./glossary.md) for domain terms, the relevant [ADR](./adr/) for architectural
constraints, and the [design](./design/) docs for feature state machines and invariants.

## Layout

| Path                                                       | Contents                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`adr/`](./adr/)                                           | Architecture Decision Records — one cross-cutting decision per file                         |
| [`design/`](./design/)                                     | Durable design references (domain state machines, invariants), distilled from shipped specs |
| [`runbooks/`](./runbooks/)                                 | Operational runbooks (add a region, production deployment)                                  |
| [`glossary.md`](./glossary.md)                             | Domain vocabulary (portals, entities, architecture terms)                                   |
| [`api-ui-inconsistencies.md`](./api-ui-inconsistencies.md) | Tracker of known convention violations being phased out                                     |
| [`known-issues.md`](./known-issues.md)                     | Outstanding bugs / usability issues from exploratory test runs                              |

## Decisions vs design vs proposals

- **ADR** (`adr/`) — records a single architectural decision and why alternatives were rejected.
- **Design** (`design/`) — durable reference for how a feature/domain behaves (the distilled
  essence of an implemented spec).
- **Proposal** (`../specs/`) — a feature not yet built. Once built, its durable parts move into
  `design/` and the proposal is removed.
