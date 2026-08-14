# TypeScript Guide

This guide applies to hand-maintained TypeScript in the repository, including
the wire types under `typespec/` and tests under `playwright/`.

## Types and imports

- Keep strict TypeScript enabled. Do not introduce `any`; use `unknown` and
  narrow it when a test intentionally sends an invalid payload.
- Import API request, response, enum, and problem types from
  `typespec/<path>`. Do not reconstruct wire types in a UI, API client,
  fixture, or test.
- Use `import type` when an import is erased at runtime.
- Preserve JSON names, casing, required fields, optionality, nullability, and
  array shapes exactly as declared in TypeSpec.
- Represent `utcDateTime` values as RFC 3339 strings in wire types. Convert to
  `Date` only in application code that needs date operations.

## Implementation

- Keep normalization and validation pure: return a new value and do not
  mutate caller-owned input.
- Report validation failures with JSON member names.
- Prefer small exported interfaces and literal unions. Do not add UI-only or
  test-only convenience fields to shared wire types.

## Formatting

- Format every `.ts` and `.tsx` file with Biome. Do not use Prettier or another
  formatter for TypeScript.
- Use the shared repository configuration at `biome.json`; do not add a nested
  Biome configuration unless the package genuinely requires different rules.
- Every Node package that owns TypeScript must pin `@biomejs/biome` in
  `devDependencies` and expose `format` and `format:check` npm scripts.
- Run the owning package's `npm run format` after changing TypeScript and
  before verification. Do not invoke `biome format` directly: the package
  script uses `biome check --write` so it also organizes imports and applies
  safe lint fixes. Do not hand-format around Biome output.

## Verification

Run the owning package's type check after changes:

```sh
cd typespec && npm run format:check
cd typespec && npm run typecheck
cd playwright && npm run format:check
cd playwright && npm run typecheck
```

Run `make test` from the repository root for all TypeScript tests and every
other repository suite.
