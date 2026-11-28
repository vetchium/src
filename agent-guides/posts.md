# Posts

Applies to Hub timeline posts, replies, quotes, and blocks and mutes between
Hub users: contracts, tables, handlers, mesh reads, events, workers, and Hub
portal screens.

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

## General

- **PST-GEN-001** Only an authenticated Hub user reads or writes posts,
  replies, quotes, blocks, and mutes. There is no anonymous read.
- **PST-GEN-002** Render words as plain text. Keep internal whitespace and line
  breaks. Trim surrounding whitespace. Refuse U+0000 as `validation-failed`.
- **PST-GEN-003** A post body and a reply body each hold 1 to 512 Unicode code
  points after trimming. Keep the limit in one Go constant and the TypeSpec
  `@maxLength`. A quote body follows the post rule.
- **PST-GEN-004** Audit every committed write in the same transaction as the
  change. The audit record never holds words.
- **PST-GEN-005** A post or reply is never hard-deleted on request. Removal
  clears the words and changes the state (PST-POS-007, PST-RPL-011).
- **PST-GEN-006** No notifications, mentions, media, reactions, follows, or
  feed in this build.

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
| Post words, policies, lock, counts, revisions | Post author's home tenant | None |
| Reply words, revisions, state | Reply author's home tenant | Reply copy in the post owner's tenant |
| Reply structure, hidden state | Post owner's home tenant | None |
| Quote index (`hub_post_quotes`) | Target post owner's tenant | None |
| Blocks and mutes | Blocker's or muter's home tenant | None |

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
- **PST-POS-004** A post has `reply_policy` and `quote_policy`, each
  `everyone` or `nobody`. The default is `everyone`.
- **PST-POS-005** The author changes either policy and the lock at any time.
  A change affects only new replies and quotes.
- **PST-POS-006** The author edits a live post for 30 minutes after
  `created_at`. The request carries the current `revision`. A stale revision
  returns `hub-post-conflict`. A closed window returns
  `hub-post-edit-closed`. An edit keeps the old body in
  `hub_post_revisions`, adds 1 to `revision` and `version`, and sets
  `edited_at`. No one reads old revisions in this build.
- **PST-POS-007** The author removes a post. Removal sets state `removed`,
  sets the body to `NULL`, sets `removed_at`, deletes its revisions, and adds
  1 to `version` in one transaction. Then post cleanup runs (PST-RPL-013).
- **PST-POS-008** After a downgrade below Silver, a top-level post is frozen.
  An edit needs Silver (`hub-plan-required`). Removal, policy changes, and
  lock stay allowed. A quote post is never frozen.
- **PST-POS-009** A post read returns `post_id`, owner card fields from the
  owner's tenant (handle, active alias, display name, picture URL), `kind`,
  body, policies, `locked`, reply count, quote count, `edited`
  (`revision > 1`), `created_at`, and the quote target.
- **PST-POS-010** A removed or taken-down post returns `hub-post-not-found`.
- **PST-POS-011** Profile posts list newest first by `(created_at, post_id)`,
  default limit 20, maximum 50. Only live posts.
- **PST-POS-012** The state `taken_down` exists in the schema. No operation
  sets it in this build.

## Replies

- **PST-RPL-001** Every tier replies. A Hub user writes at most 500 replies
  (any state) in a rolling 24 hours. The replier's tenant counts them in the
  `Prepare` hook transaction (PST-RPL-005). Refuse with
  `hub-post-limit-reached`.
- **PST-RPL-002** Nesting is post, top-level reply, sub-reply. A sub-reply's
  parent is a top-level reply. A reply to a sub-reply is refused as
  `validation-failed`.
- **PST-RPL-003** The post owner's tenant refuses a reply when the post is not
  live (`hub-post-not-found`), the post is locked or `reply_policy` is
  `nobody` (`hub-post-replies-closed`, `409`), the post owner blocked the
  replier (`hub-post-reply-refused`, `403`), or the parent reply is not in the
  post or not live (`hub-reply-not-found`).
- **PST-RPL-004** Before a sub-reply, the replier's hub-api reads the parent
  reply's author from the post owner's tenant. If that author is not the post
  owner, it asks the parent author's tenant (`/mesh/blocks/check`). A block
  returns `hub-post-reply-refused`. An unavailable region returns
  `hub-post-unavailable` (`503`). The check fails closed.
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
  muted (PST-BLK-005). A page can be short. The list ends only when the next
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
  PST-POS-003. A quote has a body (PST-GEN-003) and policies.
- **PST-QTE-002** A quote target is a live timeline post or a published
  Opening. A quote of a quote is allowed. A quote of a reply is not.
- **PST-QTE-003** For a timeline post target, the quoter's tenant reads the
  target from the owner's tenant (`/mesh/posts/read-quote-target`). The owner
  refuses when the target is not live (`hub-post-not-found`), `quote_policy`
  is `nobody`, or the owner blocked the quoter (`hub-post-quote-refused`,
  `403`). An unavailable region returns `hub-post-unavailable`.
