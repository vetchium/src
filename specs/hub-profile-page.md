## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: `specs/typespec/hub/profile.tsp`, `specs/typespec/hub/connections.tsp`, `specs/typespec/hub/work-emails.tsp`

### Overview

This spec describes the unified Hub profile page at `/u/:handle`. Any authenticated Hub user can navigate to `/u/:handle` to view another user's public profile. When the viewer's own handle matches the URL handle, the page renders in **owner mode** and exposes an "Edit Profile" shortcut. When viewing someone else, the page renders in **visitor mode** and surfaces all connection-related actions. The route already exists in `hub-ui` (`PublicProfilePage.tsx`) but the current implementation is bare: it lacks a clear visual hierarchy, places the connection widget awkwardly, and has no path for the owner to see and edit their own profile from the canonical URL. This spec redesigns the page for clarity, completeness, and forward-compatibility as new features (posts, mutual connections, messaging) are added later.

Portals affected: **Hub**. User types: Hub users (both viewers and profile owners).

---

### Acceptance Criteria

**Display**

- [ ] Visiting `/u/:handle` for any valid handle renders the profile of that user
- [ ] The page shows: profile picture, preferred display name, `@handle`, short bio (headline), location (city + country), and long bio (About section)
- [ ] The Verified Work History section lists all active/verified employer stints for the user
- [ ] If the profile has no picture, a default avatar placeholder is shown
- [ ] If the long bio is empty, the About section is hidden for visitors; for owners it shows a prompt to add one
- [ ] If no verified employer stints exist, the Work History section shows an appropriate empty state
- [ ] A 404-style "profile not found" state is shown for unknown handles
- [ ] Loading states prevent layout shift during data fetching

