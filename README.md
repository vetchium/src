# Vetchium வெட்சியம்

![Vetchium V composed of multicolor Ixora flowers](V.png)

**Vetchium** draws its name from **வெட்சி** (_Vetchi_) in Tamil tradition:

- [**The Vetchi flower**](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF), identified with [Ixora](https://en.wikipedia.org/wiki/Ixora), a flowering shrub native to Southern India.
- [**வெட்சித் திணை** (_Vetchi thinai_)](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF%E0%AE%A4%E0%AF%8D_%E0%AE%A4%E0%AE%BF%E0%AE%A3%E0%AF%88), **`ஆநிரை கவர்தல் வெட்சி`** a theme in classical Tamil _puram_ poetry in which warriors seize Cattle (Wealth) from a rival land.

A professional networking and jobs platform. Each region (`sgp`, `usa1`, `deu`,
`ind1`) runs an isolated stack: database, object store, APIs, workers, and the
Admin portal. The Hub and Orgs portals are one static site each, shared by all
regions; the user picks the region at sign-in.

## Requirements

Docker with Compose, GNU Make, Go 1.27.3, Node.js 22.13 or newer. Optional:
[Tilt](https://tilt.dev).

## Run locally

```bash
make dev        # clean, then start the full stack with all four regions
make dev-seed   # clean, start the stack, then seed Hub users, Orgs, and marketplace
make clean      # stop everything and delete volumes and dev secrets
```

Generated database code (`backend/internal/db/sqlc/` and
`backend/internal/globaldb/sqlc/`) is not committed. `make dev`, `make backend`,
`tilt up`, and the test targets generate it; run `make sqlc` after changing SQL
queries or migrations so your editor sees the new code.

`make dev-seed` runs `make dev` itself, so it starts from a clean stack and can
be run at any time; do not run `make dev` first. It prints each seeded Hub
user's handle, email, region, and plan.

| What | URL |
| --- | --- |
| Hub portal | http://vetchium.localhost |
| Orgs portal | http://orgs.vetchium.localhost |
| Admin portal | http://admin-ui.`<region>`.localhost |
| Region API | http://`<region>`.api.vetchium.localhost |
| Mailpit (all outgoing mail) | http://127.0.0.1:18025 |

`EDGE_PORT` and `MAILPIT_PORT` change the published ports.

Tilt runs the same stack with per-service logs and incremental rebuilds:

```bash
tilt up                     # all regions
tilt up -- --tenants sgp    # one region (repeat the flag for more)
tilt up -- --manual         # build once, rebuild on demand
tilt down                   # stop; volumes and secrets survive
```

Every backend service builds from one Dockerfile, so a backend change rebuilds
all of them; use `--manual` or one region when that is too slow.

## AI models

Drafting Openings with AI calls models through Docker Model Runner on your
machine. Turn it on once and pull the two development models (about 4 GB):

```bash
docker desktop enable model-runner
make dev-ai-models   # ai/qwen3:1.7b and ai/ministral3:3B-Q4_K_M, 16k context
```

The stack's `ai-dev` service relays model calls to Model Runner, which the
internal region networks cannot reach directly. Without Model Runner, a draft
fails with "The AI model did not answer" and uses no credits. Tests never use
Model Runner: the CI stack runs `ai-dev` as a fake model server.

If a draft fails, `docker model logs` shows Model Runner's reason. Rerun
`make dev-ai-models` after restarting Docker Desktop if Ministral answers
"Compute error" (out of GPU memory): it restores the 16k context size.

## Seeded accounts

`make dev-seed` ends by printing every seeded account with its portal link,
read back from each region's database, so the list always matches what was
seeded. `make dev-accounts` prints it again on a running stack. Every account
uses the password `DevPassword123$`.

The seeds give each region (`sgp`, `usa1`, `deu`, `ind1`) Admin users with
each combination of access and state, eight Hub users
(`dev/hub-seed-profiles/<region>.json`), three hiring companies
(`org1`–`org3.<region>.test`, one per plan, with Openings and applications in
every state, application questions answered and later revised, and interview
feedback on feedback forms), two staffing agencies (`age1`, a client of every
hiring company in every region with Jobs spread across `agent1@`… owners;
`age2`, for its own region), and one interviewing, assessment, and background-verification
provider each (`itv1`, `asm1`, `bgv1`) with routed work.

Every seeded address ends in `.test`, such as `admin@sgp.test`,
`wei.tan@sgp.test`, and `agent1@age1.sgp.test`. Hub signup accepts addresses at `<region>.test`; `sgp` also accepts
`test1.test` to `test100.test`. Signup and reset emails arrive in Mailpit.

### Org signup domains

Org signup proves domain ownership with a DNS TXT record. In development and CI
the tenants skip that check for any domain ending in `.test` or `.example`
(`google.test`, `acme.example`): signup completes with no record published.
The seeded Orgs use such names. `example.com`, its subdomains, and every other
domain still get the real lookup against the local `dns-dev` server.
Production never skips it.

## Test

```bash
make test             # every check, the CI stack, and all Playwright tests
make playwright-test  # only Playwright, with the same setup
make fmt              # apply every formatter
```

`make test` leaves the CI stack running for inspection and prints Go coverage
and API contract coverage. Narrower targets per area: `make test-go`,
`make typespec-check`, `make hub-ui-check`, `make orgs-ui-check`,
`make admin-ui-check`, `make portal-ui-check`, `make playwright-check`,
`make sql-check`.

## Build a feature with a coding agent

Describe the feature to the agent (in Claude Code, `/feature-build <one-line
idea>`). It asks about requirements, confirms the API operations and portal
routes with you, creates a branch, and commits the specification and a task
plan under `.builds/<branch>/`. Then send `resume` in any session, with any
model, to build it task by task; each task is reviewed, committed, and pushed.
`.builds/<branch>/progress.md` shows where the build stands, and the last task
removes the directory. The process is in
[`agent-guides/feature-build.md`](agent-guides/feature-build.md).

## Publish

```bash
make docker                 # build every image
make publish TAG=v1.2.3     # build and push images
make portal-dist            # build the Hub and Orgs static sites into portal-dist/
```

Production deployment: [`deploy/README.md`](deploy/README.md).

## Demo video

```bash
make video-demo   # records the product demo into video-demos/out/final/
```

Details, rehearsal runs, and prerequisites: [`video-demos/README.md`](video-demos/README.md).
