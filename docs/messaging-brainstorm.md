# Messaging design (brainstorm)

> **Writing rule for every editor (human or AI):** Write this file in a
> standard like ASD-STE100 (Simplified Technical English). Use short
> sentences: a maximum of 20 words for an instruction and 25 words for a
> description. Use one instruction in each sentence. Use the active voice.
> Use simple, approved words and one meaning for each word (section 0). Use
> tables and lists where possible. Do not write long, complex sentences.

Status: working file for discussion across sessions. It is not a rule yet.

- Record each settled decision in sections 1–9.
- Remove each settled decision from section 10.
- When the design is complete, move the rules to an agent guide (for example
  `agent-guides/posts.md`).
- Then delete this file.

## 0. Terms

| Term | Meaning in this file |
| --- | --- |
| Remove | Change the state of an item. The row stays. The words go (`body` is `NULL`). Other rows can still refer to it. |
| Delete | Take the row out of the table. |
| Filter out | Leave an item out of a page that a tenant returns. Nothing changes in the database. |
| Words | The text that a user writes: title and body. |
| Structure | The rows that put replies in order under a post. Structure has no words. |
| Routing hint | A tenant ID that a row keeps for a remote principal. It is not authoritative (`federation.md`). |
| Owner address | A handle for a Hub user. A primary domain for an Org (D9). |

## 1. Messaging patterns

| # | Pattern | Sender | Audience | State |
| --- | --- | --- | --- | --- |
| 1 | Opening to Hub users | Org | Applicants, candidates | Built (Openings) |
| 2 | Opening to provider Orgs | Org | Agencies, interviewers | Built (Assignments, Jobs) |
| 3 | Agency chat with a Hub user | Agency Org | One Hub user | Built (Conversations) |
| 4 | Timeline post | Hub user | Signed-in Hub users | New |
| 5 | Community post, 1 or more tags | Hub user | Signed-in Hub users | Future |
| 6 | Reply on a timeline post | Hub user | Signed-in Hub users | New |
| 7 | Comment on a community post | Hub user | Signed-in Hub users | Future |
| 8 | Quote of a timeline post | Hub user | Signed-in Hub users | New |
| 9 | Quote of a community post | Hub user | Signed-in Hub users | Future |
| 10 | Direct message | Hub user | One Hub user | Future |
| 11 | Org timeline post (company page) | Org | Signed-in Hub users | Possible |
| 12 | Chat between consumer and provider Orgs | Org | One Org | Possible |
| 13 | Quote of an Opening ("share this Opening") | Hub user | Signed-in Hub users | Possible |

Notes:

- "Signed-in Hub users" matches `PROF-GEN-002` in `hub-profile.md`. There is
  no anonymous access (D8).
- A quote is a timeline post. Replies on a quote follow pattern 6.
- A user cannot quote a reply or a comment (D26).
- Mentions and notifications are side effects. They are not a messaging
  pattern.

## 2. Three families

The patterns are in three families. Each family has a different audience,
authorization, and lifecycle. Use one design for each family. Do not make a
new design for each pattern.

| Family | Patterns | Audience | Design |
| --- | --- | --- | --- |
| A. Publications | 1, 2 | Business rules decide | Existing Opening and marketplace designs. No change. |
| B. Conversations | 3, 10, 12 | Fixed participants | Existing Conversation design (section 7). |
| C. Discussions | 4–9, 11, 13 | Signed-in Hub users | One discussion core with two placements: timeline and community (sections 4–6). |

A publication can be a quote target (pattern 13). That is the only link
between family A and family C.

## 3. Principles (proposed)

P1–P7 apply to family C only. Family B keeps the Conversation design and its
exception to P1 (section 7, D10). Family A keeps its existing designs.

- **P1** The author's home tenant stores the author's words. This includes
  posts, replies, comments, and quotes.
