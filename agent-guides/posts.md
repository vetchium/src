# Posts

Applies to Hub timeline posts, replies, quotes, tags, follows, the Timeline
feed, and blocks and mutes between Hub users: contracts, tables, handlers,
mesh reads, commands, events, workers, and Hub portal screens.

## Terms

| Term | Meaning |
| --- | --- |
| Post | A top-level timeline post (`kind` `post`) or a quote post (`kind` `quote`) |
| Reply | Text below a post. A sub-reply is a reply below a top-level reply. |
| Words | The body text a Hub user writes |
| Structure | The rows that order replies under a post. The post owner's tenant keeps them. |
| Reply copy | The post owner's tenant's copy of a reply's words, kept for fast thread reads |
| Remove | Clear the words and change the state. The row stays. |
| Address | A handle or an active alias (`hub-profile.md`) |
| Relationship row | The row in user A's home tenant that holds whether another user B follows A and whether A blocks B |
| Relationship copy | The row in user A's home tenant that holds A's follow state toward B and whether B blocks A |
| Timeline | The feed of the signed-in user's own posts and the posts of users they follow |
| Timeline entry | A reference to one post in one reader's Timeline: author, post ID, post time. No words. |
| Follower range | The approximate follower count shown on a profile |

## General

- **PST-GEN-001** Only an authenticated Hub user reads or writes posts,
  replies, quotes, follows, blocks, and mutes. There is no anonymous read.
- **PST-GEN-002** Render words as plain text. Keep internal whitespace and line
  breaks. Trim surrounding whitespace. Refuse U+0000 as `validation-failed`.
- **PST-GEN-003** A post body and a reply body each hold 1 to 512 Unicode code
  points after trimming. Keep the limit in one Go constant and the TypeSpec
  `@maxLength`. A quote body follows the post rule.
- **PST-GEN-004** Audit every committed write in the same transaction as the
  change. The audit record never holds words.
- **PST-GEN-005** A post or reply is never hard-deleted on request. Removal
  clears the words and changes the state (PST-POS-007, PST-RPL-011).
- **PST-GEN-006** No notifications, mentions, media, reactions, follow
  requests, private accounts, Org follows, user search, follow suggestions,
  or tag pages in this build.

## IDs

- **PST-ID-001** A post ID and a reply ID have 40 characters: a 20-character
  XID (`github.com/rs/xid`, base32hex `[0-9a-v]`), then 20 characters from
  `[0-9a-z]` from `crypto/rand` with rejection sampling.
- **PST-ID-002** The initiating tenant mints the ID before any network call.
- **PST-ID-003** Store the ID as `text COLLATE "C"` with a `CHECK` on
  `^[0-9a-v]{20}[0-9a-z]{20}$`. Validate the same pattern in each request.
- **PST-ID-004** Never use the XID time as `created_at`.

## Ownership

| Data | Authority | Copy |
| --- | --- | --- |
| Post words, tags, Allow replies, counts, revisions | Post author's home tenant | None |
| Reply words, revisions, state | Reply author's home tenant | Reply copy in the post owner's tenant |
| Reply structure, hidden state | Post owner's home tenant | None |
| Quote index (`hub_post_quotes`) | Target post owner's tenant | None |
| B follows A, A blocks B (relationship row) | A's home tenant | Relationship copy in B's home tenant |
| Follower count | The followed user's home tenant | None |
| Timeline entries | The reader's home tenant | None |
| Mutes | Muter's home tenant | None |

- **PST-OWN-001** The reply author's tenant is the authority for reply words.
  The post owner's tenant keeps the reply copy. An edit or a removal reaches
  the copy by event.
- **PST-OWN-002** A removal of a reply clears the reply copy in the post
  owner's tenant.
- **PST-OWN-003** No tenant keeps a copy of a remote post's words, a remote
  display name, or a remote picture URL. A row may keep a remote permanent
  handle and a routing hint.
- **PST-OWN-004** A backend reference is (owner principal type, owner DID,
  target ID). A browser reference is (owner address, target ID). The browser
  never gets a DID (PROF-GEN-006).

