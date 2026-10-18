# T31 Guides, full verification, and plan removal

Guides: `review.md`, `verification.md`, and every guide edited below.

## Steps

1. Bring the guides in line with what is built (terse rules, no history):
   `orgs.md` (catalog and portal features), `authorization.md` (presets),
   `object-storage.md` (offer letters), `glossary.md`, `docs/todo.md`
   (remove "Specified ... not built" lines that are now built; keep the
   deferred items). Change `hiring-pipeline.md` or `marketplace.md` only
   where the user approved a correction in Notes.
2. Delete `mockups/hiring-marketplace/`, its directory under
   `mockups/app/src/`, and its entry in `mockups/app/src/registry.tsx`
   (`mockups/AGENTS.md`: delete a spec's mockups once its screens ship).
3. `git grep -n -i "not built\|not yet built\|placeholder"` in guides and
   READMEs; fix what this branch made stale.
4. Run `make test`, `make test-go-lint`, and `make test-go-vuln`; fix
   failures this branch caused.
5. Read `git diff main --stat`; confirm no generated file, debug code, or
   unrelated change.
6. Remove the "Hiring build" section from `AGENTS.md` and
   `git rm -r .hiring-build/tasks .hiring-build/RUNBOOK.md`. Leave
   `progress.md` and `commit.sh`; the commit step removes them.

## Acceptance

`make test`, `make test-go-lint`, and `make test-go-vuln` pass; the guides
describe the built features; the branch holds no build tooling after the
final commit.