- **P2** The tenant that owns a post stores the structure of that post. The
  structure is the reply list, order, nesting, counts, policy, and hidden
  state.
- **P3** An ID encodes no location, because a principal can migrate. A
  backend reference is (owner principal type, owner DID, ID). A browser
  reference is (owner address, ID).
- **P4** A cross-region read fans out by region, never by item. A page makes
  at most one call to each region in each round.
- **P5** No tenant and no CDN keeps copies of another tenant's words.
- **P6** Each tenant applies its own user's preferences (blocks, mutes) when
  it reads.
- **P7** A partial page is acceptable. If a region is down, only that region's
  items are missing. The page shows a notice.

Result of P1: the author's handle, name, and picture come with the words. No
tenant records a copy of a remote author's display name.

## 4. IDs and URLs

### Post and reply IDs

- Format: a 20-character XID, then 20 secure random alphanumeric characters.
  The total is 40 characters.
- XID part: 12 bytes in base32hex (`[0-9a-v]`), in time order at 1-second
  precision. Use `github.com/rs/xid` (already an indirect dependency).
- Random part: `crypto/rand` with rejection sampling. This prevents modulo
  bias.
- Why the XID part: inserts go to the end of the B-tree. IDs sort near
  creation order.
- Why the random part: an XID alone is predictable (time, machine, counter).
  The random part makes the ID impossible to guess.
- The initiating tenant mints the ID before the first network call. The
  federation protocol requires a pre-minted resource ID for idempotent
  creation.
- Store the ID as `text COLLATE "C"` with a `CHECK` on the format.
- Do not use the XID time as `created_at`. It comes from the clock of the
  server that minted it.
- Use this format for posts, replies, comments, and quotes only. An Opening
  keeps its existing reference (Org domain, Opening number).

### Keyset order

Time-ordered lists use `(created_at, id)`. The ID is the tie-breaker.

| List | Direction | Column |
| --- | --- | --- |
| Profile posts, home feed | `DESC` (newest first) | `hub_posts.created_at` |
| Profile "Replies" tab | `DESC` | `hub_reply_texts.created_at` |
| Replies in a thread | `ASC` (oldest first) | `hub_post_replies.created_at` |
| Community "new" | `DESC` | `hub_posts.created_at` |
| Community "hot" or "top" | Rank key (D13) | Not `(created_at, id)` |

Never sort a thread on `hub_reply_texts.created_at`.

### URLs

- Hub user post: `/u/<handle>/posts/<post-id>`. This is the canonical URL for
  timeline and community posts. A community page links to it.
- Reply: `/u/<handle>/posts/<post-id>/replies/<reply-id>`. The handle is the
  post owner's handle. It routes to the tenant that has the structure.
- An alias in the URL redirects to the handle, as in `MKT-UI-008`.
- Org post (D9): `/org/<primary-domain>/posts/<post-id>`, the same as
  `/org/<domain>` in `openings.md`.

## 5. Discussion core

### Tables in the author's home tenant (words)

`hub_posts`:

| Column | Notes |
| --- | --- |
| `post_id` | Section 4 format |
| author principal type, author DID | |
| placement | `timeline`, `community` |
| kind | `post`, `quote` |
| title | Community only |
| body | `NULL` after removal |
| quote target | Kind `quote` only: target type, owner principal type, owner DID, owner address, owner tenant (routing hint), target ID |
| reply policy | `everyone`, `following` (D20), `nobody` |
| quote policy | `everyone`, `following` (D20), `nobody` |
| `locked_at` | Set: nobody can add a reply |
| reply count, quote count | Live structure rows only |
| state | `live`, `removed`, `taken_down` |
| revision | Starts at 1. Goes up by 1 on each edit. The UI shows "edited" when it is more than 1. |
| version | Goes up by 1 on each change. Outbox events carry it for watermarks. |
| `created_at`, `edited_at`, `removed_at` | |

`hub_post_tags`: `post_id`, `tag_oid`, position. Community posts only.