## Posts

- **PST-POS-001** Only a Hub user on `hub-silver-tier` or higher creates a
  top-level post. Put `hub_plan_oid = ANY(...)` in the insert statement.
  Refuse with `hub-plan-required`.
- **PST-POS-002** Every tier creates a quote post (PST-QTE-001).
- **PST-POS-003** A Hub user creates at most 100 posts (top-level and quote,
  any state) in a rolling 24 hours. Lock the `hub_users` row, count, and
  insert in one transaction. Refuse with `hub-post-limit-reached` (`429`).
- **PST-POS-013** `create` and `create-quote` take an `Idempotency-Key`
  (`handlerauth.RunIdempotent`, 24-hour replay, bound to the author's DID).
  Read the new post in the same transaction, so a replay answers the same
  post. `create-quote` reads its target before the transaction. It skips that
  read when `handlerauth.Recorded` finds an answer for the key.
- **PST-POS-004** A post has `allow_replies`, a boolean. The default is
  `true`. There is no quote policy and no lock: every user that the owner did
  not block may quote a live post (PST-QTE-003).
- **PST-POS-005** The author changes `allow_replies` at any time with
  `set-replies`. A change affects only new replies. Existing replies stay, and
  their authors may still edit and remove them.
- **PST-POS-006** The author edits a live post for 30 minutes after
  `created_at`. An edit changes the words and the tags together. The request
  carries the current `revision`. A stale revision returns
  `hub-post-conflict`. A closed window returns `hub-post-edit-closed`. An edit
  keeps the old body and tags in `hub_post_revisions`, adds 1 to `revision`
  and `version`, and sets `edited_at`. No one reads old revisions in this
  build.
- **PST-POS-007** The author removes a post. Removal sets state `removed`,
  sets the body to `NULL`, sets `removed_at`, deletes its revisions, and adds
  1 to `version` in one transaction. Then post cleanup runs (PST-RPL-013).
- **PST-POS-008** After a downgrade below Silver, a top-level post is frozen.
  An edit needs Silver (`hub-plan-required`). Removal and `set-replies` stay
  allowed. A quote post is never frozen.
- **PST-POS-009** A post read returns `post_id`, owner card fields from the
  owner's tenant (handle, active alias, display name, picture URL), `kind`,
  body, `tags` (omitted when none), `allow_replies`, reply count, quote count,
  `edited` (`revision > 1`), `created_at`, the quote target, and
  `blocked_by_owner` (PST-REL-008).
- **PST-POS-010** A removed or taken-down post returns `hub-post-not-found`.
- **PST-POS-011** Profile posts list newest first by `(created_at, post_id)`,
  default limit 20, maximum 50. Only live posts.
- **PST-POS-012** The state `taken_down` exists in the schema. No operation
  sets it in this build.

## Tags

- **PST-TAG-001** A post or quote has 0 to 3 tags from the Opening tag
  catalog (OPN-TAG-001). The mesh and the API carry OIDs only (OPN-TAG-012).
- **PST-TAG-002** Contract validation refuses a malformed OID, more than 3,
  or a repeat, with `validation-failed` naming `tags` or `tags.<index>`.
- **PST-TAG-003** The write statement refuses an OID missing from the catalog
  with `hub-post-tag-unknown` (`422`), listing each unknown OID once, and
  writes nothing. A deprecated tag is accepted. The picker does not offer it
  unless the post already has it.
- **PST-TAG-004** Store tags in `hub_posts.tag_oids text[]`, `NULL` when
  none, checked for count, nulls, repeats, and format. The trigger
  `vetchium.check_opening_tag_oids` refuses an OID missing from
  `vetchium.opening_tags`.
- **PST-TAG-005** The portal shows each tag by OPN-TAG-004 and OPN-TAG-005.
  A tag is not a link.

## Replies

- **PST-RPL-001** Every tier replies. A Hub user writes at most 500 replies
  (any state) in a rolling 24 hours. The replier's tenant counts them in the
  `Prepare` hook transaction (PST-RPL-005). Refuse with
  `hub-post-limit-reached`.
- **PST-RPL-002** Nesting is post, top-level reply, sub-reply. A sub-reply's
  parent is a top-level reply. A reply to a sub-reply is refused as
  `validation-failed`.
- **PST-RPL-003** The post owner's tenant refuses a reply when the post is not
  live (`hub-post-not-found`), `allow_replies` is false and the replier is not
  the post owner (`hub-post-replies-closed`, `409`), the post owner blocked
  the replier (`hub-post-reply-refused`, `403`), or the parent reply is not in
  the post or not live (`hub-reply-not-found`). The rule applies to top-level
  replies and sub-replies.
- **PST-RPL-004** Before a sub-reply, the replier's hub-api reads the parent
  reply's author from the post owner's tenant. If that author is not the post
  owner, it asks the parent author's tenant (`/mesh/blocks/check`). A block
  returns `hub-post-reply-refused`. An unavailable region returns
  `hub-post-unavailable` (`503`). The check fails closed. The replier's
  tenant stores the parent author's DID in
  `hub_reply_texts.parent_author_hub_user_did`.
- **PST-RPL-005** The reply is the command `hub-post-reply-register` with the
  replier as initiator and the post owner as authority. The payload has the
  post reference, the reply ID, the parent reply ID, the replier's handle,
  and the words.
- **PST-RPL-006** The `Prepare` hook inserts the `hub_reply_texts` row as
  `pending` with the operation ID and writes the audit event.
- **PST-RPL-007** The handler inserts the `hub_post_replies` row with the reply
  copy, adds 1 to the post's reply count, adds 1 to the parent's child count
  and child row count, and writes the audit event, in one transaction.
- **PST-RPL-008** The `Settle` hook changes a `pending` row to `live` and
  clears the operation ID on success. It deletes a `pending` row on a
  rejection or an abandon. It changes no row in another state.
- **PST-RPL-009** The `reap-hub-pending-replies` job deletes `pending` rows
  whose operation is past `expires_at`. In the same transaction it writes an
  audit event and enqueues `hub-reply-removed` to the post owner. The command
  can reach the owner's tenant before it expires, so a reply copy can exist
  there.
- **PST-RPL-010** The reply author edits a live reply for 30 minutes, as in
  PST-POS-006, with `hub_reply_revisions`. The edit enqueues
  `hub-reply-edited` to the post owner. The receiver updates the reply copy.
- **PST-RPL-016** The reply author's tenant refuses an edit with
  `hub-post-reply-refused` when its relationship copy says the post owner or
  the parent reply's author blocked the author (PST-REL-006). Removal stays
  allowed.
- **PST-RPL-011** The reply author removes a `live` or `post_removed` reply.
  The author's tenant sets `removed`, clears the body, and deletes its
  revisions. It enqueues `hub-reply-removed` only for a `live` reply, because
  post cleanup deleted the structure of a removed post. The receiver sets the
  structure row to `author_removed` and clears the reply copy.
- **PST-RPL-012** The post owner hides and unhides a reply (`hidden_by_owner`,
  `live`). The words stay in the reply author's tenant.
- **PST-RPL-013** Post cleanup: the `clean-removed-hub-posts` job runs one
  step in each commit and audits it. Steps, in order: enqueue
  `hub-post-removed` to at most 100 distinct reply authors and record the
  last one; delete at most 1,000 structure rows that have no child row; delete
  at most 1,000 quote rows; mark the post done (`cleanup_done_at`). The
  receiver sets that author's `pending` and `live` replies on the post to
  `post_removed` and clears the operation ID.
- **PST-RPL-014** Count rule: the reply count and the parent's child count go
  down only when a structure row leaves `live`, and up when it returns. The
  child row count never goes down.
- **PST-RPL-015** `hub-reply-edited` and `hub-reply-removed` use aggregate
  type `hub_reply`, the reply ID, and the reply's `version`. They share a
  watermark (`Registry.ShareWatermark`). Their origin is the reply author,
  named in the payload field `author_hub_user_did`.
  `hub-post-removed` uses aggregate type `hub_post`, the post ID, and the
  post's `version`. Its origin is the post owner, named in the payload field
  `owner_hub_user_did`.

## Threads

- **PST-THR-001** A thread read is one call to the post owner's tenant. It
  returns structure rows with the reply copy and the author's permanent
  handle.
- **PST-THR-002** Top-level replies list oldest first by
  `hub_post_replies.(created_at, reply_id)`, default limit 20, maximum 50.
  Sub-replies of one reply list the same way, one page at a time. The portal
  shows "Load more" while a next key exists.
- **PST-THR-003** A `live` row shows its words. A `hidden_by_owner` row shows
  its words only to its author, with the label "Hidden by the post author",
  and to the post owner, with the label "Hidden" and Unhide. Others see it
  as PST-THR-004 says.
- **PST-THR-004** Any other row shows as a placeholder only when its child row
  count is more than 0. Otherwise the page leaves it out.
- **PST-THR-005** The viewer's tenant filters out replies by users the viewer
  muted (PST-REL-012). A page can be short. The list ends only when the next
  key is absent.
- **PST-THR-006** The portal shows reply words with the handle at once. Then it
  calls `/api/hub/profile/read-cards` for display names and pictures. A card
  that does not arrive leaves the handle only.
- **PST-THR-007** `read-cards` takes 1 to 50 handles. hub-api groups them by
  home tenant and reads each tenant in parallel with a 2-second deadline. It
  lists the handles it could not read as `unavailable`.
- **PST-THR-008** A removed post returns `hub-post-not-found` for the thread.
- **PST-THR-009** A reply link calls `locate-reply`. It returns the reply ID
  and its parent ID, no words. Then the portal lists the top level from the
  parent, or from the reply when it is top-level, with `from_reply_id`. It
  lists the parent's sub-replies from the reply. `from_reply_id` and
  `pagination_key` are exclusive (`validation-failed`). A reply that is not in
  that list returns `hub-reply-not-found`.
- **PST-THR-010** Each reply item carries `blocked_by_author`: the viewer's
  hub-api sets it from the viewer's relationship copies (PST-REL-008).

## Replies tab

- **PST-TAB-001** A profile's Replies tab reads `hub_reply_texts` in the
  author's tenant: states `live` and `post_removed`, newest first by
  `(created_at, reply_id)`, default limit 20, maximum 50.
- **PST-TAB-002** A `live` item links to
  `/u/<post owner address>/posts/<post-id>/replies/<reply-id>`. A
  `post_removed` item shows "The post was removed" and no link.
- **PST-TAB-003** The tab never reads post words. A `post_removed` item has
  no `body`.
- **PST-TAB-004** Each item names the post owner. The author sees Remove on
  each item (PST-RPL-011).

## Quotes

- **PST-QTE-001** Every tier creates a quote. A quote counts as a post for
  PST-POS-003. A quote has a body (PST-GEN-003), tags (PST-TAG-001), and
  `allow_replies` (PST-POS-004). A quote is a link to its target; the target
  owner never approves or removes it.
- **PST-QTE-002** A quote target is another user's live timeline post or
  quote post, or a published Opening. A quote of a reply is not allowed. A
  target owned by the quoter returns `hub-post-quote-own-post` (`422`); the
  quoter's hub-api compares the resolved owner DID with its own before any
  mesh call.
- **PST-QTE-003** For a timeline post target, the quoter's tenant reads the
  target from the owner's tenant (`/mesh/posts/read-quote-target`). The owner
  refuses when the target is not live (`hub-post-not-found`) or the owner
  blocked the quoter (`hub-post-quote-refused`, `403`). An unavailable region
  returns `hub-post-unavailable`.
- **PST-QTE-004** The quoter's tenant inserts the quote post, writes the
  audit event, and enqueues `hub-post-quoted` in one transaction.
- **PST-QTE-005** The `hub-post-quoted` receiver records nothing for a target
  that is missing or not live, or whose owner now blocks the quoter.
  Otherwise it inserts the `hub_post_quotes` row and adds 1 to the quote
  count.
- **PST-QTE-006** Removal of a quote post enqueues `hub-post-unquoted`. The
  receiver deletes the row and reduces the quote count when a row was
  deleted.
- **PST-QTE-007** `hub-post-quoted` and `hub-post-unquoted` use aggregate type
  `hub_post`, the quote post ID, and the quote post's `version`. They share a
  watermark. Their origin is the quoter, so each payload carries
  `quoter_hub_user_did`.
- **PST-QTE-013** A receiver that changes a post's quote count locks the post
  row (`LockHubPostForQuote`) before it reads or writes the quote row. Every
  writer takes the post lock first, so two writers never deadlock.
- **PST-QTE-009** An embed reads the target from the owner's tenant
  (`/mesh/posts/read-embeds`), batched by region. A removed or missing target
  returns `unavailable`. The portal shows "This post is not available".
- **PST-QTE-010** An embed shows one level. A quote inside an embed shows as a
  link only. An embed of a muted user's post still shows.
- **PST-QTE-011** For an Opening target, the quoter's tenant reads the
  `PublicOpening`. It must be `published`. The quote enqueues no event. An
  embed of an Opening that is not `published` is `unavailable`.
- **PST-QTE-012** The quote list of a post reads `hub_post_quotes` in the
  target owner's tenant, newest first, default limit 20, maximum 50. Then the
  viewer's tenant reads the quote posts from each quoter's tenant in parallel
  through the fan-out helper (PST-RD-001). The response marks a page
  `partial` when a region did not answer.

## Relationships, blocks, and mutes

- **PST-REL-001** For each pair of users (A, B), A's home tenant keeps at most
  one relationship row `hub_relationships` (local A, remote B): `is_follower`
  (B follows A), `is_blocked` (A blocks B), `follower_seq`, and `version`. It
  also keeps at most one relationship copy `hub_relationship_copies` (local A,
  remote B): `follow_state` (`none`, `pending`, `following`, `rejected`),
  `follow_seq`, and `blocked_by_remote`. Each row keeps the remote permanent
  handle and a routing hint. The key is (local DID, remote DID).
- **PST-REL-002** Every change to a relationship row locks that row first, so
  a follow and a block for the same pair serialize in A's tenant.
- **PST-REL-003** A block is one-way. When A blocks B, B cannot follow A,
  reply to A's posts, reply below A's replies, edit existing replies on A's
  posts or below A's replies, or quote A's posts. B still reads A's posts and
  replies. A may still reply to and quote B.
- **PST-REL-004** A block does not hide B's content from A and does not remove
  existing replies or quotes.
- **PST-REL-005** A block, in one transaction in A's tenant: sets
  `is_blocked`; ends B's follow of A (`is_follower` false, follower count
  down by 1 when it was true); adds 1 to `version`; enqueues
  `hub-relationship-changed` to B; ends A's follow of B as an unfollow does
  (PST-FOL-008); audits.
