# T09 Federation: Send follows, unfollows, and block notices across tenants

## Requirements

PST-REL-002, PST-REL-005 to PST-REL-007, PST-REL-012, PST-FOL-002 to
PST-FOL-010, PST-TL-007 (Timeline deletes are added in T16), PST-GEN-004

## Guides

`agent-guides/federation.md`, `agent-guides/backend.md`, `agent-guides/go.md`,
`agent-guides/database.md`, `agent-guides/posts.md`

## Exemplars

- `backend/internal/hubreplies/hubreplies.go` (`Register`, `Replier`
  initiator, `Prepare`, `settle`, `handleRegister`, audit)
- `backend/internal/hubreplies/events.go` (`PayloadOrigin`, `DecodeEvent`,
  `CheckEvent`, `Enqueue*`)
- `backend/internal/federation/commandkinds/registry.go`,
  `backend/internal/federation/eventkinds/registry.go`

## Steps

1. New package `backend/internal/hubfollows`.
2. Command `hub-follow-set` (`Register(registry *commands.Registry)`):
   initiator is the follower Hub user (payload `follower_hub_user_did`),
   authority is the followee. Handler per PST-FOL-005 with
   `LockHubRelationship`, `SetHubFollower`, `AddHubFollowerCount`,
   `ListHubLatestLivePosts`; `Rejected` with `hub-follow-refused` when
   `is_blocked`. Audit `hub.follow.accepted` (no audit on a no-op).
3. `Prepare(tenantID, follower, followee, seq) commands.PrepareFunc` per
   PST-FOL-003 and PST-FOL-004: lock the copy; seq mismatch returns
   `hub-follow-conflict`; `HubUserBlockExists(follower, followee)` returns
   `hub-follow-blocked-by-you`; `CountHubFollowing >= 5000` or
   `CountHubFollowLogSince(now - 24h) >= 200` returns
   `hub-follow-limit-reached`; delete the mute row; set `pending`; insert
   the log row; audit `hub.follow.requested`. Keep 5,000 and 200 as named
   Go constants.
4. `RegisterSettle` per PST-FOL-006 with `SettleHubFollow`. On success it
   calls `InsertTimelineEntries` (an exported no-op function variable that
   T16 replaces with the real insert; document it in one comment). Audit
   `hub.follow.settled` only when a row changed.
5. `Unfollow(ctx, q, follower, followee)` per PST-FOL-007: copy to `none`,
   `follow_seq + 1`, enqueue `hub-follow-ended` (aggregate `hub_follow`,
   aggregate ID the follower DID, version `follow_seq`), audit
   `hub.follow.ended`. A copy in `none` or `rejected` returns without a
   change. Call `DeleteTimelineEntries` (a no-op function variable, as in
   step 4).
6. `Block(ctx, q, blocker, blocked)` and `Unblock(...)` per PST-REL-005 and
   PST-REL-007: `InsertHubUserBlock` / `DeleteHubUserBlock`; when a follow
   ended, `AddHubFollowerCount(-1)`; enqueue `hub-relationship-changed`
   (aggregate `hub_relationship`, aggregate ID the blocker DID, version the
   row `version`); `Block` also calls `Unfollow(blocker, blocked)`. Audit
   `hub.block.created` / `hub.block.removed`.
7. `Mute(ctx, q, muter, muted)`: the existing mute insert plus
   `Unfollow(muter, muted)` in the same transaction.
8. Events (`RegisterEvents(registry *events.Registry)`), added to
   `eventkinds/registry.go`:
   - `hub-follow-ended` per PST-FOL-009, origin `follower_hub_user_did`.
   - `hub-relationship-changed` per PST-REL-006 with
     `ApplyHubRelationshipChanged`, origin `owner_hub_user_did`; on a block
     it calls `DeleteTimelineEntries(remote B, author A)`.
9. Register the command in `commandkinds/registry.go`.

## Tests

`backend/internal/hubfollows/hubfollows_integration_test.go`:

- Follow succeeds, counts up, answers at most 20 posts newest first.
- A lower or equal seq is a no-op success; a blocked follower is
  `hub-follow-refused`; settle on refusal sets `rejected` and
  `blocked_by_remote`.
- Prepare refusals in order: conflict, blocked-by-you, 5,000, 200 a day;
  a mute is deleted by a follow.
- Race: follow applied then block → copy ends `rejected` whether the settle
  or the relationship event lands first.
- Unfollow event with seq above `follower_seq` clears the follower and
  counts down once; a redelivery is `duplicate`; an older one is
  `superseded`.
- Unblock sets `rejected` to `none`; block also ends the blocker's own
  follow.
- Mute ends the muter's follow.

## Checks

- `cd backend && go test ./internal/hubfollows/...`
- `make test-go`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- One command and two events are registered and tested; every write audits.

## Carried over
