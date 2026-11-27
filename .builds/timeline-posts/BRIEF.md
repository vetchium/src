# Timeline posts build brief

Specification: [`agent-guides/posts.md`](../../agent-guides/posts.md). The
guide wins over this brief.

## Summary

Signed-in Hub users write timeline posts on their profile. They reply to
posts (post, reply, sub-reply). They quote timeline posts and published
Openings. A post author sets the reply and quote policy (`everyone`,
`nobody`), locks a post, hides replies, and detaches quotes. Hub users block
and mute other Hub users. The author's tenant is the authority for words. The
post owner's tenant keeps the reply structure and a copy of reply words. The
build touches hub-api, mesh-api, workers, hub-ui, and every tenant. It leaves
out follows, the home feed, the `following` policy, communities, votes,
reactions, media, direct messages, Org posts, public pages, Admin takedown,
notifications, and account deletion.

Source design: `docs/messaging-brainstorm.md`, build order steps 1 to 5.

## Questions and answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | Scope | Brainstorm steps 1–5: helpers, blocks and mutes, timeline posts, replies, quotes of timeline posts and Openings. Policies `everyone` and `nobody` only. |
| 2 | ID random part (D1) | Lowercase only, `[0-9a-z]`, 20 characters |
| 3 | Edits (D7) | 30-minute window. Keep old revisions. Quotes show the current revision. |
| 4 | Text limits | 512 code points for posts and replies. A code constant, changed later by release. |
| 5 | Blocks (D21) | Interaction block. A blocks B: B cannot reply to or quote A. B can still read A's posts. |
| 6 | Takedown (D12) | Defer to `docs/todo.md`. Keep `taken_down` in the schema. |
| 7 | Rate limits (D19) | Count in the database: 100 posts (quotes included) and 500 replies per user per rolling 24 hours |
| 8 | Region timeout (D18) | Show what arrives first. Page replies with Load more. Keep a reply copy on the post owner's tenant for speed. |
| 9 | Reply storage (D16, D17) | The replier's tenant is the authority. The post owner's tenant keeps a copy. A removal deletes the copy. |
| 10 | Author card in a thread | Text with handle first. Names and pictures load after, from author regions. |
| 11 | Block reach | B also cannot reply below A's replies on a third user's post. The check calls A's region and fails closed. |
| 12 | Post deletion and revisions | No deletion on request. Removal clears the words, deletes revisions, and changes the state. |
| 13 | Retention | Hard-delete every item more than 5 years after creation, in any state. |
| 14 | Plans | Silver+ writes top-level posts. Every tier replies, quotes, blocks, and mutes. |
| 15 | Hidden reply | Others see nothing (or a placeholder). The reply's author sees "Hidden by the post author". |
| 16 | Post removed (D27) | The Replies tab keeps the reply with "The post was removed". |
| 17 | Mute reach | Hides the muted user's replies and quotes, and their profile Posts and Replies tabs. |
| 18 | Downgrade below Silver | Existing posts stay live but frozen: no edit. Removal, policy, and lock stay allowed. |
| 19 | Quote list | Every viewer sees the count and a paged list. |
| 20 | Policy changes | Anytime. A change affects only new replies and quotes. |
| 21 | Block direction | One-way |
| 22 | Edit history visibility | Nobody reads old revisions in this build |
| 23 | Quote body | Required, 1 to 512 code points |
| 24 | Quote of an Opening (D23) | Reference only. No index in the Org's tenant. |

## API

All `POST`, authenticated Hub user.

