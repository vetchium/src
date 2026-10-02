# TypeSpec

Applies to `typespec/`, the HTTP contract that backends and portals consume.

## Layout

- `common/` shared scalars and value types; `problem/` RFC 9457 base and the
  problem catalog; `admin/`, `hub/`, `orgs/` portal contracts; `directory/` the
  coordinator directory contract; `main.tsp` the compiler entry.
- Each contract `.tsp` has hand-written `.go` and `.ts` companions (never
  generated). Change all three together. `main.tsp` has no companions.
- The module holds wire types, constants, normalization, and validation only;
  no handler, database, logging, or transport code.
- Portal types live in focused subpackages that give names context
  (`users.Active`, not `UserStateActive`). Reuse common and domain types; no
  backend-only fields on wire types.
- `tsp-output/` is never committed.

## Closed vocabularies

- Declare every enum, literal union, and discriminator in TypeSpec; narrow each
  discriminated variant to its member.
- Go: a named string type with a constant per member; never widen to `string`.
  TypeScript: literal unions, with exported constants for values consumers
  build or compare.
- Keep open string scalars visibly distinct from closed sets.
- Product-owned sets (supported locales, capabilities) stay in their portal's
  namespace even when two portals hold the same members.

## Companions

- Every Go `*Request` implements `apiserver.Request`: `Normalize()` on a
  pointer receiver (may be empty), `Validate() []string` on a value receiver
  that never mutates and reports JSON field names.
- Normalization replacing an optional value assigns a new pointer; never
  mutate caller-shared storage.
- The backend imports types from `github.com/vetchium/src/typespec`; never
  copy a request or response struct into a handler.
- TypeScript consumers import subpaths (`typespec/admin/auth/login`). The
  `exports` map lists every non-test `.ts` file; update it with each new file.
- Required arrays encode as `[]`, never `null`.
- Timestamps are `utcDateTime` with a `Z` offset; TypeScript holds them as
  RFC 3339 strings.

## Changing a contract

- Read the `.tsp` and both companions first; never infer names, optionality, or
  statuses from a handler or UI.
- Problem types, titles, statuses, and fields are stable; changing one breaks
  compatibility.
- A problem with extension members is a TypeSpec model, a Go struct embedding
  `problem.Details`, and a TypeScript interface extending `Details`. Write it
  with `Runtime.Problem` or `Runtime.AuthenticationProblem` so every member is
  encoded.
- Test normalization on a copy (the original stays unchanged) and every
  validation rule, including combinations.
- Format with `npx tsp format <files>`. In `typespec/`:
  `npm run check:contract-files`, `npm run compile`, `npm run typecheck`,
  `npm run test:ts`; before handoff `make typespec-check`.

## API style

- POST with a body, not GET with path parameters (portal routes may use path
  parameters).
- No query parameters except in emailed links handled by a portal.
- Keyset pagination for every list.
- Every error is an RFC 9457 problem.
- Shape endpoints for how the portals use them.
