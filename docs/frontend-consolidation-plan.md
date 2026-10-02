# Frontend Consolidation — Implementation Plan

Status: **in progress**. The ledger is §6. The decision record and rationale
are in [`frontend-consolidation.md`](frontend-consolidation.md). Branch:
`feature/frontend-consolidation`.

This plan is self-contained. A session with no prior conversation must be able
to resume from §0 alone. The decisions in §2 are fixed: do not re-litigate
them. Ask the product owner only when the repository contradicts a decision.

## 0. Resume protocol (read first, every session)

1. Read this file's §0–§3 and §6 only.
   - Do not read `frontend-consolidation.md` unless a §2 decision is unclear.
   - Do not re-read guides you are not about to apply.
2. Run `git status --short` and `git log --oneline main..HEAD`.
3. Find the first unchecked milestone in §6.
   - If the worktree is dirty, the changes belong to that milestone.
   - Inspect them with `git diff --stat`, then `git diff` on specific files,
     and continue rather than restart.
4. Read only the guides listed under that milestone's **Read** line.
5. Execute the milestone in §5.
6. When every **Done check** passes, finish it:
   1. Tick the ledger.
   2. Append one line to §7 with the date, commit, and any deviation.
   3. Commit.
7. **At a CHECKPOINT, continue.** The milestone is committed and recorded in
   §6 and §7, so the session's automatic context compaction can happen at any
   point without losing work. Do not stop or ask the user to run `/compact`;
   start the next milestone. Stop only when the ledger is complete, or for a
   question only the product owner can answer.

## 1. Token economy rules

- **Long commands** (`make test`, `make playwright-test`, `make test-stack`,
  `go test ./...`) write to a log in the session scratchpad, outside the
  repository. Then show only the exit code and the tail:

  ```sh
  make X > "$SCRATCH/X.log" 2>&1; echo "exit=$?"; tail -40 "$SCRATCH/X.log"
  ```

  Use `grep -nE 'FAIL|Error|✘' "$SCRATCH/X.log" | head -40` for failures.
  Never print a whole log.
- **Run `make test` and `make playwright-test` with `run_in_background`.**
  Wait for the completion notification instead of polling.
- **Read files in ranges.** Use `grep -n` first, then `sed -n 'a,bp'`. Never
  read a large file whole to find one symbol.
- **Delegate to subagents** where a milestone says so:
  - `Explore` for searches that span many files;
  - `general-purpose` for mechanical multi-file rewrites and independent
    review.

  Give each subagent a self-contained prompt: the goal, the §2 decisions that
  matter, the exact files or patterns, and "report in at most 30 lines: files
  changed, anything you could not do". Do not paste a subagent's report into
  this file.
- **Commit at the end of every milestone,** so a resume never re-derives
  finished work.
- **Commit messages:** an imperative subject and a short body. **No AI
  co-author trailer** (product owner preference for this repository). Run
  `git diff --check` and read `git status` before every commit.

## 2. Fixed decisions

