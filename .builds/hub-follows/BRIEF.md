# Hub follows build brief

## Summary

Hub users on every plan follow and unfollow other Hub users in any region.
The sidebar "Timeline" becomes a feed: the user's own posts and quotes and
those of followed users, newest first, with the composer on top. Each user's
home tenant holds one relationship row per other user (that user follows
them, they block that user) as the authority, and one relationship copy (their
own follow state, whether that user blocks them) for screens. A follow is a
durable command to the followed user's tenant; unfollow, block, and unblock
travel by outbox events. New posts reach followers' tenants as Timeline
entries by event, in batches from a job; a region that is down catches up by
itself and no error shows. No one sees a followers list; everyone sees a
follower range. Only the user sees their following count and list. Mutes stay
local; a mute ends the muter's follow, and Follow removes the mute.

Cleanups in the same build: one "Allow replies" switch replaces reply policy,
quote policy, and lock. Everyone quotes another user's post unless the owner
blocked them; no one quotes their own post; Detach is removed. A blocked user
is told on the profile, post, and thread screens and cannot follow, reply,
quote, or edit replies toward the blocker. Posts and quotes take up to 3 tags
from the Opening tag catalog, edited with the words inside 30 minutes.

The specification is `agent-guides/posts.md`.

## Usability audit of the existing screens

1. Reply policy, quote policy, and lock overlap; lock and reply `nobody` do
   the same thing.
2. The composer and the quote dialog ask two policy questions every time.
3. A blocked user sees Reply and Quote and is refused only after submitting.
4. The Quote button shows on the user's own posts.
5. Detach contradicts "a quote is a link".
6. Timeline repeated the own Posts tab; there was no feed.
7. "0 quotes" linked to an empty page.
8. Posts had no tags.

## Questions and answers

| Question | Answer |
| --- | --- |
| Where is a follow stored? | The followed or blocking user's tenant is authoritative for both follow and block on one row; the other tenant keeps a copy. Follow is a command; block notices travel by outbox. |
| Block and follows | A block ends follows in both directions. |
| Timeline content | Own posts and quotes plus followed users', newest first, composer on top; unavailable regions are left out silently and recover by themselves. |
| Feed mechanism | Pushed references (Timeline entries) by event. |
| Blocked user's view | Told up front: no reply composer, no Quote, no Follow, a line instead. |
| Reply control | One "Allow replies" switch, default on, changeable any time; quote policy and lock removed. |
| Author replies when replies are off | Yes, only the author, at every level. |
| Quote targets | Another user's live post or quote, or a published Opening; never the user's own. |
| Detach | Removed. |
| Tag vocabulary | The Opening tag catalog. |
| Tag click | Nothing; tags are display only. |
| Tag edits | With the words inside the 30-minute window. |
| Backfill on follow | The followed user's latest 20 posts and quotes. |
| Followers list | Never shown to anyone; only the follower range is public. |
| Follower range | Powers of ten: none, 1–9, 10–99, 100–999, 1,000–9,999, 10,000–99,999, 100,000+. |
| Following list and count | Only the account owner. |
| Limits | 5,000 following; 200 follows a rolling day; followers unlimited. |
| Mute and follow | A mute ends the follow; Follow on a muted user unmutes. |
| Timeline retention | Newest 1,000 entries per user and 90 days. |
| Block symmetry | One-way: the blocker may still reply to and quote the blocked user. |
| Reply edits after a block | Frozen: the blocked user cannot edit replies on the blocker's posts or below the blocker's replies. |
| Reply edits after replies are off | Allowed. |
| Discovery | Out of scope; recorded in `docs/todo.md`. |
| Fan-out cost | One event per follower in batches of 1,000; a gRPC stream or shared firehose goes to `docs/todo.md`. |

## API

All Hub API operations need an authenticated Hub user.

