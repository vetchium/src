# T19 Video demos: Chat request scene

## Requirements

MKT-REQ-002, MKT-REQ-005, MKT-HUB-001, MKT-UI-012.

## Guides

`video-demos.md`, `typescript.md`.

## Exemplars

`video-demos/record.ts` scene "Sortinghat messages Hermione and suggests
the Opening" (around the "Send first message" step), `video-demos/cast.ts`.

## Steps

1. Replace the scene: Sortinghat sends Hermione a chat request with the
   Opening and a note; Hermione accepts in Hub Messages; the agency writes.
   Captions say agencies reach Hub users only about an Opening and only
   after they accept, and that no contact details are shared.
2. Rehearse the changed scenes with `DEMO_RUN` per `video-demos/README.md`.

## Tests

The `DEMO_RUN` rehearsal of the changed scenes.

## Checks

`make video-demos-check`.

## Acceptance

The demo records with the chat request scene and no `start-conversation`
use remains anywhere (`git grep -i "send first message"` is empty).

## Carried over