| # | Decision |
| --- | --- |
| D1 | Hub and Orgs become **one global static build each**, independent of region. Production: Hub at `https://vetchium.com`, Orgs at `https://orgs.vetchium.com`, on a static-file host with managed TLS. The provider is not chosen; artefacts must be provider-neutral (`_headers`, `_redirects`). |
| D2 | **Admin is unchanged:** regional, on the same origin as `admin-api`, still served by nginx on each VM. |
| D3 | The login pages (Hub and Orgs) ask for the region **before** the credentials. The region list is **hardcoded in the UI**. The browser remembers the last region and pre-selects it, otherwise the region recommended for the browser's country. |
| D4 | **Wrong region means a generic failure.** The chosen region answers like any bad credential and never consults another region or the coordinator for Hub. Org "homed elsewhere" (domain-based) stays, but carries a region id, and the UI switches region in place. |
| D5 | Each region's API host is `<region>.api.vetchium.com`: `/api/hub/*` goes to `hub-api` and `/api/orgs/*` to `orgs-api`. TLS is terminated by Traefik on the VM, with ACME HTTP-01. The API is **not** same-origin with the UI (rationale: `frontend-consolidation.md` §2). |
| D6 | CORS is handled by **Traefik's headers middleware**, not Go. Exactly one allowed origin per API prefix. Allowed headers: `Authorization`, `Content-Type`, `Idempotency-Key`, plus any other header the UIs actually send. Only the methods the UIs use. `Access-Control-Max-Age: 86400`. No credentials mode. |
| D7 | Email links use the global hosts and carry `region=<tenant-id>`. Emails are still sent by the home region. |
| D8 | `/u/<handle>` (existing, authenticated) and a **reserved** `/org/<domain>` route showing a localized "not available yet" page. Every `/u/*` and `/org/*` response carries `X-Robots-Tag: noindex`, and the pages also carry a robots `noindex` meta tag. `robots.txt` must not disallow them. |
| D9 | **Not live:** no redirects from old `hub.<region>` and `orgs.<region>` hosts. Remove those routes and services. |
| D10 | Browser region-discovery APIs (Hub and Orgs `list-signup-regions`, and any coordinator path only they use) are **removed if no other caller exists**. The destination region stays authoritative for admission. `signup-regions.json` drops `hubURL` and `orgsURL`. |
| D11 | Problem payloads that name another region carry a **region id** (`tenant_id`) instead of a portal URL: the Hub signup-completion conflict (`hub_url`) and the Org homed-elsewhere answer (`orgs_url`). |
| D12 | Per-region portal settings move into the UI's region table: API origin, media origin, Hub plans offered. A Go test keeps the table consistent with every checked-in `config.json` and `signup-regions.json`. The Hub and Orgs fallback language becomes a build-time default of `en-US`, applied after saved and browser preferences. `runtime-config.sh` is removed from `hub-ui` and `orgs-ui`, but stays in `admin-ui`. |
| D13 | Dev and CI keep **all four regions**. |
| D14 | Not built: Org info pages, public openings, anonymous profile viewing, search indexing. |

## 3. Conventions

### Hostnames

| | Production | Dev and CI |
| --- | --- | --- |
| Hub UI | `https://vetchium.com` | `http://vetchium.localhost` |
| Orgs UI | `https://orgs.vetchium.com` | `http://orgs.vetchium.localhost` |
| Region API | `https://<r>.api.vetchium.com` | `http://<r>.api.vetchium.localhost` |
| Admin (unchanged) | `https://admin.<r>.vetchium.com` | `http://admin-ui.<r>.localhost` |
| Media (unchanged) | `https://media.<r>.vetchium.com` | `http://media.<r>.localhost` |

If FC-M1 proves that a dev hostname above does not resolve for browsers or for
Playwright, pick the nearest working form and record it in §7. Update this
table in the same commit.

### Region tables (D3, D12)

- **Shared region data** lives in `portal-ui/src/regions/`, one JSON file per
  build environment, named after the backend's `env`: `dev.json`, `ci.json`,
  and `production.json`. Dev and CI share hostnames but not data (CI turns off
  Hub signup in `deu` and offers only the free plan in `usa1`).
  - Each entry: `tenantId`, `hostingCountry`, `apiOrigin`, `signupEnabled`,
    `orgSignupEnabled`, `allowedCountries`.
  - Plus `recommendations` and `defaultTenant`, taken from
    `signup-regions.json`.
- **Hub-only data** lives in `hub-ui/src/app/regions/<env>.json`:
  `mediaOrigin` and `hubPlans` per `tenantId`. This follows
  `change-design.md`: a shared mechanism holds the shared list, and the owner
  holds its own policy.
- **Build environment selection:** `VITE_VETCHIUM_ENVIRONMENT` set to `dev`,
  `ci`, or `production`, through `loadRegionTable` in
  `@vetchium/portal-ui/regions`. Each portal's `vite.config.ts` must call it
  so the build fails when the value is unset or unknown.
- **Security headers are generated at build time** from these tables: CSP
  `connect-src` with every `apiOrigin`, and `img-src` with every media origin.
  - One generator writes both the static host's `dist/_headers` and the nginx
    include that dev and CI use, so the two cannot drift.
  - The generator's output is never committed.

## 4. Ownership map

