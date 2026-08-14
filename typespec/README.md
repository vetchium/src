# Vetchium API contract

This directory contains Vetchium's TypeSpec HTTP API contracts and the matching
Go and TypeScript wire packages used by the applications.

The TypeSpec and TypeScript toolchain requires Node.js 22.13 or newer.

- `common/` contains genuinely shared scalar and value types.
- `problem/` contains the RFC 9457 representation and stable problem catalog.
- `admin/`, and future portal directories, contain portal-specific contracts
  and wire packages.
- `main.tsp` is the TypeSpec compiler entry point.

To validate the contract and emit OpenAPI 3.1 locally:

```sh
npm ci
npm run check:contract-files
npx tsp compile .
npm run typecheck
npm run test:ts
```

Emitter output is written under `tsp-output/` and is not committed.