| Operation | Who | Request | Success | Problems |
| --- | --- | --- | --- | --- |
| `/api/hub/posts/create` | Self, Silver+, cap | `body`, `reply_policy`, `quote_policy` | 201 `Post` | `validation-failed`, `hub-plan-required`, `hub-post-limit-reached` |
| `/api/hub/posts/create-quote` | Self, any tier, cap | `target`, `body`, policies | 201 `Post` | `hub-post-not-found`, `hub-post-quote-refused`, `hub-opening-not-found`, `hub-post-unavailable`, `hub-post-limit-reached` |
| `/api/hub/posts/edit` | Author, 30 min, Silver+ for `kind` `post` | `post_id`, `body`, `revision` | 200 `Post` | `hub-post-not-found`, `hub-post-edit-closed`, `hub-post-conflict`, `hub-plan-required` |
| `/api/hub/posts/remove` | Author | `post_id` | 204 | `hub-post-not-found` |
| `/api/hub/posts/set-policies` | Author | `post_id`, `reply_policy`, `quote_policy`, `locked` | 200 `Post` | `hub-post-not-found` |
| `/api/hub/posts/list` | Viewer | `owner`, `pagination_key`, `limit` | 200 posts, `muted` | `hub-profile-not-found`, `hub-post-unavailable` |
| `/api/hub/posts/get` | Viewer | `owner`, `post_id` | 200 `Post` with embed | `hub-post-not-found`, `hub-post-unavailable` |
| `/api/hub/posts/list-replies` | Viewer | `owner`, `post_id`, `parent_reply_id?`, `pagination_key`, `limit` | 200 replies, next key | `hub-post-not-found`, `hub-post-unavailable` |
| `/api/hub/profile/read-cards` | Viewer | `handles` (1–50) | 200 cards, `unavailable` | `validation-failed` |
| `/api/hub/posts/reply` | Any tier, cap, `Idempotency-Key` | `owner`, `post_id`, `parent_reply_id?`, `body` | 200 `Reply` or 202 pending | `hub-post-not-found`, `hub-post-replies-closed`, `hub-post-reply-refused`, `hub-reply-not-found`, `hub-post-limit-reached`, `hub-post-unavailable` |
| `/api/hub/posts/edit-reply` | Reply author, 30 min | `reply_id`, `body`, `revision` | 200 `Reply` | `hub-reply-not-found`, `hub-post-edit-closed`, `hub-post-conflict` |
| `/api/hub/posts/remove-reply` | Reply author | `reply_id` | 204 | `hub-reply-not-found` |
| `/api/hub/posts/hide-reply`, `/api/hub/posts/unhide-reply` | Post owner | `post_id`, `reply_id` | 204 | `hub-reply-not-found` |
| `/api/hub/posts/list-author-replies` | Viewer | `owner`, `pagination_key`, `limit` | 200 replies, `muted` | `hub-profile-not-found`, `hub-post-unavailable` |
| `/api/hub/posts/list-quotes` | Viewer | `owner`, `post_id`, `pagination_key`, `limit` | 200 quote posts, `partial` | `hub-post-not-found`, `hub-post-unavailable` |
| `/api/hub/posts/detach-quote` | Target owner | `post_id`, `quoter`, `quote_post_id` | 204 | `hub-post-not-found` |
| `/api/hub/blocks/block`, `/unblock` | Self | `user` | 204 | `hub-profile-not-found`, `validation-failed` |
| `/api/hub/blocks/list` | Self | `pagination_key`, `limit` | 200 | `validation-failed` |
| `/api/hub/blocks/state` | Self | `user` | 200 `blocked`, `muted` | `hub-profile-not-found` |
| `/api/hub/mutes/mute`, `/unmute` | Self | `user` | 204 | `hub-profile-not-found`, `validation-failed` |
| `/api/hub/mutes/list` | Self | `pagination_key`, `limit` | 200 | `validation-failed` |

Mesh (relay `/mesh/...` and peer `/api/mesh/...` for each):
`posts/list`, `posts/get-many`, `posts/list-replies`, `posts/get-reply`,
`posts/list-author-replies`, `posts/read-quote-target`, `posts/read-embeds`,
`posts/list-quotes`, `profile/read-cards`, `blocks/check`.

Federation kinds: command `hub-post-reply-register`; events
`hub-reply-edited`, `hub-reply-removed`, `hub-post-removed`,
`hub-post-quoted`, `hub-post-unquoted`.

## UI

| Portal | Route | Navigation | Shows and does | Who |
| --- | --- | --- | --- | --- |
| Hub | `/u/:address` | Existing profile | Tabs Profile, Posts, Replies. Composer for the Silver+ owner. Block and Mute menu for others. Mute notice. | Signed-in |
| Hub | `/u/:address/posts/:postId` | Post card | Post, embed, author controls, replies with Load more, sub-replies, composer, Hide and Unhide | Signed-in |
| Hub | `/u/:address/posts/:postId/replies/:replyId` | Reply link | Thread scrolled to the reply, highlighted | Signed-in |
| Hub | `/u/:address/posts/:postId/quotes` | Quote count | Quote posts, Load more, partial notice, Detach for the owner | Signed-in |
| Hub | `/settings/blocks` | Settings menu "Blocks and mutes" | Blocked and muted lists with Unblock and Unmute | Self |
| Hub | `/org/:domain/openings/:number` | Existing | Quote button | Signed-in |

## Out of scope

Record each in `docs/todo.md` in the final task.

- Follows, home feed, and the `following` reply and quote policy (D20)
- Communities, tags, votes, moderators, rank (D2–D6, D13)
- Reactions (D15), media in posts (D22), mentions, notifications
- Admin takedown, reports, and appeals (D12)
- Account deletion cleanup of posts and replies (D11, D28)
- Direct messages (D10), Org timeline posts (D9), public post pages (D8)
- Reading old revisions