| Owner | Affected |
| --- | --- |
| Shared portal code | `portal-ui/src` gains region tables, a region store, an API client taking an origin, region-scoped session storage, a region picker, and parsing of the region parameter in links |
| Hub portal | `hub-ui`: `api/client.ts`, `auth/session.ts`, `app/runtime-config.ts`, login, signup, complete-signup, reset-password, `/u/:address`, new `/org/:domain`, `Dockerfile`, `nginx.conf`, `runtime-config.sh` (removed) |
| Orgs portal | `orgs-ui`: the same set, plus the homed-elsewhere switch |
| Contracts | `typespec/problem/hub/signup.tsp` (`hub_url`), `typespec/problem/orgs/authentication.tsp` (`orgs_url`), `typespec/regions/*` (discovery, if removed), and the Go and TS companions |
| Backend | Email-link builders (`backend/handlers/{hub,orgs}/auth/*`: every `PublicBaseURL +`), the startup checks in `backend/cmd/{hub,orgs}-api/main.go` (`HasOrigin`, `HasOrgsOrigin`), `backend/internal/appconfig` (`publicBaseURL` validation, plans test), region discovery handlers and catalog |
| Configuration | `config/*.json`, `config/ci/*.json`, `deploy/*/config.json`, the three `signup-regions.json` files |
| Ingress | `traefik/edge.json`, `traefik/<r>.json`, `deploy/<r>/traefik.json` |
| Stacks | `docker-compose.json`, `docker-compose-ci.json`, `deploy/<r>/stack.json`, `docker-bake.hcl`, `Makefile` |
| Tests | `playwright/lib/*`; the 15 specs that reference `hub-ui.`/`orgs-ui.` hosts; new specs (FC-M8) |
| Documentation | `CLAUDE.md`, `agent-guides/{ui,playwright,hub-signup,orgs,object-storage,backend,federation}.md`, `deploy/README.md`, `docs/todo.md`, `docs/frontend-consolidation.md` (status) |

## 5. Milestones

`make test` is **expected to fail** between FC-M4 and FC-M8, while the UIs
and the stacks are mid-migration. Each milestone's narrow checks must still
pass. The full suite is required at FC-M11 and FC-M12.

### FC-M0 — Decision record and plan

- **Goal:** commit `docs/frontend-consolidation.md` and this plan.
- **Done check:** both files are committed on `feature/frontend-consolidation`.
- **CHECKPOINT.**

### FC-M1 — Regional API host with CORS (additive)

- **Read:** `backend.md` (ingress sections), `playwright.md`.
- **Steps:**
  1. Find out how `*.localhost` names resolve today for the browser and for
     Node in Playwright, for example in `playwright/lib`, `dev/`, and the
     compose `extra_hosts` and networks.
  2. Confirm that `vetchium.localhost`, `orgs.vetchium.localhost`, and
     `<r>.api.vetchium.localhost` will resolve the same way. Fix §3 if not.
  3. In `traefik/edge.json`, route `<r>.api.vetchium.localhost` to
     `traefik-<r>`.
  4. In each `traefik/<r>.json`, add routers for host
     `<r>.api.vetchium.localhost`:
     - `PathPrefix(/api/hub)` goes to `hub-api` with a CORS middleware for
       `http://vetchium.localhost`;
     - `PathPrefix(/api/orgs)` goes to `orgs-api` with CORS for
       `http://orgs.vetchium.localhost`.
     - Allowed methods and headers are per D6. Collect the exact set with
       `grep` over `portal-ui`, `hub-ui`, and `orgs-ui` (`method:`,
       `headers.set`, `Headers(`).
  5. Keep the existing per-region portal routes, so nothing breaks yet.
- **Done checks:**
  - `make repository-json-check`.
  - Run `make test-stack` (logged), then all three `curl` checks below.
  - A preflight from the right origin passes:
    `curl -si -X OPTIONS -H 'Origin: http://vetchium.localhost' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key' http://sgp.api.vetchium.localhost/api/hub/<any-route>`.
    It must show `access-control-allow-origin: http://vetchium.localhost` and
    `access-control-max-age: 86400`.
  - The same request with `Origin: http://evil.localhost` gets no
    `access-control-allow-origin`.
  - The Orgs prefix behaves the same for `http://orgs.vetchium.localhost`.
- **Commit:** "Add regional API hosts with CORS for global portals".
- **CHECKPOINT.**

### FC-M2 — Region tables and consistency test

- **Read:** `go.md`, `typescript.md`, `change-design.md`.
- **Steps:**
  1. Create the JSON tables in §3, filled from `config/*.json`,
     `config/ci/*.json`, `deploy/*/config.json`, and the
     `signup-regions.json` files.
  2. Replace `TestCheckedInHubPlansMatchPortalConfiguration` in
     `backend/internal/appconfig` with a test asserting, per environment and
     region:
     - `hubPlans` equals `hubAPIServer.offeredPlans`;
     - `mediaOrigin` equals `objectStorage.mediaBaseURL`;
     - the signup flags, allowed countries, recommendations, and
       `defaultTenant` equal `signup-regions.json`;
     - the region set equals the set of config files.

     Keep the old test until FC-M7 removes the compose environment variables
     it reads. Then delete it in that milestone.
  3. Add a typed loader in `portal-ui` that selects the table by
     `VITE_VETCHIUM_ENVIRONMENT` and validates it, failing the build on an
     unknown environment.
