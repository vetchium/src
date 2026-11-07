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
- From T18: seeded chat requests, per region `<r>` and per agency, all as `agent1@age1.<r>.test` / `agent1@age2.<r>.test` on Openings 7 and 3 of `org1.<r>.test`. `age1.<r>` uses Hub users 4 to 7 of the next region in sgp, usa1, deu, ind1 order, `age2.<r>` those of the region after it: user 4 holds the agency's pending request (Hub Messages), user 5 declined one "Not this Opening", user 6 sent a pending request (the agency's Home card and Requests tab), and the agency declined user 7's request for a window. Example: `age1.sgp.test` with `david.chen@`, `ashley.williams@`, `brian.oconnor@` and `natasha.brooks@usa1.test`. Read the user order from `dev/hub-seed-profiles/<region>.json`.
- From T19: the chat request scenes (`agencyRequest`, `hermioneAcceptsRequest`, `agencyWrites`) are scripted but were neither rehearsed nor recorded, at the developer's request; add a `docs/todo.md` "Demo video" item to rehearse them and record the demo again.
