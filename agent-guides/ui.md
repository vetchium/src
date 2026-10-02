# UI

Applies to the portal applications under `admin-ui/`, `hub-ui/`, and
`orgs-ui/`. Read [`typescript.md`](typescript.md) as well.

## Stack

- React 19, Vite, strict TypeScript.
- Ant Design 6 is the only component library; adding another needs explicit
  approval.
- TanStack Query for all server state; React Router for routing.
- Ajv when runtime validation uses a JSON Schema supplied by the API.
- Import API wire types from `typespec/<path>`; never redefine them in a portal.
- Mark every user-visible string for translation with react-i18next: headings,
  body copy, navigation, buttons, links, form labels, placeholders, help text,
  validation and error messages, empty and loading states, notifications,
  document titles, image alternatives, and accessibility labels. Brand names and
  numeric labels stay in the resources even when identical in every locale. No
  literal user-visible strings in TSX. Built-in component text comes from Ant
  Design locales.

## Installed-version API discipline

- The portal's lockfile is the only source of truth for component APIs. Do not
  write code from memory, older major versions' examples, or unversioned
  snippets.
- Before using or changing an Ant Design component, read its declarations under
  `node_modules/antd`, and the documentation for the installed major version when
  the API is not obvious.
- Never use a property, component, type, or export marked `@deprecated` in the
  installed declarations, even if it compiles; use the documented replacement.
  When adding a component or upgrading Ant Design, check the touched declarations
  and migrate every affected use rather than suppressing the deprecation.
- TypeScript and Biome generally do not fail on deprecated JSX properties, so
  reviewing the installed declarations is a required verification step. Before
  handoff, confirm none of the Ant Design components or properties you introduced
  or changed is deprecated.

## Styling

- Reach for Ant Design components, layout primitives, variants, sizes, semantic
  styles, and design tokens before writing CSS.
- Keep Ant Design's default styling unless a product requirement calls for a
  deliberate application-wide theme, and put that theme in `ConfigProvider`
  tokens, not scattered overrides.
- Do not rebuild Ant Design cards, typography, spacing, colors, borders, radii,
  shadows, or responsive behavior in one-off CSS.
- Never target `.ant-*` internal selectors; they are not a styling API and change
  between versions.
- Limit custom CSS to small application-level structure or branding Ant Design
  cannot express, independent of its internal markup, with a stated reason when
  not self-evident.

## Architecture

- Behavior used by more than one portal belongs in the `portal-ui/` workspace
  package: application shell, authentication concurrency, session-storage
  primitives, preferences, idempotency keys, API problem handling, return-path
  validation, and account-security presentation. A security control such as the
  `returnTo` open-redirect guard belongs there most of all: a per-portal copy
  gets fixed in one portal and left wrong in the others. Portals supply typed
  API, storage, navigation, translation-key, and authorization adapters instead
  of copying the implementation.
- Shared mechanics do not make capabilities global. Translation availability,
  runtime defaults, permission-aware navigation, and other closed portal
  capabilities stay owned by each portal and reach shared components through
  typed adapters or configuration. Identical lists today do not oblige the
  portals to evolve together.
- Locale standard and locale support are separate: BCP 47 gives the canonical tag
  format and `Intl`/CLDR the matching and display behavior; each portal declares
  independently which tags it ships complete translations for. Browser
  negotiation runs against that portal's list, and a standards-valid but
  unsupported tag is never sent to its API.
- Portal-private code is limited to domain pages and features, route tables,
  endpoint adapters, permission-aware navigation, runtime configuration, and
  locale resources. When a second portal needs the same behavior, move it into
  `portal-ui/` in the same change rather than copying it.
- Layout: application-wide providers and route configuration in `src/app/`;
  route-level components in `src/pages/`; reusable domain capabilities in
  `src/features/<feature>/` (that feature's API hooks, feature-only types, forms,
  tables, and components together); genuinely shared presentation in
  `src/components/common`; localization setup and resources in `src/i18n/`. Pages
  compose features and shared components. Being rendered by a route does not make
  a component a feature, and a route-only page gets no feature directory.
- HTTP calls live under `src/api` or a feature's `api.ts`; components never call
  `fetch`.
- Use Ant Design components directly when adding no application behavior. A
  wrapper must earn itself with shared behavior, accessibility, application
  semantics, or configuration used in several places; renaming a component or
  fixing its props is not enough.
- Prefer explicit Ant Design `Form` and `Table` (with server-side pagination for
  list endpoints) over a generic schema-to-UI or CRUD abstraction. Extract a
  shared adapter only after repeated use proves the common behavior.
- Keep API data in its wire shape at the transport boundary; convert dates and
  other values only where the UI needs application-specific behavior.

## Global portals and regions

Hub and Orgs are one static build each, served to every region from a static
host; Admin stays regional on the same origin as its API.

- The region list is compiled in: `portal-ui/src/regions/<environment>.json`
  (API origins, signup flags, recommendations) and the Hub's own
  `hub-ui/src/app/regions/<environment>.json` (media origins, offered plans).
  `VITE_VETCHIUM_ENVIRONMENT` (`dev`, `ci`, `production`) selects them; the
  build fails without it. `TestPortalRegionTablesMatchCheckedInConfiguration`
  keeps the tables equal to each environment's configs and catalog, so change
  them together. Adding a region means rebuilding both portals.
- Sign-in and forgot-password pages show the region picker
  (`@vetchium/portal-ui/region-picker`) before any personal data; signup offers
  the table's eligible regions for the chosen country. The browser remembers
  the sign-in region; the default is the remembered region, then the
  recommendation for the first language tag that names a country, then the
  table default.
- A session token belongs to the region that issued it. The stored and
  in-memory session record that region, and requests made with the session go
  only there (`createSessionAPIOrigin`, `createRegionalSessionStorage`). Every
  signed-out flow (sign-in, TOTP, forgot and reset password, signup, emailed
  links) passes its region explicitly, which sends the request without the
  token; a sign-in carries its region through the challenge to the stored
  session. Never let the picker, a link, or another tab's choice decide where a
  token goes.
- An emailed link carries `region=<tenantId>`. Read it only through
  `regionFromSearchParams`, send the link's request to that region, and show the
  page's invalid-link state for a missing or unknown region; never fall back to
  another region.
- Security headers are generated at build time by
  `@vetchium/portal-ui/portal-build` from the same tables: the static host's
  `_headers` and `_redirects`, and the nginx include dev and CI serve. Never
  hand-write a CSP or a noindex rule for these portals; change the policy the
  portal's `vite.config.ts` passes. Vite configs may import only the import-free
  modules `portal-build`, `portal-environment`, and `security-headers`, because
  Node loads them where portal-ui's dependencies are not installed.
- Pages under `/u/` and `/org/` render `<meta name="robots" content="noindex">`
  in addition to the generated `X-Robots-Tag`.
- API changes follow expand, then contract (`backend.md`): a published portal
  must keep working against every region during a rolling upgrade.