- **Done checks:**
  - `cd backend && go test ./internal/appconfig/...`
  - `make portal-ui-check`
  - `make test-go-static`
- **Commit:** "Add hardcoded region tables for global portals".
- **CHECKPOINT.**

### FC-M3 — Shared region mechanism in portal-ui

- **Read:** `ui.md`, `typescript.md`, `portal-ui/AGENTS.md`.
- **Steps:**
  1. Add a region store holding the selected `tenantId`:
     - remembered in `localStorage`, behind the existing try/catch pattern;
     - a remembered id not in the table is ignored;
     - default: the remembered region, then `recommendations[country]` for
       the browser's country (from its locale), then `defaultTenant`.
  2. Make `createPortalAPIClient` take an origin provider. The request URL
     becomes `${origin}${apiPrefix}${path}`.
  3. Extend the session helpers so a stored session records its `tenantId`:
     - a session whose region is unknown or missing is discarded;
     - every request uses the session's region, not the picker's.
  4. Add an accessible, localized `RegionPicker` component for all three
     locales.
  5. Add a helper that reads `region=` from a URL, validates it against the
     table, and returns `null` otherwise.
- **Done checks:**
  - `make portal-ui-check`
  - `make admin-ui-check`, which must still pass: Admin keeps a same-origin
    empty origin.
  - New unit tests for the store default order, invalid remembered ids, and
    region-parameter validation.
- **Commit:** "Add shared region selection to portal-ui".
- **CHECKPOINT.**

### FC-M4 — Hub UI goes global

- **Read:** `ui.md`, `typescript.md`, `hub-signup.md`, `hub-profile.md`
  (`/u/` rules only), `hub-ui/AGENTS.md`.
- **Agent:** first launch `Explore` (medium) to list every `hub-ui/src` use
  of the following, with file:line only:
  - `runtimeConfigValue`, `tenantId`, `hubPlans`;
  - `hubURL`, `hub_url`, `homeTenantSignIn`;
  - `apiPrefix`, `vetchium.hub.session`;
  - `list-signup-regions`, `returnTo`.
- **Steps:**
  1. **API client:** the origin comes from the session's region, or from the
     picker's before sign-in.
  2. **Login page:** the `RegionPicker` comes before the email and password.
     On failure show the generic message, plus a hint that the selected
     region may be wrong (localized).
  3. **Signup:** compute the eligible regions from the table instead of
     `list-signup-regions`, then send signup to the chosen region's API.
  4. **Complete-signup:** read `region=` from the link. On the conflict
     (`tenant_id` after FC-M6), offer to switch region and sign in.
  5. **Reset-password and other emailed-link pages:** read `region=`. An
     invalid or missing region shows the localized invalid-link state.
  6. **`/u/:address`:** unchanged behavior. Unauthenticated visits go to
     login with `returnTo`, with the region picker shown.
  7. **New `/org/:domain` route:** a localized "not available yet" page,
     reachable signed in or not, with a robots `noindex` meta tag.
  8. **Runtime config:** delete `hub-ui/runtime-config.sh` and its uses.
     Plans and media origins come from the Hub table; the fallback language
     is `en-US`.
  9. **Header generator** (§3) for Hub. Add
     `<meta name="robots" content="noindex">` handling for `/u/*` and
     `/org/*` routes.
- **Done checks:**
  - `make hub-ui-check`
  - `grep -rn "runtimeConfigValue\|hub_url\|list-signup-regions" hub-ui/src`
    returns only intended leftovers, each listed in §7.
- **Commit:** "Make the Hub portal region-independent".
- **CHECKPOINT.**

### FC-M5 — Orgs UI goes global

- **Read:** `ui.md`, `orgs.md`, `orgs-ui/AGENTS.md`.
- **Agent:** `Explore` with the FC-M4 list, adapted to `orgs-ui/src`,
  `orgs_url`, `homeTenantLogin`, and `vetchium.orgs.session-token`.
- **Steps:**
  1. Login: region picker first, then domain, email, and password. On
     homed-elsewhere, switch region in place using `tenant_id` and keep the
     entered domain.
  2. Signup and the emailed-link pages: as in FC-M4.
  3. Remove `orgs-ui/runtime-config.sh`. Add the header generator for Orgs.
