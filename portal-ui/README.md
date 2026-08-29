# Vetchium Portal UI

This workspace holds the React behavior shared by every Vetchium portal. It is
a source-only package: the portals import its TypeScript directly and compile it
in their own builds, so there is no build step here.

Use Node.js 22.13.0 or newer.

- `shell.tsx` — application shell, header controls, and route boundaries.
- `auth.tsx` and `session.ts` — authentication context and session storage.
- `api.ts` and `errors.tsx` — fetch wrapper, problem parsing, and presentation.
- `idempotency.ts` and `pending-operations.tsx` — mutation safety.
- `preferences.tsx` and `providers.tsx` — theme, language, and provider tree.
- `security.tsx` and `recovery-codes.tsx` — account-security cards and modals.
- `styles.css` — layout classes and design tokens the portals import.

The package is portal-agnostic. Each portal supplies its own typed API adapter,
storage keys, translation keys, routes, and permission model; nothing here may
depend on which portal is calling. `agent-guides/ui.md` defines what belongs
here and what stays private to a portal.

## Development

Every module must be listed in the `exports` map in `package.json` before a
portal can import it.

```sh
npm ci
npm run format
npm run typecheck
```

Because this package is type-checked again inside each consumer, run
`make admin-ui-check hub-ui-check` before handing off a change.
