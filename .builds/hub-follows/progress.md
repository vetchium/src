# Hub follows build progress

branch: hub-follows
current: T01
phase: implement

## Tasks

### M1 Post cleanups and tags

T01 todo Contracts: Replace post policies with Allow replies and add post tags
T02 todo Database: Replace post policies, add post tags, and drop quote detach
T03 todo Hub API: Serve Allow replies, post tags, and the new quote rules
T04 todo Playwright: Test Allow replies, post tags, and quote rules
T05 todo Hub portal: Replace the policy controls with Allow replies and tags
T06 todo Playwright: Test the Allow replies, tag, and quote screens

### M2 Relationships and follows

T07 todo Contracts: Add Hub follows and relationship state
T08 todo Database: Add Hub relationship rows, copies, and the follow log
T09 todo Federation: Send follows, unfollows, and block notices across tenants
T10 todo Hub API: Serve follows, relationship state, and block freezes
T11 todo Playwright: Test Hub follow and block APIs
T12 todo Hub portal: Add Follow, the Following page, and blocked states
T13 todo Playwright: Test the follow and block screens

### M3 Timeline feed

T14 todo Contracts: Add the Hub Timeline list
T15 todo Database: Add Timeline entries and post fan-out columns
T16 todo Workers: Fan out posts to followers and trim Timelines
T17 todo Hub API: Serve the Timeline
T18 todo Playwright: Test the Hub Timeline API
T19 todo Hub portal: Show the feed on Timeline
T20 todo Playwright: Test the Timeline screens

### M4 Fixtures and finish

T21 todo Dev seed: Add follows, tags, and Allow replies to the fixtures
T22 todo Build: Finish the Hub follows build

## Notes