- **Done checks:**
  - `make orgs-ui-check`
  - The equivalent `grep` for `runtimeConfigValue|orgs_url|list-signup-regions`.
- **Commit:** "Make the Orgs portal region-independent".
- **CHECKPOINT.**

### FC-M6 — Backend and contracts

- **Read:** `go.md`, `backend.md`, `typespec.md`, `federation.md`,
  `hub-signup.md`, `orgs.md`.
- **Agent:** first launch `Explore` (very thorough) to report, with file:line:
  1. every builder of an emailed URL (`PublicBaseURL`);
  2. every reader of `hubURL`/`orgsURL`/`hub_url`/`orgs_url` and of the
     signup-regions catalog in Go, TypeSpec, the global coordinator, and
     mesh;
  3. every caller of both `list-signup-regions` endpoints and of coordinator
     region discovery, with a verdict on whether anything other than the
     browser discovery path uses each.
- **Steps:**
  1. **D11:** replace `hub_url` and `orgs_url` in the problem types with
     `tenant_id`. Regenerate the companions. Update the handlers and Go
     tests.
  2. **D7:** every email link gets `region=<tenantId>`.
     - `publicBaseURL` becomes `http://vetchium.localhost` and
       `http://orgs.vetchium.localhost` in dev and CI, and `https://vetchium.com`
       and `https://orgs.vetchium.com` in production.
     - Remove the `HasOrigin` and `HasOrgsOrigin` startup checks.
     - Keep `publicBaseURL` origin validation.
  3. **D10:** drop `hubURL` and `orgsURL` from all three `signup-regions.json`
     files and the catalog loader.
     - Remove the discovery endpoints, contracts, handlers, coordinator paths
       and tests that the Explore report shows are browser-only.
     - Keep the startup consistency checks between catalog and config (signup
       enabled flags).
  4. Update the FC-M2 consistency test for the new catalog shape.
- **Done checks:**
  - `make typespec-check`
  - `make test-go`, `make test-go-static`, `make test-go-lint`, and
    `make test-go-vuln`, each logged.
  - `grep -rn "hub_url\|orgs_url\|hubURL\|orgsURL" backend typespec config deploy --include=*.go --include=*.tsp --include=*.json`
    is empty, or every hit is justified in §7.
- **Commit:** "Carry region ids instead of portal URLs in the backend".
- **CHECKPOINT.**

### FC-M7 — Dev and CI stacks use the global portals

- **Read:** `playwright.md` (stack sections), `verification.md`.
- **Steps:** edit the compose JSON with a short script, not by hand, in both
  compose files.
  1. Replace the eight `hub-ui-<r>`/`orgs-ui-<r>` services with one `hub-ui`
     and one `orgs-ui` service, built with `VITE_VETCHIUM_ENVIRONMENT=dev` in
     `docker-compose.json` and `ci` in `docker-compose-ci.json`.
  2. In the edge configuration, route `vetchium.localhost` and
     `orgs.vetchium.localhost` to those two services.
  3. Remove the regional Hub and Orgs portal routers, and the old
     `/api` routes under `hub-ui.<r>`/`orgs-ui.<r>`, from `traefik/<r>.json`.
  4. Update the Dockerfiles and `nginx.conf` for Hub and Orgs:
     - SPA fallback;
     - the generated security-header include;
     - `X-Robots-Tag: noindex` on `/u/` and `/org/`;
     - immutable caching of `/assets/`.
  5. Delete the old plans test, which read the removed compose environment
     variables.
- **Done checks:**
  - `make repository-json-check`.
  - `cd backend && go test ./internal/appconfig/...`.
  - Run `make test-stack` (logged), then all three `curl` checks below.
  - `curl -sI http://vetchium.localhost/u/x` shows `200`, the CSP, and
    `x-robots-tag: noindex`.
  - `curl -sI http://orgs.vetchium.localhost/login` shows `200`.
  - `curl -sI http://hub-ui.sgp.localhost/` no longer reaches a Hub portal.
- **Commit:** "Serve one global Hub and Orgs portal in dev and CI".
- **CHECKPOINT.**

### FC-M8 — Playwright

