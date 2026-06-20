# Exploratory UI test run

A scripted, manual-tester-style sweep of the **Hub** and **Org** portals that drives
the real UI through headless Chromium — one isolated browser profile per persona —
co-ordinating an org (Gryffindor), a staffing agency (Floo Network) and several hub
users through the full hiring + marketplace + agency-referral workflows.

It exists to surface **bugs, usability problems, UI failures, RBAC mismatches and
validation gaps** that the assertion-based `npm test` suite is not looking for. Every
step takes a screenshot and records browser console errors, page errors and 4xx/5xx
responses, so problems show up even when the happy path "works".

> This is **separate** from `npm test`. It is not part of CI, asserts almost nothing,
> and is meant to be run by a human who then reviews the screenshots + issue summary.

## How it differs from `npm test`

|                                 | `npm test` (playwright/tests)           | Exploratory run (this folder)                   |
| ------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Stack                           | `docker-compose-ci.json` (short tokens) | `docker-compose-full.json` (real-ish tokens)    |
| Data                            | each test seeds its own throwaway data  | the shared `seed-users` Harry-Potter dataset    |
| Style                           | deterministic asserts, parallel         | sequential journey, screenshots + error capture |
| Picked up by `playwright test`? | yes (`tests/**/*.spec.ts`)              | **no** (plain `.js`, outside `tests/`)          |
| Output                          | pass/fail                               | `output/shots/*.png` + `output/issues/*.json`   |

Because the files here are `.js` under `exploratory/` (not `*.spec.ts` under `tests/`),
`playwright test` / `npm test` never collects them — the two are fully independent.

## Prerequisites

1. **Bring up the full stack with seed data** (from `src/`):

   ```bash
   docker compose -f docker-compose-full.json up --build -d
   ```

   Wait for the one-shot **`seed-users`** container to finish successfully — it creates
   the hub users, house orgs, the Floo Network agency, Gryffindor's openings and the
   marketplace subscription that these scripts rely on:

   ```bash
   # blocks until seeding is done; prints the seed summary
   docker compose -f docker-compose-full.json logs -f seed-users
   ```

   The seed accounts (all password `Password123$`) are documented in the root
   [`README.md`](../../README.md#test--seed-users). The scripts assume that dataset
   as-is: Gryffindor openings `#1..#6`, hub users `harry/hermione/ron/cho/neville/luna/draco@hub.example`,
   org `gryffindor.example` + agency `floonetwork.example`.

2. **Install Playwright + its browser** (once, from `playwright/`):

   ```bash
   cd playwright
   npm install
   npx playwright install chromium
   ```

## Running

```bash
cd playwright

# everything, in order
./exploratory/run-all.sh

# or a single phase (still needs the stack + seed)
NODE_PATH="$PWD/node_modules" node exploratory/scripts/00-smoke.js

# or a subset by phase number
./exploratory/run-all.sh 00 03 04 05
```

Useful env vars: `HEADED=1` (watch the browsers), `EXPLORE_OUT=/path` (move output),
`ORG_URL` / `HUB_URL` / `MAILPIT_URL` (point at a non-default stack).

After a run, review:

- `exploratory/output/shots/NNN_*.png` — chronological screenshots of every screen/step.
- `node exploratory/aggregate.js` — de-duplicated, count-sorted list of all console
  errors / page errors / 4xx-5xx responses captured across the run.

## Phases (run in order — later phases reuse ids from earlier ones)

| Phase | Script                         | What it exercises                                                        |
| ----- | ------------------------------ | ------------------------------------------------------------------------ |
| 00    | `00-smoke.js`                  | login (org/agency/hub) + dashboards — verifies stack + harness           |
| 01    | `01-org-admin-tour.js`         | read-only tour of every org-admin screen + 404                           |
| 02    | `02-org-admin-writes.js`       | invite a Tech Interviewer (+complete-setup), grant Harry candidacy roles |
| 03    | `03-hub-apply.js`              | 6 hub users apply to Gryffindor openings (resume upload)                 |
| 04    | `04-org-review.js`             | shortlist / reject / label applications → candidacies                    |
| 05    | `05-schedule-interview.js`     | schedule an interview with an interviewer on the panel                   |
| 06    | `06-interviewer-feedback.js`   | interviewer RSVP + submit feedback                                       |
| 07    | `07-extend-offer.js`           | extend an offer (offer-letter upload)                                    |
| 08    | `08-hub-offer-view.js`         | candidate views the offer on the hub side                                |
| 09    | `09-agency-explore.js`         | tour of the agency portal screens                                        |
| 10    | `10-agency-assign-refer.js`    | consumer assigns the agency to an opening; capture a candidate handle    |
| 11    | `11-agency-refer-workspace.js` | agency refers the candidate from its opening workspace                   |
| 12    | `12-referral-apply.js`         | candidate applies _via_ the referral → agency-attributed application     |
| 13    | `13-marketplace-subscribe.js`  | a fresh org discovers + subscribes to the agency's listing               |
| 14    | `14-i18n.js`                   | switch de-DE / ta-IN, scan for untranslated keys                         |
| 15    | `15-rbac-validation.js`        | read-only user write-button visibility; login/field validation           |
| 16    | `16-extras.js`                 | opening pause/reopen, hub profile page, logout + route guard             |

## Notes / limitations

- **State is cumulative.** The scripts mutate seed data (shortlist, schedule, offer,
  upgrade plan, …). For a clean repeat, reset the stack first:
  `docker compose -f docker-compose-full.json down -v && docker compose -f docker-compose-full.json up --build -d`.
- Persona browser profiles persist under `output/profiles/`; logins are session-aware
  and reused across phases. Delete `output/` to force fresh logins.
- Selectors target AntD **v6** DOM (the `.ant-select` wrapper is the click target,
  option lists are virtualised — see `pickSelect` / `chooseOption` in `lib.js`).
- This is a journey harness, not an oracle: it reports what it _sees_ (screens + console/
  network errors). A human still reviews the screenshots and the aggregate to judge them.
