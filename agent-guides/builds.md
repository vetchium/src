# Builds

Applies to Dockerfiles, `.dockerignore`, and the Makefile's tool targets.

After one online run, `make dev` and `make dev-seed` must build offline until
a dependency or base image changes.

## Go tools

- Pin each Go tool in its own `tools/<name>/go.mod` with a `tool` directive
  (`cd tools/<name> && GOWORK=off go get -tool <package>@<version>`), add the
  name to `TOOLS` in the Makefile, and call the binary in `$(TOOLS_BIN)` from a
  target that depends on `tools`. One module per tool keeps every tool on the
  dependency versions its own release pins.
- Never `go run <package>@<version>`: it asks the module proxy on every run,
  even with the module cached.
- Never add `tools/` to `go.work`; the tools' dependencies would raise the
  versions `backend` builds with.

## Dockerfiles

- No `# syntax=` directive: BuildKit checks the frontend image's registry
  before every build. The bundled frontend supports every instruction used.
- Pin every `FROM` image by version and digest.
- Install dependencies from manifests alone (`go.mod`/`go.sum`,
  `package.json`/`package-lock.json`, including linked local packages'
  `package.json`), then copy sources, so a source edit reuses the install layer.
- Keep downloaded dependencies in layers. Use cache mounts only for caches a
  step can rebuild locally (`/root/.cache/go-build`, `/root/.npm`), never
  `/go/pkg/mod`: BuildKit garbage-collects cache mounts while the layer that
  filled one stays cached, so a later step finds the modules gone.
- Verify an offline rebuild by changing a source file and building with
  `--build-arg HTTPS_PROXY=http://127.0.0.1:9` (and `HTTP_PROXY`); proxy
  build arguments stay out of the cache key, unlike `--network=none`.
