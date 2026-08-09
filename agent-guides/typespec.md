# TypeSpec Guide

This guide applies to the complete `typespec/` module, which owns the HTTP API
contract consumed by backend and future UI implementations.

## Contract ownership

- `.tsp` files define API paths, parameters, request bodies, response bodies,
  status codes, optionality, nullability, enums, and problem responses.
- Every contract `.tsp` file has corresponding hand-maintained `.go` and `.ts`
  files. Keep all three representations aligned in the same change. `main.tsp`
  is the compiler entry point and is the only exception.
- Do not put handler, database, logging, or transport implementation behavior
  in this module. Its Go files contain wire types, stable contract constants,
  normalization, and validation only.
- Keep shared scalars in `common/`, stable RFC 9457 problem types in `problem/`,
  and portal-owned types in focused portal packages.
- Add normalization and validation beside the request type so implementations
  do not duplicate contract rules. Validation must report JSON field names, not
  Go field names.
- TypeScript consumers import contract types through the `vetchium-specs`
  package. Keep its explicit `exports` map current when adding a contract file.
- TypeScript wire types represent `utcDateTime` as RFC 3339 strings because
  that is the JSON representation. They must not expose `Date` on the wire.
- All `.tsp` files should be formatted with `tsp format` command
  after the changes are written.

## Contract changes

- Before changing an endpoint, inspect both its `.tsp` definition and matching
  Go and TypeScript types. Do not infer names, casing, optionality, or response
  status from a handler or UI implementation.
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

## API styles
- Do not use query parameters for the backend APIs, unless the link will
  be sent as an email link and will need to be handled from the front-end UI
- Prefer to use POST with body instead of GET with path parameters for the
  backend APIs. For the front-end paths, path parameters are preferable.
- Use Keyset pagination for all APIs that return a list 
  or enumeration of objects.
- Error responses of APIs should be RFC 9457 compliant.
- Decide the APIs based on how the frontend (web portals and apps) would
  want to consume data. Machine/Bot accessible APIs can be later created
  separately if needed.

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

For TypeScript contract changes, run:

```sh
cd typespec
npm ci
npm run check:contract-files
npm run format:check
npm run typecheck
npm run test:ts
```

Format changed `.ts` files with `npm run format`. Format changed `.tsp` files
with `npx tsp format <files>`.

Do not commit `tsp-output/`.

Run `make typespec-test` from the repository root for the complete contract
suite, or `make test` to include Go and Playwright as well.
