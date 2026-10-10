# Review

Applies to every change, before calling it done.

- Review the whole diff and the verification output, not a summary from
  memory. Use the assigned reviewer, else a separate self-review pass; give a
  reviewer the original request, not your plan.
- The task stays open while any correctness, security, authorization,
  data-integrity, contract, or test finding is unresolved.

## Check

- Requirement rebuilt from the request and repository, not from your tests.
  Record missing, extra, and deferred behavior ([`change-design.md`](change-design.md)).
- Positive, negative, boundary, retry, concurrency, and failure paths.
- Tenant isolation and authorization at every server-side boundary.
- Errors expose no credentials, account existence, private policy, or
  unneeded personal data.
- State transitions keep their invariants.
- Contracts agree across TypeSpec, Go, and TypeScript, with statuses, problems,
  defaults, optionality, and validation specified ([`typespec.md`](typespec.md)).
- Pagination, constraints, transactions, idempotency, and same-transaction
  audit follow [`database.md`](database.md); assume two requests pass an
  application check together.
- No hand-edited generated files, dead code, leftover diagnostics, or
  unrelated edits. Comments only for non-obvious intent.
- UI: accessibility, keyboard use, loading and error states, layout, every
  supported locale.
- For a permission-gated feature, verify a representative intended account can
  obtain the permission in each environment and reach the screen from the
  normal navigation; test the account without granting access in test setup.

## Tests

- Run what [`verification.md`](verification.md) lists for the change.
- Add focused tests for each new rule and regression at the lowest useful
  layer, plus integration or UI coverage where the boundary matters.
- A green suite does not close a design finding; tests can verify a wrong
  assumption.

## Report

- What was reviewed, findings and fixes, the exact commands that passed, and
  remaining risk with where it is tracked.
- A skipped or unknown required check keeps the task open unless the user
  accepts the gap.
