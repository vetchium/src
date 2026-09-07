# Change Design and Assumption Control

This guide applies before implementation of every repository change. Its goal
is to prevent a technically consistent implementation from encoding the wrong
product rule, ownership boundary, security property, or deployment assumption.

## Establish facts before choosing a design

- Read the user request, applicable contracts and guides, current code, tests,
  configuration, and recent commits touching the area. Treat them as evidence
  with different authority; do not silently turn an implementation detail into
  a requirement.
- Distinguish explicitly between requested behavior, repository facts, and an
  inference needed to proceed. If an inference changes product policy, data
  ownership, privacy, security, tenant isolation, or externally visible
  behavior, obtain user direction unless the repository contains unambiguous
  evidence.
- Do not infer a shared invariant from equal current values. Two portals,
  tenants, roles, endpoints, or environments may currently have the same
  configuration while retaining independent ownership and evolution.
- Do not confuse a representation standard with product support or policy. For
  example, BCP 47 defines language tags; it does not decide which translations
  a portal ships. ISO 3166 defines country codes; it does not decide regional
  admission or placement policy.
- Use standards and maintained libraries for syntax, identifiers, and display
  data. Keep product allowlists, capabilities, defaults, and authorization in
  their owning boundary.

## Build an ownership and impact matrix

For a cross-layer or cross-portal change, identify the affected owners before
editing:

- portal or caller;
- TypeSpec namespace and wire types;
- backend command, handler, worker, or internal package;
- database table, constraint, and transaction;
- development, CI, and production configuration;
- runtime image or entrypoint;
- fixtures, generated artifacts, tests, and documentation.

Mark each concern as shared or owner-specific. Put reusable mechanics in shared
packages only when they accept owner-supplied policy or capability data. Keep a
closed vocabulary owner-specific unless the product explicitly requires every
owner to change in lockstep.

Trace every changed value from input through validation, transport, storage,
retrieval, background processing, and display. Also trace startup and deployment
inputs so checked-in configurations remain runnable.

## Challenge the design before implementation

- Test at least one counterexample to every proposed shared abstraction: a
  portal supports a different locale, a tenant has different policy, a service
  is unavailable, or a value is valid by a standard but unsupported by the
  product.
- Check whether public values reveal private or time-correlated identifiers.
- Check failure, retry, concurrency, pagination, and bounded-work behavior.
- Check whether the design creates duplicate authorities, switches, catalogs,
  credentials, or services that can disagree or become unreachable.
- Prefer the smallest design that satisfies the request and preserves existing
  invariants. Do not add speculative modes or broaden permissions, credentials,
  policy, or deployment scope.

## Handle corrections as invalidated assumptions

- Treat an explicit user correction as higher-authority evidence that the
  underlying assumption is wrong. Do not defend or preserve it merely because
  code, tests, documentation, or a previous commit message describes it.
- Find every artifact derived from the invalidated assumption: shared
  abstractions, contracts, validators, schema constraints, configuration,
  fixtures, tests, documentation, and review prompts. Correct the ownership
  boundary across the full value flow instead of patching only the reported
  symptom.
- Inspect nearby correction commits and their predecessors to identify the
  reasoning failure, not only the changed lines. Convert the recurring failure
  into one focused rule in the appropriate shared guide; avoid incident-specific
  prose that will not generalize.
- Rewrite tests that asserted the wrong requirement. Retaining those tests and
  bending the implementation around them repeats the original mistake.
- Give the reviewer the original request and the correction verbatim in meaning,
  and ask whether any part of the rejected assumption remains in the result.

## Verification is not requirements validation

Passing tests proves only the assertions that were written. Before review,
compare the finished behavior with the request and ownership matrix again.
Reviewers must receive the original request and be asked to challenge the
assumptions and scope, not merely confirm that the implementation matches the
implementer's summary.