`hub_reply_texts` keeps the words of every reply that a local user writes, on
any post in any region:

| Column | Notes |
| --- | --- |
| `reply_id` | Section 4 format |
| author DID | Always a local Hub user |
| post owner principal type, post owner DID | |
| post owner address | For the reply URL on the "Replies" tab, with no remote call |
| post owner tenant | Routing hint |
| `post_id` | |
| operation ID | The command operation while state is `pending` |
| body | `NULL` after removal |
| state | `pending`, `live`, `removed`, `taken_down`, `post_removed` |
| revision, version | As in `hub_posts` |
| `created_at`, `edited_at`, `removed_at` | |

### Tables in the post owner's tenant (structure)

`hub_post_replies`:

| Column | Notes |
| --- | --- |
| `post_id`, `reply_id` | |
| `parent_reply_id` | `NULL` for a top-level reply |
| author principal type, author DID | |
| author tenant | Routing hint |
| state | `live`, `hidden_by_owner`, `removed_by_moderator`, `author_removed` |
| child count | Live child rows only. The UI shows it. |
| child row count | Child rows in all states. Step 7 of "Read a thread" uses it. |
| `created_at` | The time of registration. Threads sort on it. |

`hub_post_quotes`:

| Column | Notes |
| --- | --- |
| target `post_id` | A local post. Openings have no quote index (D23). |
| quoter principal type, quoter DID | |
| quoter tenant | Routing hint, so a list of quotes fans out by region (P4) |
| quote `post_id` | |
| `created_at` | Keyset order for the list of quotes |
| `detached_at` | Set: the embedded post is not available in this quote |

`hub_post_votes`: community only (D5).

Notes:

- The post owner is the post author. So `hub_posts` and its structure tables
  are in the same tenant. The counts in `hub_posts` change in the same
  transaction as the structure rows.
- `hub_post_replies` has no author handle and no author name. P1 gives them
  with the words.
- Timeline replies and community comments use the same tables. Only the
  policies are different.

### Differences between placements

| | Timeline | Community |
| --- | --- | --- |
| List | One author, one tenant | One tag, all regions |
| Who controls replies | The post author | Moderators (D4) |
| Reply policy | `everyone`, `following` (D20), `nobody` | `everyone` |
| Nesting | Post → reply → sub-reply. The parent of a sub-reply is a top-level reply. | Deeper (D6) |
| Order | Time | Rank (D13) |
| Title | No | Yes |
| Tags | No | 1 to 3 (D3) |
| Votes | No (reactions: D15) | Yes |

### Flow: create a post

The author's tenant does one local transaction. It inserts the post and its
tags, and writes the audit event.

### Flow: reply

The reply flow uses two new hooks in the command framework (section 6, D25).

1. The replier's hub-api mints the reply ID.
2. It calls `Sender.Send` with the kind `hub-post-reply-register`. The command
   payload has the post reference, the reply ID, and the parent reply ID. It
   has no words.
3. The `Prepare` hook runs in the transaction that creates the pending
   operation. It inserts the `hub_reply_texts` row as `pending` and writes the
   audit event. It does not run on a replay.
4. The post owner's tenant runs the handler in one transaction:
   1. Make sure that the post is `live` and `locked_at` is not set.
   2. Apply the reply policy.
   3. Make sure that the post owner has not blocked the replier. The handler
      knows only the post owner's blocks (D21).
   4. Make sure that the parent reply is in the same post and is `live`.
   5. Apply the nesting rule for the placement.
   6. Insert the structure row.
   7. Add 1 to the post's reply count. Add 1 to the parent's child count and
      child row count.
   8. Write the audit event.
5. The `Settle` hook runs in the transaction that stores the final outcome.
   This occurs in `Send` and in `Recover`.
   - On success, it changes the state from `pending` to `live` and clears
     the operation ID. It changes only a row in state `pending`.
   - On a rejection, it deletes the row if the state is `pending`.
