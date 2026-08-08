# TypeSpec Guide

This guide applies to the complete `typespec/` module, which owns the HTTP API
contract consumed by backend and future UI implementations.

## Contract ownership

- `.tsp` files define API paths, parameters, request bodies, response bodies,
  status codes, optionality, nullability, enums, and problem responses.
- Every contract `.tsp` file has a corresponding hand-maintained Go file. Keep
  both representations aligned in the same change. `main.tsp` is the compiler
  entry point and is the only exception.
- Do not put handler, database, logging, or transport implementation behavior
  in this module. Its Go files contain wire types, stable contract constants,
  normalization, and validation only.
- Keep shared scalars in `common/`, stable RFC 9457 problem types in `problem/`,
  and portal-owned types in focused portal packages.
- Add normalization and validation beside the request type so implementations
  do not duplicate contract rules. Validation must report JSON field names, not
  Go field names.
- All `.tsp` files should be formatted with `tsp format` command
  after the changes are written.

## Contract changes

- Before changing an endpoint, inspect both its `.tsp` definition and matching
  Go type. Do not infer names, casing, optionality, or response status from a
  handler or UI implementation.
- Reuse existing common and domain types rather than redefining structurally
  similar values in endpoint packages.
- Required arrays must remain arrays on the wire. The corresponding Go type
  must make it possible for consumers to encode an empty `[]` rather than
  `null`.
- Keep problem type identifiers, titles, statuses, and field shapes stable.
  Treat changes to them as API compatibility changes.
- Do not add backend-only convenience fields to wire types.
- Test normalization without mutating the original request and cover every
  validation rule, including combinations of invalid fields.

## Verification

For Go-only changes, run from the repository root:

```sh
(cd typespec && go test ./...)
```

When `.tsp` files or TypeSpec configuration change, also run:

```sh
cd typespec
npm ci
npx tsp compile .
```

Do not commit `tsp-output/`.