- **Read:** `playwright.md`, `playwright/AGENTS.md`.
- **Agent:** launch a `general-purpose` subagent for the mechanical
  migration. Give it:
  - the §3 hostname table;
  - the rule "API requests go to `http://<r>.api.vetchium.localhost/api/hub|orgs/...`;
    UI navigation goes to the global hosts and picks the region on the login
    page";
  - the file list from `grep -rlE "hub-ui\.|orgs-ui\." playwright --include=*.ts`
    (excluding `node_modules`).

  It must run `make playwright-check` before reporting. Main session then
  reviews `git diff --stat` and spot-checks two files.
- **New specs** (UI unless noted). Write them in the main session or hand
  them to a second subagent with this list verbatim:
  1. Hub login with the region picker succeeds. The remembered region is
     pre-selected on the next visit.
  2. A wrong region gives the generic failure plus the region hint. No
     request goes to any other region: assert on observed requests.
  3. Orgs login: a homed-elsewhere domain switches region in place, then
     succeeds.
  4. An emailed reset link with `region=` works. A missing, invalid, or
     unknown region shows the invalid-link state.
  5. An unauthenticated `/u/<handle>` goes to login with `returnTo`, then
     shows the profile after sign-in. A remote-region profile still renders.
  6. `/org/<domain>` shows the not-available page.
  7. API spec: `/u/x`, `/org/x`, and a non-profile path. Only the first two
     carry `x-robots-tag: noindex`.
  8. API spec: preflight from the allowed origin passes. A foreign origin
     gets no `access-control-allow-origin`. `/api/hub` rejects the Orgs
     origin and vice versa.
  9. Signup: eligible regions come from the table, signup goes to the chosen
     region, and the completion conflict offers the right region.
- **Done checks:**
  - `make playwright-check`
  - `make playwright-test`, run in the background and logged, with zero
    failures and no new uncovered-contract failures.
- **Commit:** "Migrate Playwright to global portals and regional API hosts".
- **CHECKPOINT.**

### FC-M9 — Production artefacts

