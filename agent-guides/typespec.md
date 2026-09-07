# TypeSpec

Applies to the whole `typespec/` module, which owns the HTTP API contract that
backends and portals consume.

## Contract ownership

- `.tsp` files define paths, parameters, request and response bodies, status
  codes, optionality, nullability, enums, and problem responses.
- Every contract `.tsp` file has hand-maintained `.go` and `.ts` companions;
  these types are deliberately not emitted by a generator. Change all three in
  the same commit. `main.tsp` is the only exception: it is the compiler entry
  point, defines no wire types, and has no companions.
- This module contains wire types, stable contract constants, normalization,
  and validation only. No handler, database, logging, or transport behavior;
  the backend's shared server runtime encodes typed Problem values.
- Shared scalars live in `common/`, stable RFC 9457 problem types in
  `problem/`, and portal-owned types in focused subpackages such as
  `admin/user/`. Let the package supply context so names stay short:
  `user.State`, `user.Active`, `user.Disabled`.
- Reuse existing common and domain types instead of redefining structurally
  similar values in endpoint packages. Never add backend-only convenience
  fields to a wire type.

## Closed vocabularies

- Represent every closed string vocabulary the same way in all three
  languages — TypeSpec enums, unions of string literals, and discriminator
  values alike. TypeSpec declares the vocabulary and narrows each
  discriminated variant to its exact member. Go uses a named string type with
  a typed constant per member and never widens a closed field to `string`.
  TypeScript uses literal unions or literal properties and exports constants
  for values consumers construct or compare.
- Keep open or forward-compatible string scalars visibly distinct from closed
  vocabularies.
- A shared representation standard does not make the vocabulary shared. Keep
  supported locale sets, feature capabilities, and similar product-owned enums
  in their portal namespace unless the product requires one lockstep set. Two
  portal enums may legitimately hold identical members today. Share the syntax
  or display mechanics separately from the accepted set.

## Go and TypeScript companions

- Every Go `*Request` implements `apiserver.Request`: `Normalize()` on a
  pointer receiver, `Validate() []string` on a value receiver. Declare an empty
  `Normalize()` when there is nothing to normalize. `Validate()` never mutates
  or normalizes the receiver, and reports JSON field names, not Go field names.
- Keep normalization and validation beside the request type so implementations
  do not restate contract rules. When normalization replaces an optional value,
  assign a new pointer instead of mutating storage shared with the caller.
- Backend code imports these types from `github.com/vetchium/src/typespec` and
  never duplicates request or response structs in a handler.
- TypeScript consumers import through the `typespec` package and its explicit
  subpath exports, for example `typespec/admin/auth/login`. Keep the `exports`
  map current when adding a contract file.
- Required arrays stay arrays on the wire; the Go type must let consumers
  encode `[]` rather than `null`.
- Model every API timestamp as `utcDateTime`, encoded with a `Z` offset and
  never a caller-supplied one. TypeScript wire types represent it as an RFC
  3339 string and must not expose `Date`.

## Changing a contract

- Before editing an endpoint, read its `.tsp` and both companions. Do not infer
  names, casing, optionality, or status from a handler or a UI.
- Problem type identifiers, titles, statuses, and field shapes are stable.
  Changing one is an API compatibility change.
- Test normalization on a copy and verify the original's shared storage is
  unchanged. Test every validation rule, including combinations of invalid
  fields.
- Format changed `.tsp` files with `npx tsp format <files>` after editing.

## API style

- Prefer POST with a body over GET with path parameters. Front-end routes may
  use path parameters.
- No query parameters, unless the link is emailed and handled by the portal UI.
- Keyset pagination for every API returning a list or enumeration.
- Error responses are RFC 9457 compliant.
- Design endpoints for how the portals and apps consume data. Machine-facing
  APIs can be added separately later.

## Verification

See [`verification.md`](verification.md).
