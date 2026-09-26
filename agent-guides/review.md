# Review Gate

Every coding activity gets a review pass after implementation and before it is
called done. Review the whole diff, not the last file edited, and inspect the
code and verification output; a summary from memory is not a review. Use an
assigned reviewer, otherwise a separate self-review pass. The task stays open
while any correctness, security, authorization, data-integrity, API-contract, or
test finding is unresolved.

## Requirement and scope

- Reconstruct the requirement from the original request and repository
  evidence, not the implementer's plan, summary, or tests. Apply
  [`change-design.md`](change-design.md) to every material inference, especially
  a shared abstraction that may be shared policy rather than shared mechanism.
- Compare the diff with the request; record missing, extra, and deferred
  behavior.
- Check positive, negative, boundary, retry, concurrency, and failure paths.
- Confirm tenant isolation and authorization at every server-side boundary.
- Confirm errors expose no credentials, account existence, private policy, or
  unnecessary personal data.
- Confirm state transitions keep their documented invariants.

## API and data

- TypeSpec, Go, and TypeScript wire types agree ([`typespec.md`](typespec.md)).
- Status codes, RFC 9457 problems, defaults, optionality, normalization,
  validation, and authorization are all specified.
- Growable lists use keyset pagination with deterministic ordering, a key bound
  to the filters, and an index-friendly query shape; never offset.
- Database constraints back application validation; assume two concurrent
  requests pass the application check together.
- Transactions, idempotency, foreign keys, uniqueness, lifecycle, and the
  same-transaction audit event are correct per [`database.md`](database.md).
  Application logs are not audit records.
- No hand-edited generated files; review source and regenerated output together.

## Code

- Simple technical English in names, messages, docs, and UI text.
- Comments only for non-obvious intent, invariants, tradeoffs, or external
  requirements; delete namesake and decorative ones.
- No dead code, leftover diagnostics, copied boilerplate, or unrelated edits.
- Every applicable `AGENTS.md` and `agent-guides/` rule is followed.
- UI: accessibility, keyboard behavior, loading and error states, responsive
  layout, every supported locale.

## Tests and verification

- Run everything in [`verification.md`](verification.md) that applies.
- Add focused tests for each new rule and regression (positive, negative, edge)
  at the lowest useful layer, then integration or UI coverage where the boundary
  matters.
- A green suite does not close a requirements or design finding; tests can
  faithfully verify a wrong assumption. Re-check against the ownership map, and
  give the reviewer the original request so they challenge assumptions and scope
  rather than confirm your summary.

## Completion record

Report what the review covered, findings and their resolution, the exact
commands or suites that passed, and remaining risk or deferred work with where
it is tracked. Do not call work complete when a required check was skipped or
its result is unknown: state the limitation and keep the task open unless the
user accepts the exception.
