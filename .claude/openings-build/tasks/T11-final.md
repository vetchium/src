# T11 Guides, full verification, and plan removal

Guides: `review.md`, `verification.md`, and every guide edited below.

## Steps

1. Bring the guides in line with what is now built (terse rules, no
   history):
   - `orgs.md`: the catalog list in Permissions and plans, and the portal
     feature list.
   - `authorization.md`: the preset list (add Recruiter and Hiring
     approver).
   - `org-subscriptions.md`: the Delegation bullet (only a superadmin
     grants or revokes `org:approve_openings`).
   - `glossary.md`: the Preset entry.
   - `ui.md`: the `/org/<domain>` placeholder sentence.
   - `docs/todo.md`: remove "Openings are specified ... and not yet built";
     keep the deferred items.
   - `agent-guides/openings.md`: correct anything the implementation
     proved wrong only if the user approved it in Notes; otherwise leave it.
2. Search for stale text: `git grep -n -i "placeholder\|not built\|not yet built"`
   in guides and READMEs, and fix what this branch made stale.
3. Run `make test`, `make test-go-lint`, and `make test-go-vuln`. Fix
   failures this branch caused.
4. Read `git diff main --stat` and confirm no generated file, debug code,
   or unrelated change is present.
5. Delete the build tooling except what the commit step needs:
   `git rm -r .claude/skills/openings-build .claude/openings-build/tasks`
   and `git rm .claude/agents/openings-implementer.md
   .claude/agents/openings-reviewer.md`. Leave
   `.claude/openings-build/progress.md` and `commit.sh`; the commit step
   removes them.

## Acceptance

`make test`, `make test-go-lint`, and `make test-go-vuln` pass; the guides
describe the built feature; the branch contains no build tooling after the
final commit.
