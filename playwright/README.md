# Vetchium Playwright tests

This module owns API tests under `api/` and browser tests under `ui/`.

Use Node.js 22.13 or newer.

## Install and run

From the repository root, run the complete test suite with one command:

```sh
make test
```

This performs clean npm installs and all server-independent checks first. It
then installs Chromium, recreates the CI stack from
`docker-compose-ci.json`, and runs the API and UI tests. At the end it prints
API contract coverage for operations, 2xx successes, 4xx client errors, 5xx
server errors, all declared statuses, and distinct RFC problem response
variants. Missing statuses and problem types are listed by endpoint;
responses that disagree with the generated OpenAPI contract fail the run.
To run only Playwright with the same automatic setup:

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

Direct `npm test` records API observations only when `API_COVERAGE_DIR` is set.
The root Makefile configures that directory, generates the OpenAPI document,
and renders the report automatically for `make test` and
`make playwright-test`.

`PLAYWRIGHT_BASE_URL` overrides the default
`http://admin-ui.sgp.localhost`.