- **PST-REL-006** The `hub-relationship-changed` receiver in B's tenant
  upserts the copy (local B, remote A). On a block it sets
  `blocked_by_remote`, sets `follow_state` `rejected` when it is `pending` or
  `following`, and deletes A's Timeline entries in B's Timeline. On an
  unblock it clears `blocked_by_remote` and sets `rejected` to `none`. The
  event uses aggregate type `hub_relationship`, the aggregate ID A's DID, and
  the row's `version`. Its origin is A, named in the payload field
  `owner_hub_user_did`.
- **PST-REL-007** An unblock clears `is_blocked`, adds 1 to `version`,
  enqueues `hub-relationship-changed`, and audits. It restores no follow.
- **PST-REL-008** Screens read block state from the viewer's own tenant: its
  relationship rows (the viewer blocked the other user) and its copies (the
  other user blocked the viewer). The authority still decides every write.
  `blocked_by_owner` on a post and `blocked_by_author` on a reply come from
  the viewer's copies.
- **PST-REL-009** `/api/hub/relationships/state` returns, for one other user,
  `follow` (`none`, `pending`, `following`; `rejected` reads as `none`),
  `blocked`, `muted`, and `blocked_by_them`, from the caller's tenant only.
- **PST-REL-010** A Hub user blocks or mutes another Hub user by address. A
  Hub user cannot block, mute, or follow themselves (`validation-failed`). A
  repeat block or mute is a no-op `204`. Unblock and unmute first find the
  row by its stored handle. Only an alias or an unknown handle goes to the
  directory.
