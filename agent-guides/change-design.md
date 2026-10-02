# Change design

Applies to every change, before implementing.

## Facts

- Read the request, the contracts and guides that apply, the code, tests,
  configuration, and recent commits in the area.
- Evidence rank: request > contract > code > tests > commit message. An
  implementation detail is not a requirement.
- An inference that changes product policy, data ownership, privacy, security,
  tenant isolation, or external behavior needs clear evidence or the user's
  decision. Ask; do not assume.
- Equal values today are not a shared rule: two portals, tenants, roles, or
  environments may hold the same setting and still own it separately.
- A standard is not policy: BCP 47 defines tags, not which locales a portal
  ships; ISO 3166 defines countries, not who may sign up.
- Take formats and display data from standards and maintained libraries; keep
  allowlists, defaults, and authorization in the boundary that owns them.

## Ownership

- For a cross-layer change, list every owner first: caller, contract, backend
  command and package, table and transaction, dev/CI/production config, image,
  fixtures, generated files, tests, docs.
- Shared packages hold mechanism; owners supply policy. A closed vocabulary
  stays with its owner unless the product requires lockstep change.
- Trace each changed value through input, validation, transport, storage,
  background work, display, and startup config; every checked-in config must
  still run.

## Challenge

- Find a counterexample for every shared abstraction (another locale, tenant,
  policy, or an unavailable service).
- Check that public values leak no private or time-correlated identifier.
- Check failure, retry, concurrency, pagination, and bounded work.
- Look for two authorities (switches, catalogs, credentials) that can disagree.
- Choose the smallest design that meets the request and keeps invariants. No
  speculative modes, wider permissions, or extra deployment scope.

## Corrections

- A user correction outranks code, tests, docs, and commits. Fix everything
  built on the wrong assumption: abstractions, contracts, validators,
  constraints, config, fixtures, tests, docs.
- Rewrite tests that asserted the wrong requirement; do not bend code to them.
- Turn a recurring mistake into one rule in the right guide.
