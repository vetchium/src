# Messaging design (brainstorm)

> **Writing rule for every editor (human or AI):** Write this file in a
> standard like ASD-STE100 (Simplified Technical English). Use short
> sentences: a maximum of 20 words for an instruction and 25 words for a
> description. Use one instruction in each sentence. Use the active voice.
> Use simple, approved words and one meaning for each word. Use tables and
> lists where possible. Do not write long, complex sentences.

Status: working file for discussion across sessions. It is not a rule yet.
Record each settled decision in sections 1–9, then remove it from section 10.
When the design is complete, move the rules to an agent guide (for example
`agent-guides/posts.md`) and delete this file.

## 1. Messaging patterns

| # | Pattern | Sender | Audience | State |
| --- | --- | --- | --- | --- |
| 1 | Opening to Hub users | Org | Applicants, candidates | Built (Openings) |
| 2 | Opening to provider Orgs | Org | Agencies, interviewers | Built (Assignments, Jobs) |
| 3 | Agency chat with a Hub user | Agency Org | One Hub user | Built (Conversations) |
| 4 | Timeline post | Hub user | Anyone | New |
| 5 | Community post, 1 or more tags | Hub user | Anyone | Future |
| 6 | Reply on a timeline post | Hub user | Anyone | New |
| 7 | Comment on a community post | Hub user | Anyone | Future |
| 8 | Quote of a timeline post | Hub user | Anyone | New |
| 9 | Quote of a community post | Hub user | Anyone | Future |
| 10 | Direct message | Hub user | One Hub user | Future |
| 11 | Org timeline post (company page) | Org | Anyone | Possible |
| 12 | Chat between consumer and provider Orgs | Org | One Org | Possible |
| 13 | Quote of an Opening ("share this Opening") | Hub user | Anyone | Possible |

Notes:

- A quote is a timeline post. Replies on a quote follow pattern 6.
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
| C. Discussions | 4–9, 11, 13 | Open | One discussion core with two placements: timeline and community (sections 4–6). |

A publication can be a quote target (pattern 13). That is the only link
between family A and family C.

## 3. Principles (proposed)

- **P1** The author's home tenant stores the author's words. This includes
  posts, replies, comments, and quotes.
- **P2** The tenant that owns a post stores the reply structure of that post.
  The structure is the reply list, order, nesting, counts, policy, and
  hidden state. It contains no words.
- **P3** An ID encodes no location, because a principal can migrate. A
  reference is (owner principal, ID). A browser reference is (handle, ID).
- **P4** A cross-region read fans out by region, never by item. A page makes
  at most one call to each region.
- **P5** No tenant and no CDN stores copies of another tenant's words.
- **P6** Each tenant applies its own user's preferences (blocks, mutes) when
  it reads.
- **P7** A partial page is acceptable. If a region is down, only that region's
  items are missing. The page shows a notice.

Result of P1: the author's name and picture come with the words. No tenant
records a copy of a remote author's display name.

## 4. IDs

- Format: a 20-character XID, then 20 secure random alphanumeric characters.
  The total is 40 characters.
- XID part: 12 bytes in base32hex (`[0-9a-v]`), in time order at 1-second
  precision. Use `github.com/rs/xid` (already an indirect dependency).
- Random part: `crypto/rand` with rejection sampling, so there is no modulo
  bias.
- Why the XID part: inserts go to the end of the B-tree, and IDs sort near
  creation order.
- Why the random part: an XID alone is predictable (time, machine, counter).
  The random part makes the ID impossible to guess.
- The initiating tenant mints the ID before the first network call. The
  federation protocol requires a pre-minted resource ID for idempotent
  creation.
- Store the ID as `text COLLATE "C"` with a `CHECK` on the format.
- Do not use the XID time as `created_at`. It comes from the clock of the
  server that minted it.
- Keyset order: `(created_at, id)`. The ID is the tie-breaker.
- Use the ID for posts, replies, comments, and quotes.
- URLs:
  - Post: `/u/<owner-handle>/posts/<post-id>`. This is the canonical URL for
    timeline and community posts. A community page links to it.
  - Reply: `/u/<owner-handle>/posts/<post-id>/replies/<reply-id>`. The owner
    handle routes to the tenant that has the reply structure.

