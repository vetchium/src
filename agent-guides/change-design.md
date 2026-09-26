# Change Design

Applies before implementing any change. A change can be internally consistent
and still encode the wrong product rule, ownership boundary, security property,
or deployment assumption.

## Establish facts

- Read the request, applicable contracts and guides, current code, tests,
  configuration, and recent commits in the area.
- Evidence rank: request > contract > code > tests > commit message. An
  implementation detail is not a requirement.
- Label each claim as requested behavior, repository fact, or inference. An
  inference that moves product policy, data ownership, privacy, security, tenant
  isolation, or externally visible behavior needs unambiguous repository
  evidence or user direction.
- Equal current values are not a shared invariant. Portals, tenants, roles,
  endpoints, or environments can hold identical configuration and still own it
  independently.
- A representation standard is not product policy. BCP 47 defines language tags,
  not which translations a portal ships; ISO 3166 defines country codes, not
  admission or placement.
- Take syntax, identifiers, and display data from standards and maintained
  libraries. Keep allowlists, capabilities, defaults, and authorization in the
  boundary that owns them.

## Map ownership and impact

For a cross-layer or cross-portal change, list the affected owners before
editing: portal or caller; TypeSpec namespace and wire types; backend command,
handler, worker, or internal package; database table, constraint, and
transaction; development, CI, and production configuration; runtime image or
entrypoint; fixtures, generated artifacts, tests, and documentation.

- Mark each concern shared or owner-specific. Shared packages hold mechanism
  that accepts owner-supplied policy or capability data. A closed vocabulary
  stays owner-specific unless the product requires every owner to change in
  lockstep.
- Trace each changed value through input, validation, transport, storage,
  retrieval, background processing, display, and startup/deployment inputs, so
  checked-in configurations stay runnable.

## Challenge the design

- Find a counterexample for every shared abstraction: a portal with a different
  locale, a tenant with different policy, an unavailable service, a value valid
  by standard but unsupported by the product.
- Check whether public values leak private or time-correlated identifiers.
- Check failure, retry, concurrency, pagination, and bounded-work behavior.
- Check for duplicate authorities, switches, catalogs, credentials, or services
  that can disagree or become unreachable.
- Take the smallest design that satisfies the request and keeps existing
  invariants: no speculative modes, no wider permissions, credentials, policy,
  or deployment scope.

## Corrections invalidate assumptions

- A user correction outranks code, tests, documentation, and commit messages.
  Do not defend the assumption it contradicts.
- Fix every artifact derived from that assumption across the whole value flow:
  abstractions, contracts, validators, schema constraints, configuration,
  fixtures, tests, docs, review prompts.
- Rewrite tests that asserted the wrong requirement; bending the implementation
  around them repeats the mistake.
- Read nearby correction commits and their predecessors for the reasoning
  failure, not the changed lines. Turn a recurring failure into one rule in the
  right guide, not incident-specific prose.
- Give the reviewer the original request and the correction, and ask whether any
  part of the rejected assumption survives.

Passing tests prove only the assertions written. Before review, compare the
finished behavior against the request and ownership map again
([`review.md`](review.md)).
