# Hiring and marketplace build runbook

Implements `agent-guides/hiring-pipeline.md` and `agent-guides/marketplace.md`
through the tasks under `tasks/`, one at a time, on branch `init-agencies`.
All state is in `progress.md`, so any run can stop at any moment and the next
run continues.

## Each run

1. Read `.hiring-build/progress.md` only. If it is missing or says
   `current: none`, report "Hiring build complete" and stop.
2. Do the `phase` of the `current` task (below), then read `progress.md`
   again and continue with the next phase or task. Keep going until the
   build is complete, you are blocked, or you run out of budget.
3. Context hygiene: after each committed task, drop everything you read for
   it if your tool allows (start a fresh context and reread this file); never
   reread finished task files.
4. Save tokens: read the files a task names, not whole trees; search with
   `git grep` before opening files; send long command output to a file under
   `${TMPDIR:-/tmp}` and read only the failures.

## Phases

### implement

1. Read the task file `tasks/<id>-*.md`, `AGENTS.md`, the guides the task
   lists, the scoped `AGENTS.md` of each tree you touch, and the exemplars
   it names. For an exemplar commit, run `git show --stat <sha>` and open
   only the files you need. The guides are the specification; they win over
   the task text. Mockups in `mockups/hiring-marketplace/` show intended
   screens; the guides win over a mockup.
2. Run `git status --short`. `## Notes` lines in `progress.md` are steps a
   previous run already finished; do not redo them. Re-check the first
   unfinished step against the working tree before continuing it.
3. Do the steps in order. After each finished step, append one line
   `- <id> step <n>: <what is done>` under `## Notes`.
4. Run the task's checks until they pass, then `make fmt` and
   `git diff --check`.
5. Set `phase: review`.

### review

1. Reread the task file, `agent-guides/review.md`, and the requirement IDs
   the task names. Read the whole uncommitted change (`git diff`, untracked
   files), not your memory of it.
2. Check the task's acceptance list, every requirement ID, and the Check
   list in `review.md`: correctness, authorization, tenant isolation, state
   invariants, same-transaction audit, idempotency, contract agreement
   across TypeSpec, Go, and TypeScript, every portal locale (`en`, `de`,
   `ta`), and a named test for every contract response and UI behavior.
3. Write `.hiring-build/review.md`: numbered defects, each with
   `file:line`, the violated rule, and the fix; or `No findings.`
4. Set `phase: fix` if there are findings, else `phase: commit`.

### fix

1. Fix every finding in `review.md`, appending one Notes line per finding.
2. Rerun the task's checks, `make fmt`, `git diff --check`.
3. Set `phase: commit`.

### commit

Run `bash .hiring-build/commit.sh`. It commits with the task title, pushes,
clears Notes, and advances `current`. If it fails, fix the cause and rerun.

## Rules

- Never switch branches, rewrite history, or commit other than through
  `commit.sh`. Never add AI attribution to commits.
- Edit only the `current`/`phase` lines and `## Notes` in `progress.md`;
  never edit task files or this runbook.
- Implement only what the guides specify. Where a guide is silent, follow
  the nearest existing code; when that does not settle it and the choice
  changes product behavior, append `- BLOCKED: <question>` under `## Notes`,
  stop, and ask the user. On the next run, if the user answered, record the
  answer as a Notes line and continue.
- If a check fails for a reason this branch did not cause, stop and report
  it as blocked.
- A task too large for one run is fine: Notes lines let the next run resume
  mid-task. Never skip a step or a check to finish sooner.