- **PST-QTE-004** The quoter's tenant inserts the quote post, writes the
  audit event, and enqueues `hub-post-quoted` in one transaction.
- **PST-QTE-005** The `hub-post-quoted` receiver records nothing for a target
  that is missing or not live. It inserts the `hub_post_quotes` row with
  `detached_at` set when the policy or a block now refuses. Otherwise it
  inserts the row and adds 1 to the quote count.
- **PST-QTE-006** Removal of a quote post enqueues `hub-post-unquoted`. The
  receiver deletes the row and reduces the quote count only when
  `detached_at` is `NULL`.
- **PST-QTE-007** `hub-post-quoted` and `hub-post-unquoted` use aggregate type
  `hub_post`, the quote post ID, and the quote post's `version`. They share a
  watermark. Their origin is the quoter, so each payload carries
  `quoter_hub_user_did`.
- **PST-QTE-008** The target post owner detaches a quote. The owner's tenant
  sets `detached_at` and reduces the quote count, only where `detached_at` is
  `NULL`. A directory that does not answer returns `hub-post-unavailable`.
- **PST-QTE-013** A receiver that changes a post's quote count locks the post
  row (`LockHubPostForQuote`) before it reads or writes the quote row. Every
  writer takes the post lock first, so two writers never deadlock.
- **PST-QTE-009** An embed reads the target from the owner's tenant
  (`/mesh/posts/read-embeds`), batched by region. A detached, removed, or
  missing target returns `unavailable`. The portal shows "This post is not
  available".
- **PST-QTE-010** An embed shows one level. A quote inside an embed shows as a
  link only.
- **PST-QTE-011** For an Opening target, the quoter's tenant reads the
  `PublicOpening`. It must be `published`. The quote enqueues no event. An
  embed of an Opening that is not `published` is `unavailable`.
- **PST-QTE-012** The quote list of a post reads `hub_post_quotes` (not
  detached) in the target owner's tenant, newest first, default limit 20,
  maximum 50. Then the viewer's tenant reads the quote posts from each
  quoter's tenant in parallel through the fan-out helper (PST-RD-001). The
  response marks a page `partial` when a region did not answer.

## Blocks and mutes

- **PST-BLK-001** A block and a mute are one-way. The blocker's or muter's
  home tenant stores them with the other user's DID, permanent handle, and
  routing hint.
- **PST-BLK-002** When A blocks B, B cannot reply to A's posts, reply below
  A's replies, or quote A's posts. B still reads A's posts and replies.
- **PST-BLK-003** A block does not hide B's content from A. A block does not
  remove existing replies or quotes.
- **PST-BLK-004** Neither user is told about a block or a mute.
- **PST-BLK-005** When A mutes B, A's tenant filters out B's replies and quote
  posts from every thread and quote list A reads. B's profile Posts and
  Replies tabs show "You muted this user" to A and no items.
- **PST-BLK-006** A Hub user blocks or mutes another Hub user by address. A
  Hub user cannot block or mute themselves (`validation-failed`). A repeat
  block or mute is a no-op `204`. Unblock and unmute first find the row by its
  stored handle. Only an alias or an unknown handle goes to the directory.
- **PST-BLK-007** Block and mute lists show newest first, default limit 20,
  maximum 50, with the other user's handle. Cards come from
  `read-cards`.
- **PST-BLK-008** `/api/hub/blocks/state` returns whether the caller blocked
  and muted one user. The profile menu uses it.

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

| Route | Shows and does |
| --- | --- |
| `/u/:address` | Tabs: Profile, Posts, Replies. The owner on Silver+ gets a composer on Posts. A menu has Block, Unblock, Mute, Unmute for another user. |
| `/u/:address/posts/:postId` | A level-1 heading, the post, its embed, the author's policy, lock, edit, and remove controls, replies with Load more, sub-replies, the reply composer, and Hide and Unhide for the owner |
| `/u/:address/posts/:postId/replies/:replyId` | The thread from the reply (PST-THR-009), scrolled to it, with the reply highlighted and a "Show all replies" link |
| `/u/:address/posts/:postId/quotes` | Quote posts with Load more, a partial-page notice, and Detach for the target owner |
| `/settings/blocks` | Blocked and muted users with Unblock and Unmute. Settings menu entry "Blocks and mutes". |
| `/org/:domain/openings/:number` | A Quote button that opens the quote composer |

- **PST-UI-001** An alias in a post URL redirects to the handle URL.
- **PST-UI-002** Show "edited" when `edited` is true.
- **PST-UI-003** A partial page shows "Some items are not available now. Try
  again later."
- **PST-UI-004** A Hub user below Silver sees an upgrade prompt in place of the
  composer on their own Posts tab.
- **PST-UI-005** Edit controls show only inside the 30-minute window. A
  frozen top-level post (PST-POS-008) shows no Edit.
- **PST-UI-006** The policy form shows "Unsaved changes", Save, and Discard
  changes only after a change. It guards navigation while a change is
  unsaved.
- **PST-UI-007** A reply that stays `202` after the polls shows that the post
  author's region has not answered. The composer keeps the words and the key,
  so Reply again replays.