- **PST-REL-011** Block and mute lists show newest first, default limit 20,
  maximum 50, with the other user's handle. Cards come from `read-cards`.
- **PST-REL-012** A mute is one-way and stays in the muter's tenant. When A
  mutes B, A's tenant filters out B's replies and quote posts from every
  thread and quote list A reads. B's profile Posts and Replies tabs show
  "You muted this user" to A and no items. A mute also ends A's follow of B
  (PST-FOL-008) in the same transaction.
- **PST-REL-013** Neither user is told about a mute. A blocked user is told
  on the screens of PST-UI-012.

## Follows

- **PST-FOL-001** Every tier follows and is followed. A Hub user follows
  another Hub user by address with `/api/hub/follows/follow`, which takes an
  `Idempotency-Key`. A repeat follow of a user already followed or pending is
  a no-op `204`.
- **PST-FOL-002** A follow is the command `hub-follow-set` with the follower
  as initiator and the followed user as authority. The payload has the
  follower's DID, handle, and tenant, the followed user's DID, and
  `follow_seq`.
- **PST-FOL-003** The follower's hub-api reads the copy's `follow_seq` and
  sends `follow_seq + 1`. The `Prepare` hook locks the copy and returns
  `hub-follow-conflict` (`409`) when `follow_seq` changed. The handler retries
  the whole request up to 3 times before it answers that problem.
