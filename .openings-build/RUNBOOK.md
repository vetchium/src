# Openings build runbook

Implements `agent-guides/openings.md` in the tasks under `tasks/`, one at a
time, on branch `features/create-openings`. All state is in `progress.md`,
so any run can stop at any moment and the next run continues.

## Each run

1. Read `.openings-build/progress.md` only. If it is missing or says
   `current: none`, report "Openings build complete" and stop.
2. Do the `phase` of the `current` task (below), then read `progress.md`
   again and continue with the next phase or task. Keep going until the
   build is complete, you are blocked, or you run out of budget.
3. Context hygiene: after each committed task, drop everything you read for
   it from working memory if your tool allows (start a fresh context and
   reread this file); never reread finished task files.

## Phases

### implement

1. Read the task file `tasks/<id>-*.md`, `AGENTS.md`, every guide the task
   lists, the scoped `AGENTS.md` of each tree you touch, and the exemplar
   files it names. `agent-guides/openings.md` is the specification; the
   specification and guides win over the task text.
2. Run `git status --short`. `## Notes` lines in `progress.md` are steps a
   previous run already finished; do not redo them. Re-check the first
   unfinished step against the working tree before continuing it.
3. Do the steps in order. After each finished step, append one line
   `- <id> step <n>: <what is done>` under `## Notes`.
4. Run the task's checks until they pass, then `make fmt` and
   `git diff --check`. Send long output to a file under `${TMPDIR:-/tmp}` and
   read only the failures.
5. Set `phase: review`.

### review

1. Reread the task file, `agent-guides/review.md`, and the requirement IDs
   the task names. Read the whole uncommitted change (`git diff`, untracked
   files), not your memory of it.
2. Check the task's acceptance list, every requirement ID, and the Check
   list in `review.md`: correctness, authorization, tenant isolation, state
   invariants, same-transaction audit, idempotency, contract agreement
   across TypeSpec, Go, and TypeScript, locales, and a named test for every
   contract response and UI behavior.
3. Write `.openings-build/review.md`: numbered defects, each with
   `file:line`, the violated rule, and the fix; or `No findings.`
4. Set `phase: fix` if there are findings, else `phase: commit`.

### fix

1. Fix every finding in `review.md`, appending one Notes line per finding.
2. Rerun the task's checks, `make fmt`, `git diff --check`.
3. Set `phase: commit`.

### commit

Run `bash .openings-build/commit.sh`. It commits with the task title,
clears Notes, and advances `current`. If it fails, fix the cause and rerun.

## Rules

- Never push, switch branches, rewrite history, or commit other than
  through `commit.sh`. Never add AI attribution to commits.
- Edit only `current`/`phase` lines through the phases above and `## Notes`
  in `progress.md`; never edit task files.
- When a product decision is needed, append `- BLOCKED: <question>` under
  `## Notes`, stop, and ask the user. On the next run, if the user answered,
  record the answer as a Notes line and continue.
- If a check fails for a reason this branch did not cause, stop and report
  it as blocked.
