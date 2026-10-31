#!/usr/bin/env bash
# Commits the reviewed work of a feature build's current task, pushes it, and
# advances progress.md, as the commit phase in agent-guides/feature-build.md
# says. After the last task it removes the build directory.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

builds=(.builds/*/progress.md)
if [ ! -e "${builds[0]}" ]; then
	echo "feature-build-commit: no build under .builds/" >&2
	exit 1
fi
if [ "${#builds[@]}" -ne 1 ]; then
	echo "feature-build-commit: more than one build under .builds/" >&2
	exit 1
fi
progress=${builds[0]}
dir=$(dirname "$progress")

branch=$(awk '/^branch: /{print $2; exit}' "$progress")
if [ "$branch" != "$(git branch --show-current)" ]; then
	echo "feature-build-commit: build is for branch '$branch'" >&2
	exit 1
fi
current=$(awk '/^current: /{print $2; exit}' "$progress")
phase=$(awk '/^phase: /{print $2; exit}' "$progress")
if [ "$phase" != "commit" ]; then
	echo "feature-build-commit: phase is '$phase', not 'commit'" >&2
	exit 1
fi
title=$(awk -v id="$current" '$1 == id {$1 = ""; $2 = ""; sub(/^ +/, ""); print; exit}' "$progress")
if [ -z "$title" ]; then
	echo "feature-build-commit: task '$current' is not listed" >&2
	exit 1
fi
next=$(awk -v id="$current" '
	/^## Tasks/ {in_tasks = 1; next}
	/^## / {in_tasks = 0}
	in_tasks && $1 ~ /^T[0-9]+$/ && $1 != id && $2 == "todo" {print $1; exit}
' "$progress")

rm -f "$dir/review.md"
if ! git diff --check >/dev/null || ! git diff --cached --check >/dev/null; then
	echo "feature-build-commit: git diff --check failed" >&2
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
	rmdir .builds 2>/dev/null || true
fi
if git diff --cached --quiet; then
	echo "feature-build-commit: nothing staged for $current" >&2
	exit 1
fi
git commit -q -m "$title"
echo "committed $current ($(git rev-parse --short HEAD)); next: ${next:-none}"
git push -q -u origin "$branch" ||
	echo "feature-build-commit: push failed; run git push once the cause is fixed" >&2