- **PST-FOL-004** The `Prepare` hook, in order: refuses when the follower
  blocks the followed user (`hub-follow-blocked-by-you`, `409`); refuses at
  5,000 copies in `pending` or `following`, or at 200 rows in
  `hub_follow_log` in the rolling 24 hours (`hub-follow-limit-reached`,
  `429`); deletes a mute of the followed user; sets the copy to `pending`
  with the new `follow_seq`; inserts a `hub_follow_log` row; audits. Only
  follows count toward the 200.
- **PST-FOL-005** The authority handler locks the relationship row. A
  `follow_seq` at or below `follower_seq` answers success without a change.
  A row with `is_blocked` rejects with `hub-follow-refused` (`403`).
  Otherwise it sets `is_follower`, `followed_at`, and `follower_seq`, adds 1
  to the follower count when `is_follower` was false, audits, and answers the
  followed user's latest 20 live posts and quote posts as (post ID,
  `created_at`).
- **PST-FOL-006** The `Settle` hook changes the copy only when it is still
  `pending` with the payload's `follow_seq`: success sets `following` and
  inserts the answered posts as Timeline entries; `hub-follow-refused` sets
  `rejected` and `blocked_by_remote`; any other failure or an abandon sets
  `none`.
- **PST-FOL-007** An unfollow is local and cannot be refused. In one
  transaction the follower's tenant sets the copy to `none` and adds 1 to
  `follow_seq`, deletes that user's Timeline entries in the follower's
  Timeline, enqueues `hub-follow-ended` to the followed user, and audits. A
  copy already `none` or `rejected` is a no-op `204`.
