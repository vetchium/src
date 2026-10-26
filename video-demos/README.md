# Video demos

Scripts that record the Vetchium product demo from the development stack:
several browser windows, one per person, edited into one video with a title
bar naming who is on screen and burnt-in captions. The captions are also
written as SRT and a plain script, ready for a generated voiceover.

## The story

Sortinghat, a recruitment agency, and Gryffindor, a hiring Org, take three Hub
users from application to outcome:

1. Sortinghat signs up, moves to Silver, lists its Sourcing service, finds
   Hermione Granger by alias, and keeps a private note on her.
2. Gryffindor (Albus Dumbledore) creates and publishes an Opening, proposes an
   engagement to Sortinghat, and assigns it to the Opening once accepted.
3. Sortinghat messages Hermione and suggests the Opening; she applies through
   the agency. Draco Malfoy and Lord Voldemort apply directly.
4. Voldemort is turned down at once; Hermione and Draco are interviewed.
   Draco is turned down after his interview; Hermione gets an offer, accepts,
   and joins.
5. Each applicant follows their own status on the Hub, and Sortinghat sees
   its credited hire.

Albus's colleague Minerva McGonagall, the pipeline template, and the three Hub
users with full profiles are created off camera by `setup.ts`.

## Prerequisites

- Everything `make dev` needs (Docker, Go, Node 22.13 or later).
- `ffmpeg` and `ffprobe` with libx264 (`brew install ffmpeg`).

## Record the final video

```bash
make video-demo
```

This recreates the dev stack (`make dev` wipes its data), creates the
fixtures, records every scene, and writes into `video-demos/out/final/`:

- `vetchium-demo.mp4`: 1920x1080, about seven minutes.
- `vetchium-demo.srt`: the captions, timed to the video.
- `vetchium-demo-script.txt`: the same captions as a timestamped script.

Recording takes about ten minutes; keep the machine awake. `out/` is ignored
by git.

## Record again after portal changes

Ask Claude to "re-record the demo video"; the steps it follows, including
applying the pending "Demo video" items in `docs/todo.md` (such as each
account's color scheme), are in
[`agent-guides/video-demos.md`](../agent-guides/video-demos.md). By hand, the
same flow is a rehearsal below until every scene passes, then
`make video-demo`.

## Rehearse on a running stack

The first time, install the scripts and their browser:

```bash
make video-demos-deps
cd video-demos && npx playwright install chromium
```

Each `DEMO_RUN` gets its own Org domains, Hub addresses, and output folder,
so runs can repeat on one stack without `make dev`:

```bash
cd video-demos
DEMO_RUN=try1 npm run setup
DEMO_RUN=try1 npm run record
DEMO_RUN=try1 npm run compose
```

To redo some scenes of a run, name them (see `SCENES` in `record.ts`):

```bash
DEMO_RUN=try1 DEMO_SCENES=triage,voldemortTracks npm run record
```

Earlier scenes' results (the Opening and application numbers) come from
`out/try1/state.json`. Only the latest `record` is kept for `compose`, so cut
the video from a full run. A failed scene leaves a screenshot of each window
as `out/<run>/error-window-<n>.png`.

## Changing the demo

- People, domains, and the window title bars: `cast.ts`.
- Captions and on-screen steps: the scenes in `record.ts`.
- Title cards, layout, and encoding: `compose.ts`.

`make video-demos-check` formats, type-checks, and audits the scripts;
`make test` runs it too. Requests are typed against `typespec/`, so a contract
change that breaks the demo fails the check.