| Operation | Request | Success | Problems |
| --- | --- | --- | --- |
| `POST /api/hub/follows/follow` | `Idempotency-Key`, `user` (address) | `204`, `202` `PendingOperation` | `validation-failed`, `hub-profile-not-found`, `hub-profile-unavailable`, `hub-follow-refused` 403, `hub-follow-blocked-by-you` 409, `hub-follow-conflict` 409, `hub-follow-limit-reached` 429, `hub-follow-unavailable` 503, `idempotency-key-conflict` |
| `POST /api/hub/follows/unfollow` | `user` | `204` | `validation-failed`, `hub-profile-not-found`, `hub-profile-unavailable` |
| `POST /api/hub/follows/list` | `pagination_key`, `limit` 1–50 | `users` (handle, `state`, `followed_at`), `following_count`, `next_pagination_key` | `invalid-pagination-key` |
| `POST /api/hub/relationships/state` (replaces `/api/hub/blocks/state`) | `user` | `follow`, `blocked`, `muted`, `blocked_by_them` | `validation-failed`, `hub-profile-not-found`, `hub-profile-unavailable` |
| `POST /api/hub/profile/read` (changed) | unchanged | adds `follower_range` | unchanged |
| `POST /api/hub/timeline/list` | `pagination_key`, `limit` 1–50 | `posts`, `following_count`, `next_pagination_key` | `invalid-pagination-key` |
| `POST /api/hub/posts/create` (changed) | `body`, `tags?`, `allow_replies?` | `201` `Post` | adds `hub-post-tag-unknown` 422 |
| `POST /api/hub/posts/edit` (changed) | `post_id`, `body`, `tags?`, `revision` | `Post` | adds `hub-post-tag-unknown` |
| `POST /api/hub/posts/set-replies` (replaces `set-policies`) | `post_id`, `allow_replies` | `Post` | `hub-post-not-found` |
| `POST /api/hub/posts/create-quote` (changed) | `target`, `body`, `tags?`, `allow_replies?` | `201` `Post` | adds `hub-post-quote-own-post` 422, `hub-post-tag-unknown` |
| `POST /api/hub/posts/detach-quote` | removed | | |
| `POST /api/hub/posts/edit-reply` (changed) | unchanged | unchanged | adds `hub-post-reply-refused` 403 (PST-RPL-016) |

`Post` loses `reply_policy`, `quote_policy`, `locked`; gains `allow_replies`,
`tags?`, `blocked_by_owner`. A reply item gains `blocked_by_author`.

Mesh: command `hub-follow-set`; events `hub-follow-ended`,
`hub-relationship-changed`, `hub-timeline-post-added`. The Timeline reads
posts through `/mesh/posts/get-many`.

## UI

| Portal | Route | Click path from Home | Shows and does | Who |
| --- | --- | --- | --- | --- |
| Hub | `/timeline` | Sidebar "Timeline" | Composer or upgrade prompt, "N following", own Replies link, feed with Load more, empty state | every user |
| Hub | `/following` | Sidebar "Timeline", then "N following" | Following list with Unfollow and Load more | the user only |
| Hub | `/u/:address` | The author link on a post, reply, quote, or blocks list row | Follower range; Follow, "Follow pending", or Unfollow; blocked lines; menu Block, Unblock, Mute, Unmute | other users |
| Hub | `/u/:address/posts/:postId` | Sidebar "Timeline", then a post's time | Tags, "Allow replies" switch for the author, replies-off and blocked lines, no Quote on own or blocked posts | every user |
| Hub | composer and quote dialog | Sidebar "Timeline" (composer); a post's Quote button (dialog) | Words, tag picker (3), "Allow replies" switch | composer Silver+; quote every user |
| Hub | `/u/:address/posts/:postId/quotes` | Sidebar "Timeline", then a post's quote count | Quote list, no Detach | every user |
| Hub | `/settings/blocks` | Sidebar "Blocks and mutes" | Unchanged | every user |

## Out of scope

- Follow notifications, follow requests, private accounts
- Following Orgs
- User search and follow suggestions (discovery)
- Tag pages, tag filters, free-form tags
- Replies in the Timeline, reposts without words
- Relationship and Timeline cleanup on account deletion
- A shared stream or firehose for large-account fan-out
- Demo video changes