**Owner mode** (viewer's own handle matches URL handle)

- [ ] An "Edit Profile" button is visible in the profile hero; it navigates to `/settings/profile`
- [ ] No connection actions or status indicators are shown for own profile
- [ ] If the long bio is absent, a subtle prompt ("Add an About section") is shown inline where the About card would appear — clicking it also navigates to `/settings/profile`

**Visitor mode** (viewing a different user's profile)

- [ ] The connection action panel is rendered in the profile hero area, reflecting the current `ConnectionState`
- [ ] All ten `ConnectionState` values are handled gracefully (see Connection Action States below)
- [ ] After any connection action (send, accept, reject, withdraw, disconnect, block, unblock) the displayed state updates without a full page reload
- [ ] The panel is structured so additional actions (e.g. Report User) can be added in future without rearchitecting the layout

**Scalability**

- [ ] Profile content sections (About, Work History) are each independent, self-contained card components
- [ ] The ordering of sections is controlled by a single ordered array (not scattered inline JSX), so future sections can be inserted at any position without structural changes to the page
- [ ] The profile hero's action area is a dedicated `<ProfileActionsPanel>` component that receives `connectionState` as a prop; it does not couple to the page's data-fetching logic
- [ ] The page does not render any placeholder sections for features that do not exist yet (no "Posts", no "Followers", no dummy counts)

---

### User-Facing Screens

#### Screen: Profile Hero (owner mode)

Portal: hub-ui | Route: `/u/:handle` (viewer = profile owner)

```html
┌──────────────────────────────────────────────────────────────────┐ │ [Avatar
96px] Jane Doe [Edit Profile] │ │ @jane-doe │ │ Senior Engineer at ACME Corp │ │
Berlin, Germany │
└──────────────────────────────────────────────────────────────────┘
```

- "Edit Profile" button (ghost/secondary style) in the top-right of the hero card
- No connection status, no block/report options
- The button navigates to `/settings/profile`

#### Screen: Profile Hero (visitor mode — not connected)

Portal: hub-ui | Route: `/u/:handle` (viewer ≠ profile owner)

```
┌──────────────────────────────────────────────────────────────────┐
│  [Avatar 96px]   Jane Doe                   [Connect]  [⋮ More]  │
│                  @jane-doe                                        │
│                  Senior Engineer at ACME Corp                     │
│                  Berlin, Germany                                   │
└──────────────────────────────────────────────────────────────────┘
```

- Primary action button reflects current state (see Connection Action States)
- "More" (⋮) dropdown hosts lower-frequency actions (Block User, Report User in future)
- Connection state badge/label appears between avatar block and buttons when relevant
  (e.g. "You are connected", "Request pending", "Request received")

#### Screen: About Section

Shown below the hero, inside its own card.

<Card title="About">
	<p>Full long-bio text, preserving newlines.</p>
</Card>

- Hidden entirely for visitor if `long_bio` is empty
- For owner: shows "Add an About section →" prompt that links to `/settings/profile`

#### Screen: Verified Work History Section

Shown below the About card (or directly below the hero if About is hidden).

<Card title="Verified Work History">
	<List>
		<ListItem>
			<strong>acme-corp.com</strong>
			<Tag color="green">Current</Tag>
			<span>2021 – present</span>
			<Tooltip>Verified via work email</Tooltip>
		</ListItem>
		<ListItem>
			<strong>startup.io</strong>
			<span>2018 – 2021</span>
			<Tooltip>Verified via work email</Tooltip>
		</ListItem>
	</List>
</Card>

- Each entry shows: employer domain, year range, "Current" tag if `is_current === true`
- A verification badge/icon on each row signals that the stint was verified via a work email (this is Vetchium's core differentiator — make it visually prominent)
- Empty state: "No verified employers yet" (same for owner and visitor)
- Entries are sorted: current first, then by end_year descending

---

### Connection Action States

The visitor-mode hero must handle every `ConnectionState` value from the spec. The mapping below describes what UI elements appear.

| `ConnectionState`          | Primary action button                        | Secondary / label                                  |
| -------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `not_connected`            | **Connect** (primary)                        | "More" menu with Block                             |
| `ineligible`               | _(none)_                                     | Subtle label: "Connection not available"           |
| `request_sent`             | **Withdraw Request** (ghost)                 | Label: "Connection request pending"                |
| `request_received`         | **Accept** (primary) + **Decline** (default) | Label: "Sent you a connection request"             |
| `connected`                | _(none / "Connected" badge)_                 | "More" menu with Disconnect + Block                |
| `i_rejected_their_request` | **Connect** (primary)                        | "More" menu with Block                             |
| `they_rejected_my_request` | _(none)_                                     | "More" menu with Block                             |
| `i_disconnected`           | **Connect** (primary)                        | "More" menu with Block                             |
| `they_disconnected`        | _(none)_                                     | "More" menu with Block                             |
| `i_blocked_them`           | **Unblock** (ghost)                          | _(no "More" menu)_                                 |
| `blocked_by_them`          | _(none)_                                     | Subtle label: "You cannot interact with this user" |

Design notes:

- Destructive actions (Disconnect, Block) are placed in the "More" (⋮) dropdown with a Popconfirm on the menu item itself — they must never be a single-click from the hero
- `blocked_by_them` must not reveal to the viewer _why_ they can't connect; the label is intentionally vague
- When `i_blocked_them` is unblocked, the state re-fetches and updates in place (as the existing `ConnectWidget` already does)

---

### Layout Summary

```
┌───────────────────────────────────────────────────────┐
│  Profile Hero Card (full width)                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ [Avatar]  Name / @handle / Short bio / Location  │ │
│  │           [Action area — owner OR visitor panel] │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  About Card (conditional)                             │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│  Verified Work History Card                           │
└───────────────────────────────────────────────────────┘
```

- No sidebar. All sections are full-width, stacked vertically.
- `maxWidth: 800` for the content column (consistent with `MyProfilePage`)
- No "Back to Dashboard" button — `/u/:handle` is a canonical destination users navigate to directly via links; the browser's native Back suffices. (Exception: if the page is entered from a search or connections list, the browser back stack handles it.)
- Section order is driven by an array in the page component so future sections slot in without restructuring the JSX

---

### What this spec explicitly excludes (to be specified separately if needed)

- Posts / activity feed — not yet implemented; no placeholder
- Follower / following counts — not yet implemented; no placeholder
- Mutual connections count — not yet implemented; no placeholder
- Messaging — not yet implemented; no placeholder
- Report User — excluded from this spec; the "More" menu can include it in a future spec without layout changes
- Editing profile inline — the "Edit Profile" button navigates to the existing `/settings/profile` page; in-place editing is out of scope for this spec
- Unauthenticated / public access — all Hub routes require authentication; this profile page is no exception

---

### API Surface

All endpoints already exist. No new endpoints are required for this feature.

| Endpoint                                 | Portal | Who calls it       | What it does                                                |
| ---------------------------------------- | ------ | ------------------ | ----------------------------------------------------------- |
| `GET /hub/myinfo`                        | hub    | Hub user (viewer)  | Returns viewer's handle so the page can detect owner mode   |
| `POST /hub/get-profile`                  | hub    | Hub user (viewer)  | Returns `HubProfilePublicView` for the target handle        |
| `GET /hub/profile-picture/{handle}`      | hub    | Hub user (viewer)  | Fetches profile picture bytes                               |
| `POST /hub/list-public-employer-stints`  | hub    | Hub user (viewer)  | Returns `PublicEmployerStint[]` for the target handle       |
| `POST /hub/connections/get-status`       | hub    | Hub user (visitor) | Returns current `ConnectionState` between viewer and target |
| `POST /hub/connections/send-request`     | hub    | Hub user (visitor) | Sends connection request                                    |
| `POST /hub/connections/withdraw-request` | hub    | Hub user (visitor) | Withdraws a pending sent request                            |
| `POST /hub/connections/accept-request`   | hub    | Hub user (visitor) | Accepts an incoming request                                 |
| `POST /hub/connections/reject-request`   | hub    | Hub user (visitor) | Rejects an incoming request                                 |
| `POST /hub/connections/disconnect`       | hub    | Hub user (visitor) | Disconnects from a connected user                           |
| `POST /hub/connections/block`            | hub    | Hub user (visitor) | Blocks a user                                               |
| `POST /hub/connections/unblock`          | hub    | Hub user (visitor) | Unblocks a previously blocked user                          |

**Note on data fetching**: Owner-mode and visitor-mode both call `get-profile` and `list-public-employer-stints`. Visitor-mode additionally calls `get-status`. `myinfo` is already fetched globally via `useMyInfo` hook so it does not add a per-page request.

---

## Stage 2: Implementation Plan

Status: READY
Authors: @psankar

### API Contract

No new TypeSpec definitions required. All types used are imported from existing spec packages:

- `HubProfilePublicView`, `GetProfileRequest` from `vetchium-specs/hub/profile`
- `ConnectionState`, `GetStatusResponse` from `vetchium-specs/hub/connections`
- `PublicEmployerStint`, `ListPublicEmployerStintsRequest` from `vetchium-specs/hub/work-emails`
- `HubMyInfoResponse` from `vetchium-specs/hub/hub-users`

### Database Schema

No database changes required.

### Backend

No backend changes required. All necessary endpoints already exist.

### Frontend

#### Files to Create

| File                                                            | Purpose                                      |
| --------------------------------------------------------------- | -------------------------------------------- |
| `hub-ui/src/pages/Profile/ProfilePage.tsx`                      | Unified profile page (owner + visitor modes) |
| `hub-ui/src/components/profile/ProfileActionsPanel.tsx`         | Visitor-mode connection action widget        |
| `hub-ui/src/components/profile/sections/AboutSection.tsx`       | About / long bio card                        |
| `hub-ui/src/components/profile/sections/WorkHistorySection.tsx` | Verified work history card                   |

#### Files to Modify

| File                                    | Change                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `hub-ui/src/App.tsx`                    | Replace `PublicProfilePage` import with `ProfilePage` at `/u/:handle` route |
| `hub-ui/src/locales/en-US/profile.json` | Add keys listed below                                                       |
| `hub-ui/src/locales/de-DE/profile.json` | Add matching keys                                                           |
| `hub-ui/src/locales/ta-IN/profile.json` | Add matching keys                                                           |

#### Files to Delete

| File                                             | Reason                              |
| ------------------------------------------------ | ----------------------------------- |
| `hub-ui/src/pages/Profile/PublicProfilePage.tsx` | Fully replaced by `ProfilePage.tsx` |

#### New Routes

| Portal | Route        | Page component                                                              |
| ------ | ------------ | --------------------------------------------------------------------------- |
| hub-ui | `/u/:handle` | `src/pages/Profile/ProfilePage.tsx` (already registered; component swapped) |

#### Implementation Notes

**`ProfilePage.tsx`** — page-level data fetching and layout orchestration

- Detect owner mode: compare `handle` URL param against `useMyInfo().handle`. `useMyInfo` is already globally cached so this does not add a network request.
- Fetch profile and employer stints in parallel with `Promise.all`. Fetch connection status only when `!isOwnProfile`.
- While any fetch is in-flight, render a `<Spin spinning />` in a fixed-height container to prevent layout shift.
- 404 state: when `get-profile` returns 404, render a centered message with user-not-found copy and the handle; no Back button.
- Section ordering: build an array of React elements (one per content section) and render them with `.map()`. This is the single place where order is controlled.
- The profile hero is rendered inline in `ProfilePage` (no separate component file) — it is not reused elsewhere, and abstracting it would add indirection without value. The hero layout:

```
[Avatar 96px]  [Name H3]            [Right side: owner → Edit Profile ghost button]
               [@handle monospace]  [Right side: visitor → <ProfileActionsPanel />]
               [short_bio]
               [EnvironmentOutlined city, country]
```

Use a flex row for the hero card interior: `[avatar] [identity div flex:1] [action div flexShrink:0]`.
Avatar: if `profile_picture_url` exists, render `<img>` with `borderRadius: "50%"`; else `<Avatar icon={<UserOutlined />} size={96} />`.

- Do **not** reuse `ConnectWidget` from `hub-ui/src/components/ConnectWidget.tsx`. That component fetches its own connection status internally and is designed for lightweight inline use (e.g., search results). The profile page manages connection state at the page level to allow a single fetch and controlled re-render.

---

**`ProfileActionsPanel.tsx`** — all visitor connection actions

Props interface:

```typescript
interface ProfileActionsPanelProps {
	handle: string;
	displayName: string; // used in confirm dialogs ("Disconnect from Jane Doe?")
	connectionState: ConnectionState;
	onStateChange: (newState: ConnectionState) => void;
}
```

- All action handlers (sendRequest, withdraw, accept, reject, disconnect, block, unblock) live in this component.
- Each handler calls the API, then calls `onStateChange(newState)` on success to update parent state.
- On API error: call `message.error(t("widget.{action}Failed"))` from `connections` i18n namespace — these strings already exist.
- Wrap every action with `<Spin spinning={actionInProgress}>` to prevent double-submission.
- The "More" (⋮) dropdown: use Ant Design `<Dropdown menu={{ items }}>`; each destructive item (Disconnect, Block) triggers a `<Popconfirm>` before calling its handler.
- Connection state → rendered elements (use `connections` namespace for action labels, `profile` for status labels):

| `connectionState`          | Rendered elements                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `not_connected`            | Primary button "Connect" + More menu (Block)                                                                    |
| `ineligible`               | Text label `t("publicProfile.connectionNotAvailable")` only                                                     |
| `request_sent`             | Ghost button "Withdraw Request" + Text label "Connection request pending"                                       |
| `request_received`         | Primary button "Accept" + Default button "Decline" + Text label "{{displayName}} sent you a connection request" |
| `connected`                | Tag/badge "Connected ✓" + More menu (Disconnect + Block)                                                        |
| `i_rejected_their_request` | Primary button "Connect" + More menu (Block)                                                                    |
| `they_rejected_my_request` | More menu (Block) only                                                                                          |
| `i_disconnected`           | Primary button "Connect" + More menu (Block)                                                                    |
| `they_disconnected`        | More menu (Block) only                                                                                          |
| `i_blocked_them`           | Ghost button "Unblock" (no More menu)                                                                           |
| `blocked_by_them`          | Text label `t("publicProfile.youCannotInteract")` only (intentionally vague)                                    |

- After `unblock` succeeds, call `onStateChange("not_connected")` (the backend will return a new status on the next get-status; conservative local state is safest).
- Popconfirm text for Block: `t("widget.blockConfirm.title")` / `t("widget.blockConfirm.description")` (existing keys in `connections` namespace).
- Popconfirm text for Disconnect: `t("widget.disconnectConfirm.title")` / `t("widget.disconnectConfirm.description")` (existing keys in `connections` namespace).

---

**`AboutSection.tsx`**

Props: `{ longBio?: string; isOwner: boolean }`

- If `longBio` is present: render `<Card title={t("publicProfile.about")}>` with `<Paragraph style={{ whiteSpace: "pre-line" }}>`.
- If `longBio` is absent and `isOwner`: render `<Card title={t("publicProfile.about")}>` with a `<Link to="/settings/profile">` prompt: `t("publicProfile.addAbout")`.
- If `longBio` is absent and `!isOwner`: render `null` (card is entirely hidden).

---

**`WorkHistorySection.tsx`**

Props: `{ stints: PublicEmployerStint[] }`

- Always rendered (even when empty — shows empty state copy).
- Sort order: items with `is_current === true` first; remaining sorted by `end_year` descending (most recent past stint first).
- Each row:
  - `<SafetyCertificateOutlined />` icon (verified badge) — the icon signals work email verification; add `<Tooltip title={t("publicProfile.verifiedViaWorkEmail")}>` around it
  - Employer domain in `<Text strong>`
  - `<Tag color="green">{t("publicProfile.current")}</Tag>` if `is_current`
  - Year range: `{start_year} – {is_current ? t("publicProfile.present") : end_year}` in `<Text type="secondary">`
- Render as a vertical list of rows (no `<Table>`, no pagination — public stints are always a small set).
- Empty state: `<Text type="secondary">{t("publicProfile.noVerifiedEmployers")}</Text>`

---

#### i18n

Add the following new keys to the existing `publicProfile` object in all three locales. Keys already present (`userNotFound`, `noVerifiedEmployers`, `current`) must **not** be duplicated.

```json
{
	"publicProfile": {
		"editProfile": "Edit Profile",
		"about": "About",
		"addAbout": "Add an About section →",
		"verifiedWorkHistory": "Verified Work History",
		"verifiedViaWorkEmail": "Verified via work email",
		"present": "present",
		"userNotFoundDesc": "The user @{{handle}} does not exist.",
		"connectionNotAvailable": "Connection not available",
		"requestPending": "Connection request pending",
		"requestReceived": "{{displayName}} sent you a connection request",
		"connectedBadge": "Connected",
		"youCannotInteract": "You cannot interact with this user",
		"moreActions": "More"
	}
}
```

Action labels ("Connect", "Accept", "Reject", "Withdraw", "Disconnect", "Block", "Unblock") reuse existing keys from `connections` → `widget.*` so they do not need to be added to `profile.json`.

Minimum: provide `en-US` values. Add matching keys to `de-DE` and `ta-IN`.

### RBAC

No new roles. All profile-view endpoints are protected by the existing `HubAuth` middleware on the backend. No frontend role-gating is required.

### Test Matrix

No new API endpoints — no new API-level Playwright tests required. Existing tests for `get-profile`, `list-public-employer-stints`, and all connection endpoints remain unchanged.

### Audit Log Events

No write operations originate from this page itself. Connection actions (send, accept, reject, etc.) are already covered by their respective feature specs and their audit logging is already implemented in the backend.
