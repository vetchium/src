# mockups/

Static screen mockups for specs that are not built yet. Baseline:
[`ux.md`](../agent-guides/ux.md) and the feature's guide.

- `app/` is a throwaway Vite app, not a portal: no i18n, API, router, or
  tests. It renders Ant Design from `orgs-ui/node_modules` (linked on first
  run) with the portals' primary color.
- `app/src/shell.tsx` copies `portal-ui/src/shell.tsx` by hand; match it when
  the real shell changes. Its navigation shows the proposed items.
- One directory per spec under `app/src/<spec>/` with a `screens.tsx` list;
  register it in `app/src/registry.tsx`. Screen ids sort by prefix; the
  gallery groups by the title text before ` · `.
- Copy the layout of the nearest real screen (ux.md) and invent realistic
  data; never show internal identifiers.
- `node mockups/app/capture.mjs <spec> [id-prefix ...]` writes
  `mockups/<spec>/<id>.png` and `index.html`; it exits non-zero on page
  errors. `--serve` only serves. Needs `npm ci` in `orgs-ui` and `playwright`
  and Playwright's Chromium.
- Commit the regenerated PNGs and `index.html` with their source. Delete a
  spec's mockups once its screens ship.