## 5. Discussion core

### Tables in the author's home tenant (words)

| Table | Contents |
| --- | --- |
| `hub_posts` | `post_id`, author DID, placement (`timeline`, `community`), kind (`post`, `quote`), title (community only), body, quote target reference, reply policy, state, revision, `edited_at`, `created_at`, `removed_at`, version |
| `hub_post_tags` | `post_id`, `tag_oid`, position. Community posts only. |
| `hub_reply_texts` | `reply_id`, author DID, post owner DID, `post_id`, body, state (`pending`, `live`, `removed`), revision, times. The words of every reply a local user writes, on any post in any region. |

### Tables in the post owner's tenant (structure)

| Table | Contents |
| --- | --- |
| `hub_post_replies` | `post_id`, `reply_id`, `parent_reply_id`, author DID, author handle, author tenant (a routing hint only), state (`live`, `hidden_by_owner`, `removed_by_moderator`, `author_removed`), child count, `created_at` |
| `hub_post_quotes` | target reference, quoter DID, quote `post_id`, `detached_at` |
| `hub_post_votes` | Community only. Open decision D5. |

Timeline replies and community comments use the same tables. Only the
policies are different.

### Differences between placements

| | Timeline | Community |
| --- | --- | --- |
| List | One author, one tenant | One tag, all regions |
| Who controls replies | The post author | Moderators (D4) |
| Reply policy | `everyone`, `followers`, `nobody` | `everyone` |
| Nesting | 2 levels | Deeper (D6) |
| Order | Time | Votes and time (D13) |
| Title | No | Yes |
| Tags | No | 1 to 3 (D3) |
| Votes | No (reactions: D15) | Yes |

### Flows

- **Create a post.** One local transaction.
- **Reply.**
  1. The replier's tenant stores the words as `pending`.
  2. It sends the durable command `hub-post-reply-register` to the post
     owner's tenant.
  3. The post owner's tenant checks policy, blocks, and lock state in one
     transaction. It adds the structure row.
  4. In the same transaction, it enqueues the event `hub-reply-registered` to
     the replier.
  5. The replier's tenant receives the event and changes the words to `live`.
  6. If the command is rejected, the replier's tenant deletes the pending
     words.

  Nobody sees pending words.
- **Read a thread.**
  1. The viewer's tenant gets the post and one page of structure from the
     post owner's tenant.
  2. It groups the replies by author tenant.
  3. It reads the words from each of those tenants in parallel.

  This is at most 2 sequential hops.
- **Quote.** The quoter's tenant stores a local post with the target
  reference. In the same transaction, it enqueues `hub-post-quoted` to the
  target owner. The target's tenant renders the embedded copy and applies
  the quote policy and detach state.
- **Community list.** The viewer's tenant calls every region in parallel with
  `(tag, sort, now, cursor)`. It merges the results. The cursor holds one
  position for each region.
- **Home feed (later).** The viewer's tenant groups the followed users by
  tenant. It reads each tenant in parallel and merges the results. The feed
  needs no copies of posts.
- **Profile "Replies" tab.** Local, from `hub_reply_texts`.

### Cross-region cost

| Screen | Sequential hops | Calls for each page |
| --- | --- | --- |
| My profile and my replies | 0 | 0 |
| Another user's profile | 1 | 1 |
| Thread | Up to 2 | 1, plus 1 for each region that has replies on the page |
| Community tag page | 1 | 1 for each region |
| Home feed | 1 | 1 for each region that has followed users |
| Quote embeds | +1 | 1 for each region that has targets |

Mitigation: parallel calls, a timeout for each region, partial pages (P7),
and the route cache.

## 6. Shared backend parts

Build these once. Every family C screen uses them.

- ID minting helper (section 4).
- Region fan-out read helper. It does parallel mesh reads, has a timeout for
  each region, returns partial results, merges sorted results, and encodes a
  cursor that holds one position for each region.
- Reference type: target type (`timeline_post`, `community_post`, `reply`,
  `opening`), owner principal, ID.
