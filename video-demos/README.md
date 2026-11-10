# Video demos

Scripts that record the Vetchium product demo from the development stack:
several browser windows, one per person, edited into one video with a title
bar naming who is on screen and burnt-in captions. The captions are also
written as SRT and a plain script, ready for a generated voiceover.

## The story

The video opens with the Vetchium logo and what Vetchium is, a card on its
two portals (the Hub for individuals, the Orgs portal for organizations),
and an overview of the scenario. Hogwarts then hires a Software Architect
with ten years of experience, partly through Ollivanders, a sourcing agency.
Seven people each have their own window, portal color, and light or dark
mode, kept for the whole video and introduced on a cast card. Chapter cards
separate six acts:

1. The hiring Org gets ready: Minerva McGonagall builds a pipeline template
   with an interview stage and its feedback form, drafts the Opening with
   Thambi from a short prompt, adds application questions, previews it, and
   submits it for approval; Albus Dumbledore approves it and reviews the Org's
   AI usage.
2. A sourcing agency joins: Garrick Ollivander signs Ollivanders up, moves to
   Silver, lists its Sourcing service, and keeps a private note on Hermione
   Granger, found by her alias.
3. Hogwarts engages the agency: Minerva proposes an engagement, Ollivanders
   accepts, Minerva assigns it to the Opening, and Garrick owns the Job and
   sends Hermione a chat request.
4. Candidates apply on the Hub: Hermione shows her profile, accepts the
   request, and applies crediting Ollivanders; Ron Weasley and Draco Malfoy
   apply directly; each answers Hogwarts' questions; Ron tracks his
   application.
5. Hogwarts processes the applications: Minerva shows the Opening's
   pipeline and compares the answers as columns; Draco is turned down at
   review; Hermione and Ron are interviewed, Ron after asking for another
   time; Severus Snape gives blind feedback through My interviews; Ron is
   turned down; Hermione gets an offer, accepts, and joins.
6. Where everyone stands: Hermione's Hub view, the agency's credited
   application and activity statement, and Albus closing the Opening.

Minerva, Severus, AI drafting, and the three Hub users with full profiles and
illustrated pictures (`avatars.ts`) are created off camera by `setup.ts`. Ron's interview, his
acceptance of the new time, and the feedback not given on camera are
created off camera by `record.ts`. The portals card shows the Hub and Orgs
Home pages of Hermione and Minerva, captured off camera in their own windows;
the logo is the repository's `V.png`.

## Prerequisites

- Everything `make dev` needs (Docker, Go, Node 22.13 or later).
- `ffmpeg` and `ffprobe` with libx264 (`brew install ffmpeg`).
- The development AI models (`make dev-ai-models`, once): Thambi drafts the
  Opening on camera.

## Record the final video

```bash
make video-demo
```

This recreates the dev stack (`make dev` wipes its data), creates the
fixtures, records every scene, and writes into `video-demos/out/final/`:

- `vetchium-demo.mp4`: 1920x1080, about fifteen minutes.
- `narration.srt`: the captions, timed to the video, for generating a
  voiceover.
- `narration-script.txt`: the same captions as a timestamped script.

The captions are already burnt into the video. Don't upload `narration.srt`
as a subtitle track (on YouTube or elsewhere): viewers would see every line
twice. It is named apart from the video so players such as VLC don't load it
automatically.

Recording takes about twenty minutes; keep the machine awake. `out/` is ignored
by git.

## Record again after portal changes

Ask Claude to "re-record the demo video"; the steps it follows, including
applying the pending "Demo video" items in `docs/todo.md`, are in
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

To redo some scenes of a run, name them (see `SCENES` in `record.ts`), or
resume a failed rehearsal from one scene with `DEMO_FROM=<scene>`:

```bash
DEMO_RUN=try1 DEMO_SCENES=triage,dracoTracks npm run record
```

Earlier scenes' results (the Opening and application numbers) come from
`out/try1/state.json`. Only the latest `record` is kept for `compose`, so cut
the video from a full run. A failed scene leaves a screenshot of each window
as `out/<run>/error-window-<n>.png`.

## Changing the demo

- People, domains, portal colors and modes, and the title bars: `cast.ts`.
- Captions, on-screen steps, the introduction, and chapter cards: the scenes
  in `record.ts`.
- Card and title bar layout, and encoding: `compose.ts`.

`make video-demos-check` formats, type-checks, and audits the scripts;
`make test` runs it too. Requests are typed against `typespec/`, so a contract
change that breaks the demo fails the check.
