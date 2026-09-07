# Review Gate

Every coding activity gets a review pass after implementation and before it is
called done. Review the whole diff, not the last file edited. Inspect the code
and the verification output; a summary written from memory is not a review. Use
a reviewer when one is assigned, otherwise a separate self-review pass. The task
stays open while any correctness, security, authorization, data-integrity,
API-contract, or test finding is unresolved.

## Requirement and scope

- Reconstruct the requirement from the original request and repository
  evidence. The implementer's plan, summary, and tests are not proof that a
  design assumption is right. Apply [`change-design.md`](change-design.md) to
  every material inference, especially a shared abstraction that may be shared
  policy rather than shared mechanism.
- Compare the diff with the request. Record missing, extra, and deferred
  behavior.
- Check positive, negative, boundary, retry, concurrency, and failure paths.
- Confirm tenant isolation and authorization at every server-side boundary.
- Confirm errors expose no credentials, account existence, private policy, or
  unnecessary personal data.
- Confirm state transitions keep their documented invariants.

## API and data

- TypeSpec, Go, and TypeScript wire types agree, per
  [`typespec.md`](typespec.md).
- Status codes, RFC 9457 problems, defaults, optionality, normalization,
  validation, and authorization are all specified.
- Growable lists use keyset pagination, never offset: deterministic ordering,
  pagination key bound to the filters, index-friendly query shape.
- Database constraints back application validation. Assume two concurrent
  requests pass the application check at the same time.
- Transaction boundaries, idempotency, foreign keys, uniqueness, and lifecycle
  behavior are correct, per [`database.md`](database.md).
- Every committed write appends its audit event in the same transaction, with
  safe actor, entity, change, and correlation context. Check rollback, retry,
  bulk, and sensitive-data behavior. Application logs do not satisfy this.
- No hand-edited generated files. Review source and regenerated output
  together.

## Code

- Simple technical English in names, messages, documentation, and UI text.
- Comments only for non-obvious intent, invariants, tradeoffs, or external
  requirements. Delete namesake and decorative ones.
- No dead code, leftover diagnostics, copied boilerplate, or unrelated edits.
- Every applicable `AGENTS.md` and `agent-guides/` rule is followed.
- UI changes: accessibility, keyboard behavior, loading and error states,
  responsive layout, every supported locale.

## Tests and verification

- Run everything in [`verification.md`](verification.md) that applies.
- Add focused tests for each new rule and regression: positive, negative, and
  edge cases at the lowest useful layer, then integration or UI coverage where
  the boundary matters.
- A green suite does not close a requirements or design finding. Tests can
  faithfully verify a wrong assumption; re-check against the ownership map.

## Completion record

Report what the review covered, the findings and their resolution, the exact
commands or suites that passed, and any remaining risk or deferred work with
where it is tracked.

Do not call an activity complete when a required check was skipped or its
result is unknown. State the limitation and keep the task open unless the user
accepts the exception.
