# Change Design

Applies before implementing any change. A change can be internally consistent
and still encode the wrong product rule, ownership boundary, security property,
or deployment assumption. This guide is about preventing that.

## Establish facts

- Read the request, the applicable contracts and guides, the current code,
  tests, configuration, and recent commits in the area.
- Evidence has ranks: request > contract > code > tests > commit message. An
  implementation detail is not a requirement.
- Label every claim as requested behavior, repository fact, or inference. An
  inference that moves product policy, data ownership, privacy, security,
  tenant isolation, or externally visible behavior needs unambiguous repository
  evidence or user direction.
- Equal current values are not a shared invariant. Two portals, tenants, roles,
  endpoints, or environments can hold identical configuration today and still
  own it independently.
- A representation standard is not product policy. BCP 47 defines language
  tags; it does not decide which translations a portal ships. ISO 3166 defines
  country codes; it does not decide admission or placement.
- Take syntax, identifiers, and display data from standards and maintained
  libraries. Keep allowlists, capabilities, defaults, and authorization in the
  boundary that owns them.

## Map ownership and impact

For any cross-layer or cross-portal change, list the affected owners before
editing: portal or caller; TypeSpec namespace and wire types; backend command,
handler, worker, or internal package; database table, constraint, and
transaction; development, CI, and production configuration; runtime image or
entrypoint; fixtures, generated artifacts, tests, and documentation.

- Mark each concern shared or owner-specific. Shared packages hold mechanism
  that accepts owner-supplied policy or capability data. A closed vocabulary
  stays owner-specific unless the product requires every owner to change in
  lockstep.
- Trace each changed value through input, validation, transport, storage,
  retrieval, background processing, and display. Trace startup and deployment
  inputs too, so checked-in configurations stay runnable.

## Challenge the design

- Find a counterexample for every proposed shared abstraction: a portal with a
  different locale, a tenant with different policy, an unavailable service, a
  value valid by standard but unsupported by the product.
- Check whether public values leak private or time-correlated identifiers.
- Check failure, retry, concurrency, pagination, and bounded-work behavior.
- Check for duplicate authorities, switches, catalogs, credentials, or services
  that can disagree or become unreachable.
- Take the smallest design that satisfies the request and keeps existing
  invariants. No speculative modes; no wider permissions, credentials, policy,
  or deployment scope.

## Corrections invalidate assumptions

- A user correction outranks code, tests, documentation, and past commit
  messages. Do not defend the assumption they contradict.
- Fix every artifact derived from it — shared abstractions, contracts,
  validators, schema constraints, configuration, fixtures, tests, docs, review
  prompts — across the whole value flow, not just the reported symptom.
- Rewrite tests that asserted the wrong requirement. Keeping them and bending
  the implementation repeats the mistake.
- Read nearby correction commits and their predecessors for the reasoning
  failure, not the changed lines. Turn a recurring failure into one rule in the
  right guide; do not add incident-specific prose.
- Hand the reviewer the original request and the correction, and ask whether
  any part of the rejected assumption survives.

## Tests are not requirements validation

Passing tests prove the assertions that were written. Before review, compare
the finished behavior against the request and the ownership map again, and give
the reviewer the original request so they challenge assumptions and scope
rather than confirm your summary. See [`review.md`](review.md).
