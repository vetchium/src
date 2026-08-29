# Portal UI Agent Guidance

Changes under `portal-ui/` must follow both shared guides:

- [`../agent-guides/typescript.md`](../agent-guides/typescript.md)
- [`../agent-guides/ui.md`](../agent-guides/ui.md)

The TypeScript guide controls language, formatting, wire-type, and verification
conventions. The UI guide controls the frontend stack and application
architecture, and defines what belongs here rather than in a portal.

This package is consumed by `admin-ui/` and `hub-ui/`, and will be consumed by
`orgs-ui/`. Two rules follow from that and apply only here:

- Keep this package portal-agnostic. It must not import from a portal, name one
  in an identifier, branch on which portal is calling, or hard-code a
  translation key, storage key, route, or endpoint. Take those from the caller
  as parameters or adapters, the way `createTokenSessionStorage` takes its
  storage key and `APIErrorAlert` takes its problem-key map.
- Every export is shared surface. Changing one changes every portal, so verify
  each consumer, not just the one that prompted the change.

Add each new module to the `exports` map in `package.json`; a module that is not
exported is unreachable from the portals.

## Verification

```sh
npm run format
npm run typecheck
```

Then run `npm run typecheck` and `npm run build` in `admin-ui/` and `hub-ui/`,
or `make admin-ui-check hub-ui-check`, because this package has no build of its
own and is type-checked again inside each consumer.