6. On `StateUnavailable`, the sender abandons the operation. The `Settle`
   hook runs in the abandon transaction and deletes the pending row.
7. The federation protocol does not recover an operation after `expires_at`.
   A reaper deletes the pending rows of those operations. It writes an audit
   event in the same transaction.
8. A hook writes an audit event only when it changed a row.

Results:

- If the post owner is local, steps 3 to 5 are one transaction.
- A crash after step 3 leaves an operation that `Recover` drives. The tenant
  loses no pending row.
- The state guard in step 5 stops `Settle` from changing `post_removed`,
  `removed`, or `taken_down` back to `live`.
- Nobody sees pending words. A structure row can exist before its words are
  `live`. A thread read shows a placeholder for it.

### Flow: read a thread

1. The viewer's tenant gets the post and one page of structure from the
   post owner's tenant. If the post is `removed` or `taken_down`, the post
   owner's tenant returns `unavailable` and no structure.
2. It groups the replies by author tenant (routing hint).
3. It reads the words from each of those tenants in parallel. It skips rows
   that are not `live`.
4. Each read returns one result for each reply:
   - `found`: the words, the author's handle, active alias, display name,
     and picture URL.
   - `not-homed`: the author migrated.
   - `not-found`: the words are removed, or they are not `live` yet.
5. The viewer's tenant re-resolves the `not-homed` authors. It groups them by
   their new tenant. It reads again, one call for each tenant.
6. A `live` row without words shows as a placeholder in its position.
7. A row that is not `live` shows as a placeholder only if its child row
   count is more than 0. Otherwise the page does not show it. This keeps
   deep community subtrees in place. A placeholder can have only
   placeholders below it.

This is at most 2 sequential hops, plus 1 hop for migrated authors.

### Flow: quote of a post

1. The quoter's tenant reads the target from the target owner's tenant. If
   the region is down, the request fails with `503`. The target owner's
   tenant does these checks:
   - The target is `live`.
   - The quote policy allows the quoter.
   - The owner has not blocked the quoter.
2. The quoter's tenant does one local transaction:
   1. Insert the quote post with the target reference.
   2. Write the audit event.
   3. Enqueue `hub-post-quoted` to the target owner.
3. The target owner's tenant receives the event:
   - If the target post does not exist or is not `live`, it records
     nothing.
   - If the policy or a block now refuses the quote, it inserts the
     `hub_post_quotes` row with `detached_at` set.
   - Otherwise it inserts the row and adds 1 to the quote count.
4. To show a quote, the viewer's tenant reads the embedded post from the
   target owner's tenant. The request has the target reference, the quote
   post ID, and the quoter. The target owner's tenant returns the post as
   data, or `unavailable`. `unavailable` covers detached, removed, taken
   down, and blocked.
5. An embedded post shows at most 1 level. A quote inside an embedded post
   shows as a link only.

Watermark: `hub-post-quoted` and `hub-post-unquoted` use the quote post as
the aggregate. The aggregate ID is the quote post ID. The version is the
quote post's `hub_posts.version`. Join the two kinds with
`Registry.ShareWatermark` (`federation.md`). Then a late `hub-post-quoted`
cannot make a deleted quote row again.

### Flow: quote of an Opening (pattern 13)

1. The quoter's tenant reads the `PublicOpening` from the Org's tenant. The
   Opening must be `published`.
2. The quoter's tenant inserts the quote post and writes the audit event. It
   enqueues no event (D23).
3. To show the quote, the viewer's tenant reads the `PublicOpening`. If the
   Opening is not `published`, the embed is `unavailable`.
4. Removal of the quote sends no event.

### Flow: remove, hide, edit, detach

Count rule: an action reduces the reply count and the parent's child count
only when the structure row leaves state `live`. The child row count does
not change, because the row stays.

