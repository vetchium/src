# T10 Guides, full verification, and plan removal

Requirements: every HP-QST and HP-FRM requirement.

Guides: `review.md`, `verification.md`, `feature-build.md`.

## Steps

1. Reread HP-QST and HP-FRM against the code; record any requirement not met
   as a finding and fix it, or ask (BLOCKED) if the guide is wrong.
2. Update guides for anything the build settled that a later change must know
   (for example, where the shared answer validation lives); keep rules in one
   place.
3. `README.md`: only if developer-facing behavior changed (seeded data the
   README describes). `docs/todo.md`: add deferred items named in `BRIEF.md`
   Out of scope that are worth keeping.
4. Run `make test`; fix every failure this branch caused.
5. Commit through `dev/feature-build-commit.sh`, which removes
   `.builds/hiring-forms/`.

## Checks

`make test`.

## Acceptance

The whole suite passes, the guides describe the built behavior, and no build
files remain.

## Carried over