- Command and event kinds in the existing federation framework. Add no
  ledger, transport, or recovery code.

## 7. Conversations (family B)

- Built: chat between an agency and a Hub user. The agency's tenant is the
  authority. The Hub user's tenant keeps a pointer.
- Future: direct messages between Hub users, and chat between Orgs.
- Proposal: reuse the Conversation design. There are only two fixed parties,
  so one code path is sufficient.
- Conflict with P1: the other party's words are stored in the authority's
  tenant. Options:
  - (a) Accept this as an exception. The recipient is the only reader.
    Agency chat already does this.
  - (b) Each party's tenant stores that party's words. A page merges results
    from 2 tenants at most.
- Messages use per-conversation numbers now. Decide if direct messages use
  numbers or the IDs from section 4 (D10).

## 8. CDN

- Do not put post words on a CDN (P5). The reasons:
  - Edge copies are stored outside the author's region.
  - Each viewer gets a different response because of blocks, policy, hidden
    replies, and detached quotes.
  - A delete, a takedown, or an account erasure must take effect immediately.
    A purge is not immediate.
  - Post text is small. The round trip causes the latency, not the size.
- A CDN is acceptable for:
  - static portal files;
  - media files that do not change, served from their region;
  - public post pages, if posts become public (D8), with a short TTL and a
    purge on delete.

## 9. Build order

1. ID helper and region fan-out read helper.
2. Timeline posts (local to the author).
3. Replies (structure, words, command, event).
4. Quotes of timeline posts.
5. Follow and home feed.
6. Communities (tags, list from all regions, votes, moderation).
7. Quotes of community posts. These need no new work after step 6, because
   they use the same reference type.
8. Direct messages.

## 10. Open questions

Each open question has an ID. Use the ID when you discuss it. Add new
questions at the end of the table with the next ID.

| ID | Question | Current lean |
| --- | --- | --- |
| D1 | Random part: mixed case (about 119 bits) or lowercase only (about 103 bits, no case problems in URLs) | Lowercase only |
| D2 | Community tags: reuse the Opening tag OIDs or make a new catalog | Open |
| D3 | Maximum tags on a community post | 3 |
| D4 | Community moderators: who they are, and their scope (global or one region) | Open |
| D5 | Votes: stored by the post owner's tenant (the voter DID goes to another region), or by the voter's tenant with count updates | Post owner's tenant |
| D6 | Maximum nesting depth for community comments | Open |
| D7 | Edits: time window, revision history, effect on quotes | Short window, keep revisions |
| D8 | Audience: signed-in users only, or the public web | Signed-in only first |
| D9 | Org authors on the timeline (pattern 11) | Later. References carry the principal type now. |
| D10 | Direct messages: option (a) or (b) in section 7. Numbers or IDs. | Open |
| D11 | Account deletion: delete the words locally. Send events that change remote structure rows to tombstones. Send them before the directory entry is removed. | Proposed |
| D12 | Takedown of a post's words: by the Admins of the author's region. Hiding structure in a thread: by the post owner or by moderators. | Proposed |
| D13 | Community "hot" formula and cursor stability across regions | Open |
| D14 | Reply and comment counts on lists: from structure rows only, or with a per-region read | Structure rows only |
| D15 | Reactions on timeline posts: the same storage as votes (D5) | Open |
| D16 | Is P1 (words stay in the author's region) a product promise to users? If not, a thread can store all replies in the post owner's tenant. That is simpler and has 1 hop fewer. | P1 is a promise |
| D17 | Thread ownership: keep the split in section 5 (structure with the post owner, words with the author), or store everything with the post owner | Split |
| D18 | Timeout for each region in a fan-out read, and the notice text for a partial page | Open |
| D19 | Rate limits for posts, replies, comments, and quotes for each Hub user | Open |
| D20 | Follow (pattern for the home feed and the `followers` reply policy): the follower's tenant owns it. Does the followee's tenant need a follower projection? | Yes, for the reply policy |
| D21 | Blocks and mutes between Hub users: the scope, and which tenant applies each one | Open |
| D22 | Media (images) in posts: the plan rules, and the storage from `object-storage.md` | Later |
