# UI

Applies to the portal applications under `admin-ui/`, `hub-ui/`, and
`orgs-ui/`, once converted from static placeholders. Read
[`typescript.md`](typescript.md) as well.

## Stack

- React 19, Vite, strict TypeScript.
- Ant Design 6 is the only component library. Adding another needs explicit
  approval.
- TanStack Query for all server state; React Router for routing.
- Ajv when runtime validation uses a JSON Schema supplied by the API.
- Import API wire types from `typespec/<path>`; never redefine them in a
  portal.
- Mark every user-visible string for translation with react-i18next: headings,
  body copy, navigation, buttons, links, form labels, placeholders, help text,
  validation and error messages, empty and loading states, notifications,
  document titles, image alternatives, and accessibility labels. Brand names
  and numeric labels stay in the resources even when identical in every locale.
  No literal user-visible strings in TSX. Built-in component text comes from
  Ant Design locales.

## Installed-version API discipline

- The portal's lockfile is the only source of truth for component APIs. Do not
  write code from memory, from an older major version's examples, or from
  unversioned snippets.
- Before using or changing an Ant Design component, read its declarations under
  `node_modules/antd`, and the documentation for the installed major version
  when the API is not obvious.
- Never use a property, component, type, or export marked `@deprecated` in the
  installed declarations, even where it still compiles. Use the documented
  replacement. When adding a component or upgrading Ant Design, check the
  touched declarations and migrate every affected use; do not suppress the
  deprecation.
- TypeScript and Biome do not generally fail on deprecated JSX properties, so
  reviewing the installed declarations is a required verification step, not an
  editor hint.

## Styling

- Reach for Ant Design components, layout primitives, variants, sizes, semantic
  styles, and design tokens before writing CSS.
- Keep Ant Design's default styling unless a product requirement calls for a
  deliberate application-wide theme, and put that theme in `ConfigProvider`
  tokens rather than scattered overrides.
- Do not rebuild Ant Design cards, typography, spacing, colors, borders, radii,
  shadows, or responsive behavior in one-off CSS.
- Never target `.ant-*` internal selectors. They are not a styling API and
  change between versions.
- Limit custom CSS to small application-level structure or branding Ant Design
  cannot express, keep it independent of Ant Design's internal markup, and say
  why it exists when that is not self-evident.

## Architecture

- Behavior used by more than one portal belongs in the `portal-ui/` workspace
  package: application shell, authentication concurrency, session-storage
  primitives, preferences, idempotency keys, API problem handling, return-path
  validation, and account-security presentation. A security control such as the
  `returnTo` open-redirect guard belongs there most of all: a per-portal copy
  is a copy that gets fixed in one portal and left wrong in the others.
  Portals supply typed API, storage, navigation, translation-key, and
  authorization adapters instead of copying the implementation.
- Shared mechanics do not make capabilities global. Translation availability,
  runtime defaults, permission-aware navigation, and other closed portal
  capabilities stay owned by each portal and reach shared components through
  typed adapters or configuration. Identical capability lists today do not
  oblige the portals to evolve together.
- Locale standard and locale support are separate. BCP 47 gives the canonical
  tag format and `Intl`/CLDR the matching and display behavior; each portal
  declares independently which tags it ships complete translations for.
  Browser negotiation runs against that portal's list, and a
  standards-valid but unsupported tag must never be sent to its API.
- Portal-private code is limited to domain pages and features, route tables,
  endpoint adapters, permission-aware navigation, runtime configuration, and
  locale resources. When a second portal needs the same behavior, move it into
  `portal-ui/` in the same change rather than copying it.
- Layout: application-wide providers and route configuration under `src/app/`;
  route-level components under `src/pages/`; reusable domain capabilities under
  `src/features/<feature>/`, keeping that feature's API hooks, feature-only
  types, forms, tables, and components together; genuinely shared presentation
  under `src/components/common`; localization setup and resources under
  `src/i18n/`. Pages compose features and shared components; being rendered
  by a route does not make a component a feature, and a route-only page does not
  get a feature directory.
- HTTP calls live under `src/api` or a feature's `api.ts`. Components never
  call `fetch`.
- Use Ant Design components directly when no application behavior is added. A
  wrapper must earn itself with shared behavior, accessibility, application
  semantics, or configuration used in several places; renaming a component or
  fixing its props is not enough.
- Prefer explicit Ant Design `Form` and `Table` — with server-side pagination
  for list endpoints — over a generic schema-to-UI or CRUD abstraction.
  Extract a shared adapter only after repeated use proves the common behavior.
- Keep API data in its wire shape at the transport boundary. Convert dates and
  other values only where the UI needs application-specific behavior.

## Verification

See [`verification.md`](verification.md). Before handoff, also review the
installed declarations of every Ant Design component or property introduced or
changed and confirm none is deprecated.
