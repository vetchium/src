# T08 Opening search: Finish the build

## Requirements

All OPN-SRCH requirements, OPN-TST-005.

## Guides

`agent-guides/review.md`, `agent-guides/verification.md`,
`agent-guides/feature-build.md`.

## Exemplars

Commit `9b8effa` (Opening tags: Finish the build).

## Steps

1. Map every OPN-SRCH requirement and every contract response of the new
   operations to a named test; add any that is missing.
2. `docs/todo.md`: rewrite the Openings "Cross-Org discovery" item to what
   remains (searching several regions at once, ranking and pagination
   across tenants, entry points from profile employer domains), and add
   saved searches with alerts, description full-text search, and
   prefilling from preferred job countries.
3. `README.md`: only if a developer-facing command, service, configuration,
   or seeded account changed.
4. Run `make test`.
5. Remove `.builds/opening-search/` (the commit script does this after the
   last task).

## Tests

The full suite.

## Checks

`make test`.

## Acceptance

- `make test` passes, `docs/todo.md` lists the deferred search work, and the
  build directory is gone.

## Carried over
