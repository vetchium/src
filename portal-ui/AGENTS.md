# portal-ui/

Changes here follow
[`../agent-guides/typescript.md`](../agent-guides/typescript.md) for language,
formatting, wire types, and verification, and
[`../agent-guides/ui.md`](../agent-guides/ui.md) for the frontend stack,
application architecture, and what belongs here rather than in a portal.

`admin-ui/` and `hub-ui/` consume this package, and `orgs-ui/` will. Two rules
follow, and apply only here:

- Keep it portal-agnostic. It must not import from a portal, name one in an
  identifier, branch on which portal is calling, or hard-code a translation
  key, storage key, route, or endpoint. Take those from the caller as
  parameters or adapters, the way `createTokenSessionStorage` takes its storage
  key and `APIErrorAlert` takes its problem-key map.
- Every export is shared surface. Changing one changes every portal, so verify
  each consumer, not only the one that prompted the change.

Add each new module to the `exports` map in `package.json`; an unexported
module is unreachable from the portals.

This package has no build of its own and is type-checked again inside each
consumer, so `make portal-ui-check` is not enough — also run
`make admin-ui-check hub-ui-check`. See
[`../agent-guides/verification.md`](../agent-guides/verification.md).