- **PST-FOL-008** Block (PST-REL-005) and mute (PST-REL-012) end the actor's
  own follow by PST-FOL-007 in their own transaction.
- **PST-FOL-009** The `hub-follow-ended` receiver locks the relationship row.
  When the payload `follow_seq` is above `follower_seq`, it clears
  `is_follower`, sets `follower_seq`, and reduces the follower count when
  `is_follower` was true. The event uses aggregate type `hub_follow`, the
  aggregate ID the follower's DID, and the version `follow_seq`. Its origin
  is the follower, named in the payload field `follower_hub_user_did`.
- **PST-FOL-010** The followed user's tenant keeps `hub_users.follower_count`
  in the same transactions as `is_follower`.
- **PST-FOL-011** No one reads a followers list. `profile/read` returns
  `follower_range` from the profile's home tenant: `none` (0), `1-9`,
  `10-99`, `100-999`, `1000-9999`, `10000-99999`, `100000+`. It never returns
  the number.
- **PST-FOL-012** `/api/hub/follows/list` returns only the caller's copies in
  `pending` or `following`, newest first by `(followed_at, remote DID)`,
  default limit 20, maximum 50, with the handle, the state, and
  `followed_at`, and `following_count`. No other user reads them.
- **PST-FOL-013** `hub_follow_log` rows older than 24 hours are deleted by
  the `trim-hub-timelines` job (PST-TL-008).