- **Read:** `deploy/README.md`, `mesh-topology.md` (host firewall notes only).
- **Steps:**
  1. In `deploy/<r>/stack.json`, remove `hub-ui` and `orgs-ui`.
  2. Give Traefik a `websecure` `:443` entrypoint with an ACME HTTP-01
     resolver, storing `acme.json` in a new persistent volume. Publish
     `:443`, and redirect `:80` to HTTPS except for the ACME challenge path.
  3. In `deploy/<r>/traefik.json`, route on the TLS entrypoint:
     - `<r>.api.vetchium.com` to `/api/hub` and `/api/orgs`, with CORS for
       `https://vetchium.com` and `https://orgs.vetchium.com`;
     - `media.<r>.vetchium.com`;
     - `admin.<r>.vetchium.com`.
  4. Remove the `hub-ui` and `orgs-ui` targets from `docker-bake.hcl`.
  5. Add a Makefile target, for example `portal-dist`, that builds the Hub
     and Orgs bundles with `VITE_VETCHIUM_ENVIRONMENT=production` into
     provider-neutral directories with `_headers` and `_redirects` (SPA
     fallback).
  6. Update `deploy/README.md` with:
     - the static-host runbook: two sites, custom domains, 2FA, CI-only
       deploys;
     - the DNS records: `vetchium.com` and `orgs.vetchium.com` to the static
       host (the apex needs the provider's apex support — verify it), and
       `<r>.api`, `media.<r>`, `admin.<r>` as A/AAAA records to the region's
       VM;
     - the firewall rules for `:80` and `:443`;
     - the release order (expand, then contract);
     - removal of `HUB_UI_DEFAULT_LANGUAGE` and `ORGS_UI_DEFAULT_LANGUAGE`.
- **Done checks:**
  - `make repository-json-check`.
  - `make portal-dist` succeeds. The generated `_headers` contains the
    production API and media origins and `noindex` for `/u/*` and `/org/*`.
  - `cd backend && go test ./internal/appconfig/...`, covering the
    checked-in deploy files.
  - For each region: `docker stack config -c deploy/<r>/stack.json`, with the
    variables the Makefile sets, renders without error.
  - **Limitation to record in §7:** production TLS issuance cannot be
    exercised locally.
- **Commit:** "Deploy global portals as static artefacts and add API TLS".
- **CHECKPOINT.**

### FC-M10 — Guides and documentation

- **Read:** the guides being edited only.
- **Steps:** update each file in the Documentation row of §4.
  - `CLAUDE.md`: the portal and ingress sentences.
  - `ui.md`: the region table, region picker, expand-then-contract rule, and
    header generator.
  - `playwright.md`: hosts and the region picker.
  - `hub-signup.md` and `orgs.md`: region chosen in the UI, `tenant_id` in
    problems, discovery removed.
  - `object-storage.md`: the CSP source moved from `runtime-config.sh` to the
    generator.
  - `backend.md`: CORS lives in Traefik, and the release-order rule.
  - `federation.md`: only where it names portal URLs.
  - `docs/todo.md`: drop the obsolete "Hub login does not redirect to the
    home region" item; anything newly deferred is added.
  - `docs/frontend-consolidation.md`: set the status to implemented.
  - Keep each rule in one guide (`CLAUDE.md` rule).
- **Done checks:**
  - `grep -rn "hub-ui\.\|orgs-ui\.\|runtime-config.sh" agent-guides CLAUDE.md deploy/README.md`
    shows only Admin references.
  - `make fmt`, then `git diff --check`.
- **Commit:** "Document global portals and regional API hosts".

### FC-M11 — Full verification

- **Steps:**
  1. Run `make fmt`.
  2. Run `make test` with `run_in_background` and log it.
  3. Fix failures in the smallest owning layer. For more than about five
     unrelated failures, launch a `general-purpose` subagent per cluster with
     the log excerpt.
  4. Repeat until green.
- **Done check:** `make test` exits 0, and the log shows no new warnings.
- **Commit:** fixes, if any; "Fix findings from full verification".
- **CHECKPOINT.**

### FC-M12 — Independent review and close-out

- **Read:** `review.md`.
- **Agent:** launch a `general-purpose` review subagent. Give it:
  - the original product requirements (§2 of this plan, plus
    `frontend-consolidation.md` §1–§3);
  - an instruction to review `git diff main...HEAD` against `review.md`,
    `change-design.md`, and the ownership map in §4;
  - priorities: residency (no API traffic or personal data off the chosen
    region), CORS strictness, open redirects through `returnTo` and
    `region=`, noindex coverage, region isolation, and dead code left from
    the discovery removal;
  - output format: findings ranked by severity, with file:line.
- **Steps:**
  1. Fix every correctness, security, contract, and test finding.
  2. Re-run `make test` in the background.
  3. Record the review in §7: scope, findings and their resolution, and the
     commands that passed.
- **Done checks:**
  - No unresolved findings.
  - `make test` is green.
  - The ledger is fully ticked, and the Status line at the top says
    "implemented".
- **Commit:** "Close out the frontend consolidation plan".

## 6. Ledger

- [x] FC-M0 — Decision record and plan
- [x] FC-M1 — Regional API host with CORS (additive)
- [x] FC-M2 — Region tables and consistency test
- [x] FC-M3 — Shared region mechanism in portal-ui
- [x] FC-M4 — Hub UI goes global
- [x] FC-M5 — Orgs UI goes global
- [x] FC-M6 — Backend and contracts
- [x] FC-M7 — Dev and CI stacks use the global portals
- [ ] FC-M8 — Playwright
- [ ] FC-M9 — Production artefacts
- [ ] FC-M10 — Guides and documentation
- [ ] FC-M11 — Full verification
- [ ] FC-M12 — Independent review and close-out

## 7. Progress log

One line per finished milestone: date, short sha, deviations or limitations.

- 2026-10-02 — FC-M0 — decision record and plan committed.
- 2026-10-02 — FC-M1 — `<r>.api.vetchium.localhost` routes `/api/hub/` and `/api/orgs/` with Traefik CORS (GET, POST; `Authorization`, `Content-Type`, `Idempotency-Key`; max-age 86400). The §3 dev hostnames resolve for curl and Node; no change. The preflight, wrong-origin, and cross-portal-origin checks passed for all four regions, and the old portal hosts still serve.
- 2026-10-02 — FC-M2 — tables are `dev`/`ci`/`production`, not `local`/`production`, because CI data differs from dev; §3 and FC-M7 updated. `TestPortalRegionTablesMatchCheckedInConfiguration` checks both tables against configs and catalogs (mutation-checked). `loadRegionTable` exists but no portal calls it yet: FC-M4 and FC-M5 wire it into `vite.config.ts` to fail the build. All three tables are bundled; tree-shaking to the selected one is left to FC-M4.
- 2026-10-02 — FC-M3 — `@vetchium/portal-ui/region-selection` (store, default order, `region=` parsing, session-first `createRegionalAPIOrigin`), `createRegionalSessionStorage` in `session`, an optional `origin` provider plus a per-request `origin` override in `api` (for emailed-link pages), and `@vetchium/portal-ui/region-picker`. The default uses only an explicit region subtag of the first language tag that has one; no country is inferred from a bare language. The store remembers on `remember()`; the portals decide when to call it. `APIError` dropped parameter properties so Node can test `api.ts`.
- 2026-10-02 — FC-M4 — Hub is region-independent: picker first on login and forgot-password, signup regions from the table, `region=` on reset and complete-signup (missing or invalid shows the existing incomplete-link state), noindex meta on `/u/` and `/org/`, new `/org/:domain` page. Deviations: (1) the app picks its tables with a build-time constant so production bundles hold no dev or CI hosts; the Vite config loads only import-free portal-ui modules (`portal-environment`, `security-headers`) because Node in the image cannot resolve portal-ui's own dependencies. (2) Hub's `Dockerfile` and `nginx.conf` moved here from FC-M7 step 4, since removing `runtime-config.sh` required it; nginx now includes the generated `portal.conf` (verified in a container: CSP everywhere, `X-Robots-Tag` only on `/u/` and `/org/`, immutable `/assets/`). The old config dropped security headers on `/assets/`; fixed. (3) Until FC-M6, homed-elsewhere sends the user to `/login`, and links lack `region=`. (4) The Vite dev-server `/api` proxy is removed; the API is cross-origin now. `make hub-ui-check` builds with `production`.
- 2026-10-02 — FC-M5 — Orgs mirrors Hub: picker first on login and forgot-password, Org signup regions from the table with the backend's recommendation rule (country, else default, else first enabled), `region=` on reset, signup details, and complete-signup. The session moved to `vetchium.orgs.session`, still tab-scoped. Deviations: (1) the Vite plugin and build-time table read moved into `@vetchium/portal-ui/portal-build`, shared by both portals, and the now-unused `loadRegionTable` was removed. (2) Link pages in both portals remember the link's region after success, so the following sign-in pre-selects it. (3) Homed-elsewhere shows its message without the action until FC-M6 supplies `tenant_id`; `login.homedElsewhere.action` is kept for that. (4) `orgs-ui` has no tests left after `runtime-config.test.mjs`, so its `test` script and the Makefile step were removed. Orgs serves no noindex paths: D8 covers Hub's `/u/` and `/org/` only.
- 2026-10-02 — FC-M6 — D11: both homed-elsewhere problems drop the URL and keep `tenant_id` (detail text no longer says "portal"); Hub's completion conflict links to `/login?region=`, Orgs switches the picker in place and keeps the domain. D7: `handlerauth.EmailLink` puts `region=` on every emailed link, including the registered-elsewhere notice, which now points at `/login?region=<home>`; `publicBaseURL` is the global host in every config; the `HasOrigin`/`HasOrgsOrigin` checks are gone. D10: discovery was browser-only, so the Hub and Orgs endpoints, the mesh relay, the coordinator endpoint, `regionsclient`, `handlers/regions`, `typespec/regions`, and `typespec/problem/regions` are removed; the coordinator no longer loads the catalog (`signupRegionsFile` dropped from its config, stack mount, and `deploy/Makefile`), and mesh-api no longer loads or mounts it. The catalog keeps `version`, now unused by code. Deviations: (1) both login pages honor a validated `region=`, selected in memory (new `RegionStore.select`) and remembered only on sign-in or change. (2) Playwright specs for the removed endpoints were deleted here rather than in FC-M8, and URL assertions now check the fields are absent. The only grep hit is the catalog test that rejects `hubURL`/`orgsURL`.
- 2026-10-02 — FC-M7 — both compose files run one `hub-ui` and one `orgs-ui` (`VITE_VETCHIUM_ENVIRONMENT` `dev` and `ci`) on a new `portal_access` network (`.34.0/24`) shared only with the edge, which routes `vetchium.localhost` and `orgs.vetchium.localhost` and waits on both. The regional Hub and Orgs routers and portal services are gone; old hosts return 404. Tiltfile, `make dev` output, and `dev-seed` (regional API host, `region=` links) follow; the Tiltfile was evaluated with `tilt alpha tiltfile-result`. The old plans test is deleted. Step 4 (Dockerfiles, nginx) was done in FC-M4/M5. Fix found by the stack: `createRegionalSessionStorage` moved from `portal-ui/session` to `region-selection`, because the session module is shared with Admin, whose image cannot resolve `iso-3166` that region code pulls in; local checks missed it since `typespec/node_modules` exists on the host. All curl checks passed for all four regions.
