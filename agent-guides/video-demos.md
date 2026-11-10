# Video demos

Applies to `video-demos/`: the scripted product demo recorded from the `make
dev` stack. How to run it is in [`video-demos/README.md`](../video-demos/README.md).

## Layout

- `cast.ts`: every person, Org domain, and recorded window (`ROLES`: title,
  subtitle, part, portal color and mode). Rename or recolor someone only
  here; keep every color and mode pair unique within the video.
- `stack.ts`: dev stack origins, the typed `post` helper, Mailpit, tenant SQL.
- `setup.ts`: off-camera fixtures through portal APIs and the
  `backend/cmd/dev-seed` `hub-profiles` mode; `avatars.ts` draws the Hub
  users' pictures (a picture needs Silver).
- `studio.ts`: windows (each with its portal color and mode set before the
  portal loads), screencast capture, the visible cursor, captions, and cards.
- `record.ts`: the scenes and chapter cards, in story order, in `SCENES`.
- `compose.ts`: the ffmpeg edit, title bars, caption band, cards (the cast
  card lists every window; a card may show an image or screenshots and voice
  its own `narration`, captioned a sentence at a time), and the narration
  SRT, named apart from the video because the captions are burnt in. A card
  lasts as long as its narration takes to speak, plus its `pauseSeconds`.
- `voice.ts`: the one narrator voice, Kokoro `af_heart` (`tts.py` in
  `video-demos/.venv`, from `voice-requirements.txt`), with spoken lines
  cached under `out/<run>/voice/`. Kokoro misreads some names: add each to
  `PRONUNCIATIONS` in phonemes (Thambi rhymes with "bee").
- `voiceover.ts`: speaks `narration.srt` and mixes it into
  `vetchium-demo-voiced.mp4`. A line that overruns its caption is sped up, at
  most 1.25x; keep captions short enough that none is.
- `state.ts`: numbers and URLs a run learns, so one scene can be re-recorded.
- A run writes only under `out/<run>/` (`out/final/` without `DEMO_RUN`),
  which git ignores. Never commit videos, frames, or fixtures written there.

## Writing scenes

- A scene prepares off camera (sign-in, navigation, waiting for data), then
  records one window inside `studio.onAir`. One window is on air at a time.
- Write captions and cards as a person would say them aloud: plain words,
  no slogans. Caption with `say` inside `onAir`. The studio holds each
  caption for words / 2.4 s + 0.8 s so a voiceover generated from the SRT
  fits; never shorten that. Captions describe what is on screen and must agree with it
  (times, names, statuses).
- On camera, act through `DemoWindow` (`click`, `type`, `typeLong`, `choose`,
  `setDate`, `scroll`, `pointAt`) so the cursor moves visibly. Raw `page`
  calls belong off camera.
- Fixed pauses are pacing on camera only. Waiting for state uses `expect`,
  `reloadUntil`, or `awaitHub`.
- Leave sign-in screens, repeated flows, and setup off camera: put them in
  `setup.ts` or an off-camera API call such as `scheduleOffCamera`.
- Open each act with `chapter`; a card cannot interrupt a window on air.
- Type every request with `import type` from `typespec`; Node's type
  stripping cannot load its runtime values. Pin a contract constant with
  `typeof`, as `setup.ts` does for the terms version.
- Locator rules from [`playwright.md`](playwright.md) apply.

## Known behavior

- Screencast frames ignore a context's `deviceScaleFactor`; Chromium must
  launch with `CHROMIUM_ARGS` to turn 1440x675 CSS px into 1920x900 frames.
- `DemoWindow.click` never measures the locator after clicking; a click that
  removes its element would otherwise stall 30 s on air.
- `date` and `datetime-local` inputs: use `setDate`. Typed digits overflow
  the year.
- antd Select: use `choose`, with `{ search: true }` for searchable ones.
  Close an open multi-select dropdown (click static dialog text) before
  clicking a button it covers.
- Hub application views, agency client lists, and engagement state on the
  hiring Org trail the write; wait off camera with `awaitHub` or
  `reloadUntil` before going on air.
- Ended Hub applications (Not selected, Joined) list under the Closed tab.
- An interview can be marked completed only after it starts;
  `severusFeedback` backdates both interviews in SQL off camera.
- Thambi drafts on the dev stack's local model, so the draft differs between
  runs; `openingDraft` sets the title and experience itself. Read its stills
  and captions after every rehearsal.
- Text that renders twice breaks strict mode; wait on a unique control.

## Re-recording

Follow this when asked to record the demo again, for example after portal
changes.

1. Apply the open items under "Demo video" in [`docs/todo.md`](../docs/todo.md)
   first; drop each item once done.
2. On a running stack (`make dev` if none), run `make video-demos-deps` and
   `npx playwright install chromium` in `video-demos/`.
3. Rehearse the whole story under a new `DEMO_RUN`: `npm run setup`, then
   `npm run record` with its output kept in a log.
4. On a failure, read `out/<run>/error-window-*.png` and the log, fix the
   step in `record.ts`, and rehearse again under a new `DEMO_RUN`. Resume with
   `DEMO_SCENES` only when the failed scene wrote nothing.
5. Compose the clean rehearsal. Read a still per segment and every caption in
   `-script.txt`; rewrite captions that no longer match a redesigned screen.
6. Run `make video-demo` for the final cut and report the paths and length
   of `out/final/vetchium-demo-voiced.mp4`, `narration.srt`, and
   `narration-script.txt`.

## Verifying

- Run `make video-demos-check` after any change here.
- Rehearse changed scenes on a running stack with a fresh `DEMO_RUN`, then
  read stills from the output (`ffmpeg -ss <t> -frames:v 1`) and its
  `-script.txt` before handing off.
- `timeline.json` holds only the latest `record` invocation; cut a video
  from one full run, never from `DEMO_SCENES` subsets.