## Timeline

- **PST-TL-001** The Timeline lists the reader's own live posts and quotes
  and those of the users the reader follows, newest first by
  `(post_created_at, post_id)`, default limit 20, maximum 50. No replies.
- **PST-TL-002** `create` and `create-quote` insert the author's own Timeline
  entry in the post's transaction.
- **PST-TL-003** A new live post or quote sets `fanout_done_at` `NULL`. The
  `fan-out-hub-posts` job, every minute, pages the author's relationship rows
  with `is_follower` by remote DID after `fanout_cursor`. Each commit
  enqueues `hub-timeline-post-added` to at most 1,000 followers, records the
  cursor, and audits. A page under 1,000 sets `fanout_done_at`. A post that is
  no longer live sets `fanout_done_at` without enqueuing.
- **PST-TL-004** `hub-timeline-post-added` carries the author's DID, handle,
  and tenant, the post ID, and `post_created_at`. It uses aggregate type
  `hub_post`, the post ID, and the post's `version`. Its origin is the
  author, named in the payload field `author_hub_user_did`.
- **PST-TL-005** The receiver inserts the entry only when the reader's copy
  for the author is `following`. A repeat is a no-op. Then it deletes the
  reader's entries beyond the newest 1,000.
- **PST-TL-006** `/api/hub/timeline/list` reads the reader's entries, then
  reads the posts from each author's tenant in parallel through the fan-out
  helper (PST-RD-001) with `/mesh/posts/get-many`. A post that is removed or
  in a region that does not answer is left out with no notice. A page can be
  short; the list ends only when the next key is absent. The response has
  `following_count`.
- **PST-TL-007** Unfollow, block, and the block receiver delete the other
  user's entries from the reader's Timeline (PST-FOL-007, PST-REL-006).
- **PST-TL-008** The daily `trim-hub-timelines` job deletes entries with
  `post_created_at` more than 90 days old and `hub_follow_log` rows more than
  24 hours old, at most 1,000 rows of one table in each commit, and audits
  each commit.
- **PST-TL-009** Fan-out sends one event per follower. A shared stream for
  large accounts is deferred (`docs/todo.md`).

## Reads

- **PST-RD-001** `backend/internal/fanout` sends reads to regions in parallel
  with a 2-second deadline for each region. It returns partial results. It
  re-resolves `not-homed` principals once and reads again, one call for each
  tenant.
- **PST-RD-002** A batch read reads each table once for all its items, never
  once per item. One item that cannot be read leaves only that item
  unavailable.
- **PST-RD-003** Every mesh read carries the viewer's DID and handle. The
  serving tenant verifies that the calling tenant homes the viewer
  (`federation.md`, "Reads and privacy").
- **PST-RD-004** A single-target remote read that fails returns
  `hub-post-unavailable`. Never fall back to a local copy.

## Retention

- **PST-RET-001** The daily `purge-hub-posts` job works on rows whose
  `created_at` is more than 5 years old, by the database clock. In order: it
  deletes post revisions; it retires live posts as a removal does
  (PST-POS-007) and enqueues `hub-post-unquoted` for each timeline quote; it
  deletes posts whose cleanup is done (PST-RPL-013); it deletes reply
  revisions and reply texts. Each commit changes at most 1,000 rows of one
  table and writes one audit event.

## Hub portal