| Action | Who | What changes |
| --- | --- | --- |
| Remove a reply | Reply author | The author's tenant sets `removed` and clears the body. It enqueues `hub-reply-removed` to the post owner. The receiver sets the structure row to `author_removed`. It applies the count rule. |
| Hide a reply | Post owner | The post owner's tenant sets `hidden_by_owner`. It applies the count rule. The words stay in the replier's tenant. |
| Remove a comment | Moderator (D4) | The post owner's tenant sets `removed_by_moderator`. It applies the count rule. |
| Take down a reply | Admin of the author's region (D12) | The author's tenant sets `taken_down` and clears the body. It enqueues `hub-reply-removed`. |
| Remove a post | Post author | The author's tenant sets `removed` and clears the body. Then the post cleanup below runs. |
| Take down a post | Admin of the author's region (D12) | The author's tenant sets `taken_down` and clears the body. Then the post cleanup below runs. |
| Remove a quote | Quoter | As "Remove a post". Post cleanup sends `hub-post-unquoted`. |
| Edit a post or reply | Author | Local only. Add 1 to revision and version. Keep the old revision (D7). No cross-region message. |
| Detach a quote | Target post owner | The target owner's tenant sets `detached_at` and reduces the quote count. It changes only a row where `detached_at` is `NULL`. |
| Lock a post | Post author | Set `locked_at`. |

Post cleanup:

1. If the post is a quote of a post, the removal or takedown transaction
   enqueues `hub-post-unquoted` to the target owner.
2. A worker finds each distinct reply author of the post.
3. It enqueues `hub-post-removed` to each author, one item for each commit.
4. Each receiver changes that author's replies on the post to
   `post_removed` (D27). It changes only rows in state `pending` or `live`.
   It clears the operation ID.
5. Then the worker deletes the structure rows and the quote rows.

The `hub-post-unquoted` receiver:

1. It deletes the `hub_post_quotes` row.
2. It reduces the quote count only if `detached_at` is `NULL`. A detach
   already reduced it.

### Flow: lists

- **Profile posts.** One read from the author's tenant.
- **Profile "Replies" tab.** A local read from `hub_reply_texts`. Each row
  links to its post with the stored post owner address. It shows no post
  words.
- **Community list.** The viewer's tenant calls every region in parallel with
  `(tag, sort, now, cursor)`. The fan-out helper merges the results
  (section 6).
- **Home feed (later).** The viewer's tenant groups the followed users by
  tenant. It reads each tenant in parallel. The fan-out helper merges the
  results. The feed needs no copies of posts.

### Cross-region cost

| Screen | Sequential hops | Calls for each page |
| --- | --- | --- |
| My profile and my replies | 0 | 0 |
| Another user's profile | 1 | 1 |
| Thread | Up to 2, plus 1 for migrated authors | 1, plus 1 for each region that has replies on the page |
| Community tag page | 1 | 1 for each region |
| Home feed | 1 | 1 for each region that has followed users |
| Quote embeds | +1, plus 1 for migrated owners | 1 for each region that has targets |

Mitigation: parallel calls, a timeout for each region, partial pages (P7),
and the route cache.

## 6. Shared backend parts

Build these once. Every family C screen uses them.

### ID minting helper

See section 4.

### Region fan-out read helper

- It sends the reads to all regions in parallel.
- It has a timeout for each region (D18).
- It returns partial results (P7).
- Each read carries the viewer's DID and handle from the session. The serving
  tenant verifies that the calling tenant homes the viewer. This is the rule
  in `federation.md`, "Reads and privacy".
- A read by ID separates `not-homed` from `not-found`. The helper re-resolves
  the `not-homed` principals. It groups them by their new tenant and reads
  again, one call for each tenant.
