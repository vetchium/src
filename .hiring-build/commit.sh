#!/usr/bin/env bash
# Commits the reviewed work of the current task, pushes it, and advances
# progress.md to the next task. Run as the RUNBOOK.md commit phase says.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
dir=.hiring-build
progress=$dir/progress.md

current=$(awk '/^current: /{print $2; exit}' "$progress")
phase=$(awk '/^phase: /{print $2; exit}' "$progress")
if [ "$phase" != "commit" ]; then
	echo "commit.sh: phase is '$phase', not 'commit'" >&2
	exit 1
fi
title=$(awk -v id="$current" '$1 == id {$1 = ""; $2 = ""; sub(/^ +/, ""); print; exit}' "$progress")
if [ -z "$title" ]; then
	echo "commit.sh: task '$current' is not listed" >&2
	exit 1
fi
next=$(awk -v id="$current" '
	/^## Tasks/ {in_tasks = 1; next}
	/^## / {in_tasks = 0}
	in_tasks && $1 ~ /^T[0-9]+$/ && $1 != id && $2 == "todo" {print $1; exit}
' "$progress")

rm -f "$dir/review.md"
if ! git diff --check >/dev/null || ! git diff --cached --check >/dev/null; then
	echo "commit.sh: git diff --check failed" >&2
	exit 1
fi

tmp=$(mktemp)
awk -v id="$current" -v next_id="${next:-none}" '
	/^current: / {print "current: " next_id; next}
	/^phase: / {print "phase: implement"; next}
	$1 == id && $2 == "todo" {$2 = "done"}
	/^## Notes/ {print; notes = 1; next}
	notes {next}
	{print}
' "$progress" >"$tmp"
mv "$tmp" "$progress"

git add -A
git reset -q -- .claude/settings.local.json 2>/dev/null || true
if [ -z "$next" ]; then
	git rm -rq --cached "$dir"
	rm -rf "$dir"
fi
if git diff --cached --quiet; then
	echo "commit.sh: nothing staged for $current" >&2
	exit 1
fi
git commit -q -m "$title"
echo "committed $current ($(git rev-parse --short HEAD)); next: ${next:-none}"
git push -q || echo "commit.sh: push failed; run git push once the cause is fixed" >&2