| Route | Click path from Home | Shows and does |
| --- | --- | --- |
| `/timeline` | Sidebar "Timeline" | A level-1 heading, the composer on Silver+ or the upgrade prompt below Silver, a "N following" link, a link to the own Replies tab, the feed with Load more, and an empty state |
| `/following` | Sidebar "Timeline", then "N following" | A level-1 heading, a breadcrumb to Timeline, and the users the caller follows with Unfollow and Load more |
| `/u/:address` | Own: Home "View as others see it". Another user: the author link on a post, reply, quote, or blocks list row | The follower range. For another user: Follow or Unfollow and a menu with Block, Unblock, Mute, Unmute. Tabs Profile, Posts, Replies, kept in `?tab=`. The owner on Silver+ gets a composer on Posts. |
| `/u/:address/posts/:postId` | Sidebar "Timeline", then a post's time | A level-1 heading, a breadcrumb to the owner's Posts tab, the post with its tags and embed, the author's edit, remove, and Allow replies controls, replies with Load more, sub-replies, the reply composer, and Hide and Unhide for the owner |
| `/u/:address/posts/:postId/replies/:replyId` | Sidebar "Timeline", then "See your replies", then a reply | The thread from the reply (PST-THR-009), scrolled to it, with the reply highlighted and a "Show all replies" link |
| `/u/:address/posts/:postId/quotes` | Sidebar "Timeline", then a post's quote count | Quote posts with Load more and a partial-page notice |
| `/settings/blocks` | Sidebar "Blocks and mutes" | Blocked and muted users with Unblock and Unmute |
| `/org/:domain/openings/:number` | Home ideal-job match or sidebar "Openings", then an Opening | A Quote button that opens the quote composer |

- **PST-UI-001** An alias in a post URL redirects to the handle URL.
- **PST-UI-002** Show "edited" when `edited` is true.
- **PST-UI-003** A partial page shows "Some items are not available now. Try
  again later." The Timeline never shows it (PST-TL-006).
- **PST-UI-004** A Hub user below Silver sees an upgrade prompt in place of the
  composer on their own Posts tab and on Timeline.
- **PST-UI-005** Edit controls show only inside the 30-minute window. A
  frozen top-level post (PST-POS-008) shows no Edit. The edit form changes
  the words and the tags.
- **PST-UI-006** The composer and the quote dialog have the words, a tag
  picker with at most 3 catalog tags, and an "Allow replies" switch that is
  on. They have no policy selects.
- **PST-UI-007** A reply that stays `202` after the polls shows that the post
  author's region has not answered. The composer keeps the words and the key,
  so Reply again replays.
- **PST-UI-008** The sidebar entry "Timeline" opens `/timeline`. The sidebar
  selects it on `/following` and on the signed-in user's own profile and
  post pages, and selects nothing on another user's pages.
- **PST-UI-009** On the post page the author sees an "Allow replies" switch
  that saves at once and says what happened. With replies off, everyone but
  the author sees "The author turned off replies" in place of the reply
  composers; existing replies stay.
- **PST-UI-010** The Quote button shows only on another user's post when
  `blocked_by_owner` is false. A quote count of 0 is plain text; a higher
  count links to the quotes page.
- **PST-UI-011** The profile of another user shows Follow when `follow` is
  `none`, "Follow pending" with Unfollow when `pending`, and Unfollow when
  `following`. A `202` follow shows "Follow pending". Follow on a muted user
  opens a dialog that says Follow also unmutes.
- **PST-UI-012** When `blocked_by_them` is true, the profile shows "You can't
  follow, reply to, or quote this user" in place of Follow. The post page
  shows the same text in place of the reply composer, and the thread shows
  it in place of a sub-reply composer and Edit below a reply whose author
  blocked the viewer.
- **PST-UI-013** When `blocked` is true, Follow is disabled with "You blocked
  this user. Unblock to follow." beside it and an Unblock button.
- **PST-UI-014** The Block dialog says the block ends follows both ways. The
  Mute action asks first when the caller follows the user and says the mute
  ends the follow.
- **PST-UI-015** The profile shows the follower range under the name, as
  "No followers", "1–9 followers", and so on. Only the own profile and
  Timeline show the following count.
- **PST-UI-016** The Timeline empty state says "Follow people to see their
  posts here" and, on Silver+, points to the composer.
