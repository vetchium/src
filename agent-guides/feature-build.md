# Feature build

Applies to building one product feature as a resumable sequence of tasks:
intake with the developer, the plan, and the `resume` loop. Intake and
planning need the strongest available model; any model may run the loop.

## Intake

Do these in order, with the developer, before writing any file.

1. **Summary.** Write one paragraph: who uses the feature, what it does, which
   portals and tenants it touches, and what it deliberately leaves out. Get it
   confirmed.
2. **Facts.** Read the guides that apply ([`change-design.md`](change-design.md)
   first), `docs/todo.md`, the nearest existing feature end to end (contract,
   handler, queries, portal feature folder, Playwright specs), and recent
   commits in the area.
3. **Requirements.** Ask with the structured question tool (`AskUserQuestion`
   in Claude Code; otherwise numbered questions with lettered options): at
   most four questions a round, each with two to four options filled in from
   the code and guides, the recommended option first and marked. Cover, where
   they apply: actors and permissions, delegation and presets; data, limits,
   and vocabularies; states and lifecycle; who sees what in the Orgs and Hub
   portals; tenant authority and federation; versioning of stored
   configuration against in-flight records; retention and deletion; plan
   entitlements; AI use; audit and history; notifications; out of scope.
   Repeat rounds until no product decision is open. Never ask what the code or
   a guide already settles; state it instead.
4. **Surface.** Present two tables and get them confirmed:
   - API: operation path, portal API, permission or relationship, request
     fields, success response, problem types.
   - UI: portal, route, navigation entry, what the screen shows and does, who
     sees it.
5. **Branch.** From an up-to-date default branch, `git switch -c <slug>`
   (lowercase, hyphenated feature name). Never plan on the default branch.

## Plan

Write the specification and the build directory, then commit both as
`Plan the <feature> build`.

- **Specification.** Add the decisions to the area guide as numbered
  requirements in its existing ID style (for example `HP-QST-001`), or to a new
  guide listed in `AGENTS.md`. The guide is the specification the tasks cite;
  task text never restates a rule.
- **`.builds/<slug>/BRIEF.md`**: the confirmed summary, every question with its
  answer, the API and UI tables, and the out-of-scope list.
- **`.builds/<slug>/progress.md`**, exactly:

  ```markdown
  # <Feature> build progress

  branch: <slug>
  current: T01
  phase: implement

  ## Tasks

  ### M1 <milestone name>

  T01 todo <Area>: <title, which becomes the commit subject>

  ## Notes
  ```

- **`.builds/<slug>/tasks/Tnn-<name>.md`**, one per task, with the sections
  `Requirements` (IDs), `Guides`, `Exemplars` (paths, functions, or commits to
  copy), `Steps` (numbered), `Tests`, `Checks` (from
  [`verification.md`](verification.md)), `Acceptance`, and an empty
  `Carried over`.

Task rules:

- A task fits one session and one commit, and leaves `make test` passing.
- Write for a smaller model: name exact files, packages, operation paths,
  table and column names, limits, problem types, locale keys, and test file
  names. No "as discussed", no "similar to above".
- Order: contract (TypeSpec with Go and TypeScript companions), schema and
  queries, handlers and workers, Playwright API specs, portal UI, Playwright UI
  specs, development fixtures, then a final task. Group them into milestones
  (`### M1` …), each ending in a usable, tested slice.
- Every task names the tests that prove each requirement it implements.
- The final task updates `README.md` for any developer-facing change (new
  commands, services, configuration, seeded accounts), `docs/todo.md` for
  deferred items, runs `make test`, and removes `.builds/<slug>/`.

## Resume

When the developer's whole message is `resume` or `start`:

1. Find the build: the one directory under `.builds/`. If there is none, or
   `progress.md` says `current: none`, report "No build in progress" and stop.
   If `branch:` differs from the checked-out branch, stop and ask.
2. Do the `phase` of the `current` task (below), then reread `progress.md` and
   continue with the next phase or task until the build is complete, you are
   blocked, or you run out of budget.
3. After each committed task, drop what you read for it if your tool allows,
   and never reread finished task files.
4. Read only the files a task names; search with `git grep` before opening
   files; send long command output to a file under `${TMPDIR:-/tmp}` and read
   only the failures.

### implement

1. Read the task file, `AGENTS.md`, the guides and exemplars it names, and the
   scoped `AGENTS.md` of each tree you touch. The guides win over the task
   text, and the task text over `BRIEF.md`.
2. Run `git status --short`. Each `## Notes` line is a finished step; do not
   redo it. Re-check the first unfinished step against the working tree.
3. Do the steps in order. After each, append `- Tnn step <n>: <what is done>`
   under `## Notes`.
4. Run the task's checks until they pass, then `make fmt` and
   `git diff --check`.
5. Set `phase: review`.

### review

1. Reread the task file, [`review.md`](review.md), and every requirement ID
   the task names. Read the whole uncommitted change (`git diff` and untracked
   files), not your memory of it.
2. Check the acceptance list, each requirement, and the `review.md` Check list.
3. Write `.builds/<slug>/review.md`: numbered findings, each with `file:line`,
   the violated rule, and the fix; or `No findings.`
4. Set `phase: fix` if there are findings, else `phase: commit`.

### fix

1. Fix every finding, appending one Notes line per finding.
2. Rerun the checks, `make fmt`, and `git diff --check`.
3. Set `phase: commit`.

### commit

1. Append work a later task must pick up to that task's `Carried over`
   section, prefixed `From Tnn:`.
2. Run `bash dev/feature-build-commit.sh`. It commits with the task title,
   pushes, clears Notes, and advances `current`; after the last task it
   removes the build directory. If it fails, fix the cause and rerun.

### Rules

- Never switch branches, rewrite history, or commit except through
  `dev/feature-build-commit.sh`. Never add AI attribution.
- In `progress.md` edit only `current`, `phase`, and `## Notes`. Never edit
  `BRIEF.md` or task files except to append to `Carried over`.
- Implement only what the guides specify. Where a guide is silent, follow the
  nearest existing code; when that does not settle a choice that changes
  product behavior, append `- BLOCKED: <question>` under `## Notes`, stop, and
  ask. On the next run, record the answer as a Notes line and continue; put a
  lasting answer in the guide in the same task.
- If a check fails for a reason this branch did not cause, stop and report it
  as blocked.
- Never skip a step or a check to finish sooner; Notes let the next run resume
  mid-task.
