# UI Guide

This guide applies to the hand-maintained portal applications under
`admin-ui/`, `hub-ui/`, and `orgs-ui/` after they are converted from static
placeholders to TypeScript applications.

## Application stack

- Use React 19 with Vite and strict TypeScript.
- Use Ant Design 6 as the only component library. Do not introduce another
  component library without explicit approval.
- Use TanStack Query for all server state and React Router for routing.
- Mark every user-visible application string for translation with
  react-i18next. This includes headings, body copy, navigation, buttons, links,
  form labels, placeholders, help text, validation and error messages, empty
  and loading states, notifications, document titles, image alternatives, and
  accessibility labels. Keep brand names and numeric labels in translation
  resources even when their value is identical in every locale. Do not place
  literal user-visible strings directly in TSX. Use Ant Design locales for
  built-in component text.
- Use Ajv when runtime validation uses a JSON Schema supplied by the API.
- Import API wire types from `typespec/<path>`; do not redefine them in a
  portal.

## Installed-version API discipline

- Treat the versions installed by the portal's lockfile as the only source of
  truth for component APIs. Do not generate code from memory, examples for an
  older major version, or unversioned snippets.
- Before using or changing an Ant Design component, inspect the declarations
  installed under `node_modules/antd` and consult documentation matching the
  installed major version when the API is not obvious.
- Do not use a property, component, type, or export annotated `@deprecated` in
  the installed declarations, even when it still compiles for compatibility.
  Use the documented replacement for the installed version.
- When adding a component or upgrading Ant Design, inspect the touched
  component declarations for `@deprecated` annotations and migrate every
  affected use. Do not suppress or ignore a deprecation.
- TypeScript and Biome do not generally fail on deprecated JSX properties.
  Installed-declaration review is therefore a required verification step, not
  an optional editor hint.

## Styling

- Use Ant Design components, layout primitives, variants, sizes, semantic
  styles, and design tokens before writing custom CSS.
- Keep Ant Design's default component styling unless a product requirement
  calls for a deliberate application-wide theme. Put such theming in
  `ConfigProvider` tokens rather than scattered component overrides.
- Do not recreate Ant Design cards, typography, spacing, colors, borders,
  radii, shadows, or responsive behavior with one-off CSS.
- Do not target Ant Design's internal `.ant-*` selectors. They are not an
  application styling API and can change across library versions.
- Limit custom CSS to small amounts of application-level structure or branding
  that Ant Design cannot express directly. Keep it independent of Ant Design's
  internal markup and document why it is necessary when the reason is not
  self-evident.

## Architecture

- Keep application-wide providers and route configuration under `src/app/`.
- Keep direct HTTP calls under `src/api` or a feature's `api.ts`. Components do
  not call `fetch` directly.
- Put route-level components under `src/pages/`. Pages compose features and
  shared components; do not classify a component as a feature merely because
  it is rendered by a route.
- Organize reusable domain capabilities under `src/features/<feature>/`. Keep
  each feature's API hooks, feature-only types, forms, tables, and components
  together. Do not create a feature directory for a route-only page.
- Put only genuinely shared presentation components under
  `src/components/common`.
- Keep localization setup and locale resources under `src/i18n/`; components
  consume translated strings rather than defining user-visible copy inline.
- Use Ant Design components directly when no application behavior needs to be
  added. Do not create pass-through or single-expression wrapper components
  merely to rename an Ant Design component or its fixed props. A wrapper must
  provide meaningful reuse such as shared behavior, accessibility, application
  semantics, or configuration used in multiple places.
- Prefer explicit Ant Design forms and tables over a generic schema-to-UI or
  CRUD abstraction. Extract a shared adapter only after repeated use proves the
  common behavior.
- Use Ant Design `Form` for forms and Ant Design `Table` with server-side
  pagination for list endpoints.
- Keep API data in its wire shape at the transport boundary. Convert dates and
  other values only where the UI needs application-specific behavior.

## Verification

From the portal package, run:

```sh
npm run format
npm run format:check
npm run typecheck
npm run build
```

Before handoff, also review the installed declarations for every Ant Design
component or property introduced or changed and confirm that none is deprecated.
