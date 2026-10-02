# TypeScript

Applies to hand-written TypeScript, including `typespec/` wire types and
`playwright/`.

- Strict mode; no `any`. Use `unknown` and narrow it, for example when a test
  sends an invalid payload.
- Import wire types from `typespec/<path>`; never redefine them in a portal,
  client, fixture, or test. Use `import type` for type-only imports.
- Keep JSON names, optionality, nullability, and array shapes exactly as
  TypeSpec declares. `utcDateTime` stays a string; convert to `Date` only where
  date math is needed.
- Normalization and validation are pure: return new values, report failures by
  JSON member name.
- No UI-only or test-only fields on shared wire types.
- Packages are scoped `@vetchium/` (`admin-ui`, `hub-ui`, `orgs-ui`,
  `portal-ui`, `playwright`), except `typespec`, the bare import name. Keep
  `engines`, `packageManager`, and tool versions aligned across packages.
- Biome is the only formatter, with the root `biome.json` and recommended rules
  (React and test domains on). Every package pins `@biomejs/biome` and has
  `format` and `format:check` scripts. Run the package's `npm run format` after
  editing; never hand-format around it.
