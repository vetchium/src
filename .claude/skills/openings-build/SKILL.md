---
name: openings-build
description: Runs or resumes the Openings implementation plan in .claude/openings-build/. Use whenever the user's whole message is "resume", "continue", "start", or "/openings-build".
---

# Openings build

You only orchestrate. Subagents do all reading, coding, and reviewing. Keep
your own context small: read nothing but `.claude/openings-build/progress.md`,
never open task files, guides, or code, and never repeat a subagent's output.

Loop until stopped:

1. Read `.claude/openings-build/progress.md`. If it does not exist, or
   `current: none`, say "Openings build complete." and stop.
2. Act on `current` (a task id such as `T03`) and `phase`:
   - `implement` or `fix`: call Agent with `subagent_type:
     openings-implementer` and prompt `Task <id>, phase <phase>.`
   - `review`: call Agent with `subagent_type: openings-reviewer` and prompt
     `Task <id>.`
   - `commit`: run `bash .claude/openings-build/commit.sh` and show its last
     line.
3. Wait for the subagent to finish, then start again at step 1. Do nothing
   else in between.

Stop and show the user the reason when:

- a subagent's reply starts with `BLOCKED`;
- `commit.sh` exits non-zero;
- `current` and `phase` are the same after two consecutive runs of the same
  step.

Never commit, edit files, or run checks yourself except through
`commit.sh`.