- It merges sorted results with these steps:
  1. Merge all items that the regions returned, before any filter.
  2. Take the first `limit` items of the merged list.
  3. Set each region's cursor to its last item in those `limit` items. If the
     region has no item there, keep its cursor.
  4. Mark a region as done only when all these conditions are true:
     - The region answered.
     - The region said that it has no more items.
     - Step 2 took all the items that the region returned.
  5. Filter out blocked and muted items (P6).
- Never mark a region as done after a timeout or an error. Keep its cursor.
  The next page asks it again.
- A page can have fewer items than the limit after step 5. The list ends only
  when all regions are done. Never use the item count to find the end (D24).
- The cursor holds one position for each region.

### Reference type

A reference has a target type, an owner principal type, an owner DID, and a
target ID.

| Target type | Target ID |
| --- | --- |
| `timeline_post` | Post ID |
| `community_post` | Post ID |
| `opening` | Opening number (the owner is the Org) |

### Command framework hooks (D25)

The reply flow needs two hooks in `backend/internal/federation/commands`.
They are generic. Other features can use them.

| Hook | Registered | Runs in |
| --- | --- | --- |
| `Prepare` | On each `Request` | The transaction that creates the pending operation. Not on a replay. |
| `Settle` | On each command kind | The transaction that stores the final outcome (in `Send` and `Recover`), and the abandon transaction |

Register `Settle` on the kind. `Recover` in the workers has no `Request`.

### Federation kinds

Add command and event kinds in the existing federation framework. Add no
ledger, transport, or recovery code.

| Kind | Type | From | To |
| --- | --- | --- | --- |
| `hub-post-reply-register` | Command | Replier | Post owner |
| `hub-reply-removed` | Event | Reply author | Post owner |
| `hub-post-removed` | Event | Post owner | Each reply author |
| `hub-post-quoted` | Event | Quoter | Target owner |
| `hub-post-unquoted` | Event | Quoter | Target owner |

## 7. Conversations (family B)

- Built: chat between an agency and a Hub user. The agency's tenant is the
  authority. The Hub user's tenant keeps a pointer.
- Future: direct messages between Hub users, and chat between Orgs.
- Proposal: reuse the Conversation design. There are only two fixed parties.
  One code path is sufficient.
- Conflict with P1: the authority's tenant keeps the other party's words.
  Options:
  - (a) Accept this as an exception. The recipient is the only reader.
    Agency chat already does this.
  - (b) Each party's tenant keeps that party's words. A page merges results
    from 2 tenants at most.
- Messages use per-conversation numbers now. Decide if direct messages use
  numbers or the IDs from section 4 (D10).

## 8. CDN

- Do not put post words on a CDN (P5). The reasons:
  - Edge servers keep copies outside the author's region.
  - Each viewer gets a different response because of blocks, policy, hidden
    replies, and detached quotes.
  - A removal, a takedown, or an account deletion must take effect
    immediately. A purge is not immediate.
  - Post text is small. The round trip causes the latency, not the size.
- A CDN is acceptable for static portal files.
- Media follows `object-storage.md`. The owning region gives short-lived
  signed URLs from its private bucket. A CDN must not keep a media file after
  its signed URL expires.
- Public post pages (D8) conflict with P5 and with `PROF-GEN-002`. A public
  page needs a decision about which data it shows.

## 9. Build order

1. ID helper, region fan-out read helper, and command framework hooks.
2. Blocks and mutes between Hub users (D21). P6 needs them.
3. Timeline posts (local to the author).
4. Replies (structure, words, command, events). Policies `everyone` and
   `nobody` only.
5. Quotes of timeline posts. Policies `everyone` and `nobody` only.
6. Follow and home feed. Add the `following` reply and quote policy (D20).
7. Communities (tags, list from all regions, votes, moderation).
8. Quotes of community posts. These need no new work after step 7, because
   they use the same reference type.
9. Direct messages.

## 10. Open questions

Each open question has an ID. Use the ID when you discuss it. Add new
questions at the end of the table with the next ID.

