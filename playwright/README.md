# Vetchium Playwright tests

This module owns API tests under `api/` and browser tests under `ui/`. Both
suites consume wire types from the local `vetchium-specs` package in
`../typespec`.

Use Node.js 22.13 or newer.

## Install and run

From the repository root, run the complete test suite with one command:

```sh
make test
```

This performs clean npm installs and all server-independent checks first. It
then installs Chromium, recreates the CI stack from
`docker-compose-ci.json`, and runs the API and UI tests. To run only
Playwright with the same automatic setup:

```sh
make playwright-test
```

With the stack and dependencies already prepared, individual Playwright
projects can be run from this directory:

```sh
npm test
npm run test:api
npm run test:ui
```

`PLAYWRIGHT_BASE_URL` overrides the default
`http://admin-ui.sgp.localhost`.
