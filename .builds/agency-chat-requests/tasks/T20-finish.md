# T20 Builds: Finish the agency chat requests build

## Requirements

All MKT-REQ IDs; `feature-build.md` final-task rules.

## Guides

`feature-build.md`, `review.md`, `verification.md`.

## Exemplars

`README.md` configuration and seeded-accounts sections; `docs/todo.md`
"Hiring pipeline and marketplace".

## Steps

1. `README.md`: document `marketplace.conversationWindow` and the seeded
   chat requests (who to sign in as to see each).
2. `docs/todo.md`: in the marketplace section, replace "email notifications
   to Org users for new messages" with "email notifications to Org users
   for new messages and chat requests", and add: blocking an agency
   outright and reporting its requests (decide scope and Admin review);
   Hub requests to agencies not assigned to an Opening (decided against
   for now; revisit with abuse data).
3. Read every MKT-REQ requirement against the code and tests once more;
   fix gaps here.
4. `make test`.
5. Let `dev/feature-build-commit.sh` remove `.builds/agency-chat-requests/`.

## Tests

`make test`.

## Checks

`make test`, `git diff --check`.

## Acceptance

README and todo updated; `make test` passes; the build directory is gone.

## Carried over
