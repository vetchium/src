# UI

Applies to `admin-ui/`, `hub-ui/`, `orgs-ui/`, and `portal-ui/`.

## Stack

- React 19, Vite, strict TypeScript, Ant Design 6 (the only component library
  without explicit approval), TanStack Query for server state, React Router,
  react-i18next, Ajv when an API supplies a JSON Schema.
- Import wire types from `typespec/<path>`.
- Every user-visible string goes through react-i18next, including titles,
  placeholders, validation, empty and loading states, alt text, and
  accessibility labels; brand names and numbers too. No literal text in TSX.
  Built-in component text comes from Ant Design locales.

## Ant Design

- The installed version is the API: read its declarations in
  `node_modules/antd` before using or changing a component; never code from
  memory or older examples.
- Never use anything marked `@deprecated` there, even if it compiles (TypeScript
  and Biome do not flag deprecated props); migrate every use when upgrading.
- Prefer components, layout primitives, variants, and tokens over CSS. Keep the
  default look; an app-wide theme goes in `ConfigProvider` tokens.
- Never restyle cards, typography, spacing, colors, or responsiveness in
  one-off CSS, and never target `.ant-*` selectors. Custom CSS only for small
  app structure or branding.

## Shared package (`portal-ui`)

- Behavior used by more than one portal lives here: shell, auth concurrency,
  session storage, preferences, idempotency, problem handling, `returnTo`
  validation, region selection, security headers, account-security cards. A
  second portal needing a behavior moves it here in the same change.
- Stay portal-agnostic: no imports from a portal, no portal names, no
  branching on the caller, no hard-coded translation keys, storage keys,
  routes, or endpoints; take them as parameters or adapters.
- Shared mechanism does not make a capability shared: supported locales,
  defaults, and navigation stay owned by each portal.
- Every export reaches every portal; verify each consumer. Add new modules to
  the `exports` map in `package.json`. There is no build; portals compile the
  source.

## Portal structure

- `src/app/` providers and routes; `src/pages/` route components;
  `src/features/<feature>/` a domain capability's hooks, types, forms, and
  components; `src/components/common/` shared presentation; `src/i18n/` locale
  setup and resources. A route-only page gets no feature directory.
- HTTP calls live in `src/api/` or a feature's `api.ts`; components never call
  `fetch`.
- Each portal declares the locales it ships complete. Match browser languages
  against that list (`Intl`/CLDR); never send an unsupported tag to the API.
- Use Ant Design directly; a wrapper must add shared behavior, accessibility,
  or configuration used in several places.
- Explicit `Form` and `Table` (server-side pagination) over generic CRUD
  abstractions.
- Keep API data in wire shape; convert only where the UI needs it.

## Global portals and regions

- Hub (`vetchium.com`) and Orgs (`orgs.vetchium.com`) are one static build
  each for all regions. No regional Hub or Orgs hosts, no redirects from old
  ones.
- Admin stays regional, same origin as its API, with `runtime-config.sh`.
  Never put it on the static host: a static-host account must not control code
  holding Admin tokens.
- The static host serves build output only: no proxy, edge function, or server
  rendering (a third party would see tokens and personal data). Search
  indexing, if ever, renders in the home region.
- Portals call `<region>.api` hosts cross-origin ([`backend.md`](backend.md)).
- Region tables are compiled in: `portal-ui/src/regions/<env>.json` (API
  origin, signup flags, allowed countries, recommendations, default) and
  `hub-ui/src/app/regions/<env>.json` (media origin, offered plans).
  `VITE_VETCHIUM_ENVIRONMENT` (`dev`, `ci`, `production`) selects them; the
  build fails without it. `TestPortalRegionTablesMatchCheckedInConfiguration`
  ties them to tenant configs, `signup-regions.json`, and Traefik hosts and
  CORS. Adding a region means rebuilding both portals.
- Hub and Orgs read no runtime config; the fallback locale is build-time
  `en-US`.
- The region is chosen before any personal data: sign-in and forgot-password
  show `RegionPicker` first; signup offers the eligible regions for the chosen
  country. Pre-selection: remembered region, else the recommendation for the
  first language tag naming a country, else the table default.
- A session token belongs to the region that issued it; the stored and
  in-memory session carry that region, and session requests go only there
  (`createSessionAPIOrigin`, `createRegionalSessionStorage`).
- Signed-out flows (sign-in, TOTP, forgot and reset password, signup, emailed
  links) pass their region explicitly, which sends no token. A sign-in carries
  its region through the challenge to the session. The picker, a link, or
  another tab never decides where a token goes.
- Emailed links carry `region=<tenantId>`; read it only with
  `regionFromSearchParams`. Missing or unknown shows the invalid-link state;
  never fall back to another region.
- Security headers come from `@vetchium/portal-ui/portal-build` (static-host
  `_headers` and `_redirects`, nginx include for dev and CI). Never hand-write a
  CSP or noindex rule; change the policy in the portal's `vite.config.ts`. Vite
  configs import only `portal-build`, `portal-environment`, and
  `security-headers`, which have no dependencies.
- `/u/` and `/org/` responses send `X-Robots-Tag: noindex` and render
  `NoIndex`; never disallow them in `robots.txt` (crawlers must fetch to see
  noindex). `/org/<domain>` is a placeholder.
- Expand, then contract ([`backend.md`](backend.md)): a published portal must
  work against every region during a rolling upgrade.
