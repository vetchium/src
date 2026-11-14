# T15 Opening search: Finish the build

## Requirements

All OPN-SRCH and PROF-JOB requirements, HP-APP-002, OPN-TST-005.

## Guides

`agent-guides/review.md`, `agent-guides/verification.md`,
`agent-guides/feature-build.md`.

## Exemplars

Commit `9b8effa` (Opening tags: Finish the build).

## Steps

1. Map every OPN-SRCH and PROF-JOB requirement, HP-APP-002's ideal job,
   and every contract response of the new and changed operations to a named
   test; add any that is missing.
2. `docs/todo.md`: rewrite the Openings "Cross-Org discovery" item to what
   remains (searching several regions at once, ranking and pagination
   across tenants, entry points from profile employer domains), and add
   saved searches with alerts, keyword search over descriptions,
   prefilling from preferred job countries, and future uses of
   `looking_for_job` (agency outreach, matching), each needing its own
   privacy review (OPN-SRCH-014, PROF-JOB-004).
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