| ID | Question | Current lean |
| --- | --- | --- |
| D1 | Random part: mixed case (about 119 bits) or lowercase only (about 103 bits, no case problems in URLs) | Lowercase only |
| D2 | Community tags: reuse the Opening tag OIDs or make a new catalog | Open |
| D3 | Maximum tags on a community post | 3 |
| D4 | Community moderators: who they are, and their scope (global or one region) | Open |
| D5 | Votes: kept by the post owner's tenant (the voter DID goes to another region), or by the voter's tenant with count updates | Post owner's tenant |
| D6 | Maximum nesting depth for community comments | Open |
| D7 | Edits: time window, revision history, effect on quotes | Short window, keep revisions |
| D8 | Audience: signed-in users only, or the public web. Public pages conflict with P5 (section 8). | Signed-in only first |
| D9 | Org authors on the timeline (pattern 11) | Later. References carry the principal type now. |
| D10 | Direct messages: option (a) or (b) in section 7. Numbers or IDs. | Open |
| D11 | Account deletion. The home tenant first deletes the user's words. Remote reads then return `not-found` and show placeholders. Then it sends cleanup events for remote structure rows. The event receiver checks the origin. `resolve-principal` must stay active-only. Proposal: a separate origin check that also accepts a `deleting` principal. The directory keeps a `deleting` entry for a fixed time (D28), then deletes it. After that time, the workers stop the events that they did not deliver. | Proposed |
| D12 | Takedown of words: by the Admins of the author's region. Hiding structure in a thread: by the post owner or by moderators. | Proposed |
| D13 | Community rank formula and cursor stability across regions. A fixed `now` does not stop drift from new votes. Accept repeats and skips, or use a snapshot of scores for each list session. | Open |
| D14 | Reply and comment counts on lists: from structure rows only, or with a per-region read | Structure rows only |
| D15 | Reactions on timeline posts: the same storage as votes (D5) | Open |
| D16 | Is P1 (words stay in the author's region) a product promise to users? If not, a thread can keep all replies in the post owner's tenant. That is simpler and has 1 hop fewer. | P1 is a promise |
| D17 | Thread ownership: keep the split in section 5 (structure with the post owner, words with the author), or keep everything with the post owner | Split |
| D18 | Timeout for each region in a fan-out read, and the notice text for a partial page | Open |
| D19 | Rate limits for posts, replies, comments, and quotes for each Hub user | Open |
| D20 | Restricted reply and quote policy: `following` (people the post author follows) or `followers` (people who follow the post author). The follower's tenant owns a follow edge (`hub-signup.md`). `following` is a local check in the post owner's tenant. `followers` needs a follower projection there, and a new follower cannot reply until the event arrives. | `following` |
| D21 | Blocks and mutes between Hub users: the scope, and which tenant applies each one. The reply handler knows only the post owner's blocks. A user that the parent reply author blocked can still reply below that reply. The blocker does not see it (P6). Is that enough? | Open |
| D22 | Media (images) in posts: the plan rules, and the storage from `object-storage.md` | Later |
| D23 | Quote of an Opening (pattern 13): does the Org's tenant keep a quote index (counts, list), or does the quote keep only the reference? | Reference only |
| D24 | Short pages after block and mute filters: accept them, or send the viewer's block list with each read. The block list then goes to other regions. | Accept short pages |
| D25 | Add the `Prepare` and `Settle` hooks to the command framework (section 6). Without them, the reply flow needs extra commits, an event to make words `live`, and a reaper for lost rows. | Add the hooks |
| D26 | Quotes of replies and comments. The words and the structure are in different tenants. Which tenant keeps the quote index and applies the policy? | Not allowed for now |
| D27 | When a post owner removes a post, what does the reply author see on the "Replies" tab? The words stay in the reply author's tenant (P1). | Show the reply with "The post was removed" |
| D28 | How long the directory keeps a `deleting` entry (D11) | Open |
