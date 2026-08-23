# Code Review Gate

Every coding activity requires a review pass after implementation and before it
is called done. Review the complete diff, not only the last edited file. A task
is not complete while the review has unresolved correctness, security,
authorization, data-integrity, API-contract, or test findings.

The review may be performed by another reviewer or as a separate self-review
pass when no reviewer is assigned. The reviewer must inspect the code and the
verification output; a summary written from memory is not a review.

## Scope and behavior

- Compare the diff with the request and record any missing, extra, or deferred
  behavior.
- Check positive, negative, boundary, retry, concurrency, and failure paths.
- Confirm tenant isolation and authorization at every server-side boundary.
- Check that errors do not expose credentials, account existence, private
  policy, or unnecessary personal data.
- Confirm that state transitions preserve their documented invariants.

## API and data design

- Keep the TypeSpec contract and the matching Go and TypeScript wire types in
  sync.
- Specify status codes, RFC 9457 problems, defaults, optional fields,
  normalization, validation, and authorization requirements.
- Use keyset pagination for APIs whose result can grow into a long list. Check
  that the ordering is deterministic, the pagination key is bound to filters,
  and the query shape can use suitable indexes. Follow the database guide when
  deciding whether to add performance indexes now. Do not use offset
  pagination for such APIs.
- Check database constraints as well as application validation. Assume
  concurrent requests can pass application checks at the same time.
- Review transaction boundaries, idempotency, foreign keys, uniqueness,
  lifecycle behavior, and query plans where they matter.
- For every database write, verify that the same transaction appends the
  durable audit event required by `database.md`, including safe actor, entity,
  change, and correlation context. Check rollback, retry, bulk-write, and
  sensitive-data behavior; application logs do not satisfy this requirement.
- Do not hand-edit generated files. Review the source and regenerated output
  together.

## Code and language

- Use simple technical English in names, messages, documentation, and UI text.
- Remove verbose, namesake, and decorative comments. Keep comments only for
  non-obvious intent, invariants, tradeoffs, or external requirements that the
  code cannot express.
- Remove dead code, temporary diagnostics, copied boilerplate, and unrelated
  changes.
- Follow every applicable `AGENTS.md` file and guide under `agent-guides/`.
- For UI changes, review accessibility, keyboard behavior, loading and error
  states, responsive layout, and every supported locale.

## Verification

- Run the formatters, generators, linters, static analysis, type checks,
  compilers, and tests required by the applicable guides.
- Require clean results with no new warnings or errors. Do not hide failures by
  weakening a rule or excluding changed code.
- Add focused tests for every new rule and regression. Include positive,
  negative, and edge cases at the lowest useful layer, then integration or UI
  coverage where the boundary matters.
- Inspect generated schemas, SQL, snapshots, or other artifacts when a tool can
  succeed while producing the wrong shape.
- Run `git diff --check` and inspect `git status` before committing so generated
  output, temporary files, and unrelated edits are not included accidentally.

## Completion record

Before calling the activity done, report:

- what the review covered;
- the findings and how they were resolved;
- the exact verification commands or suites that passed;
- any remaining risk or intentionally deferred work, with its tracking
  location.

Do not describe a coding activity as complete if required checks were not run
or if their result is unknown. State the limitation plainly and keep the task
open unless the user accepts the exception.
