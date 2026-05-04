## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: hub-employer-ids (the public profile renders verified employer stints by reading from `list-public-employer-stints`)
Dependents: hub-connections (the Connect button widget on a profile page is rendered from `connections/get-status`; hub-profile owns the page chrome but defers the button surface to hub-connections data)

### Overview

A HubUser's profile is the public-facing identity surface on the Hub: a handle, a full name (with multi-language entries), a short bio, a long bio, an optional city, a country, and a profile picture. Other HubUsers reach a profile by knowing the exact handle — there is no search in Phase 1. The page itself shows bio + photo + country + city + the verified-employer widget (driven by `list-public-employer-stints` from hub-employer-ids) and a Connect-button widget (driven by `connections/get-status` once hub-connections ships). Profile-level visibility rules are intentionally simple: any authenticated HubUser may view any other HubUser's profile. Block state from hub-connections only changes the widget on the connect-button area, not the rest of the profile.

There are no public counts (connections, endorsements, etc.) in Phase 1. Profile content is owned by the user via a small CRUD surface: get-my-profile (private fields included), update-my-profile (bio fields + display names + city + country), upload-profile-picture (multipart), remove-profile-picture, and get-profile-by-handle (public view).

Portal affected: Hub portal only. All write operations are initiated by the owning HubUser. Read operations available to any authenticated HubUser.

### Key Concepts and Vocabulary

- **Profile** — the persistent record describing a HubUser to other users. Stored across two locations:
  - **Regional** (HubUser's home region) — `hub_users` table is extended with `short_bio`, `long_bio`, `city`, `profile_picture_storage_key`. The regional store also continues to hold `resident_country_code` and `preferred_language` (already there).
  - **Global** — `hub_user_display_names` already exists (one row per language); `hub_users` (global) holds `handle` (already there).
- **Owner view** — what the authenticated user sees on `get-my-profile`: handle (read-only), all editable fields, the storage key for the picture if present, the timestamps. Used to populate the edit form.
- **Public view** — what any other authenticated user sees on `get-profile`: handle, all display names (caller-localised: preferred for caller's locale if present, else the user's preferred display name), short_bio, long_bio, country, city, profile_picture_url (a `/hub/profile-picture/{handle}` URL — 404 if no picture).
- **Display name** — multi-language full name. Each (`hub_user_global_id`, `language_code`) pair has one row in `hub_user_display_names`; exactly one row per user is `is_preferred = true`. The Hub UI shows the entry whose `language_code` matches the viewer's locale, falling back to the preferred entry.
- **Profile picture** — a single image per user, stored in the platform S3 bucket under the prefix `hub-profile-pictures/{hub_user_global_id}/{uuid}.{ext}`. JPEG / PNG / WEBP. ≤ 5 MB. Re-upload replaces the existing storage key (the old object is asynchronously garbage-collected by an existing storage-cleanup pass — out of this spec; record the orphaned key in a generic `pending_storage_cleanup` table so any future cleanup worker can pick it up).

### Acceptance Criteria

#### Reading

- [ ] `GET /hub/get-my-profile` returns the caller's profile with all owner-view fields. `200`.
- [ ] `POST /hub/get-profile` with `{ handle }` returns the public-view profile. `200` for any authenticated HubUser viewing any handle. `404` when no HubUser has that handle.
- [ ] `GET /hub/profile-picture/{handle}` streams the user's picture bytes with the correct `Content-Type`. `200` if the user has a picture, `404` otherwise.
- [ ] None of the read endpoints require any role beyond an active HubUser session.

#### Updating bio fields

- [ ] `POST /hub/update-my-profile` accepts an object with optional `short_bio`, `long_bio`, `city`, `resident_country_code`, `display_names` (full replace of the multi-language list). Any field that is omitted is left unchanged. The `display_names` array, if provided, must contain at least one entry, with exactly one entry having `is_preferred = true`, and each entry's `language_code` is unique within the array.
- [ ] All field validations match the constraints in the **Field Constraints** table below; failures return 400 with the standard `[{field, message}]` array.
- [ ] On success returns 200 with the updated owner-view profile. Audit: `hub.update_profile` (regional `audit_logs`).
- [ ] If `display_names` is provided: the global `hub_user_display_names` is rewritten transactionally (delete-all-rows-for-user + insert-new-rows). The cross-DB write follows the standard global-then-regional pattern with compensating transaction on failure (see CLAUDE.md "Cross-database").

#### Uploading / removing the picture

- [ ] `POST /hub/upload-profile-picture` accepts `multipart/form-data` with a single field `image`. Image must be JPEG / PNG / WEBP, ≤ 5 MB, and (best-effort decode) ≥ 200×200 and ≤ 4096×4096. Validation failure: 400.
- [ ] On success: the new object is uploaded to S3 under `hub-profile-pictures/{hub_user_global_id}/{uuid}.{ext}`; the prior `profile_picture_storage_key` (if any) is moved to `pending_storage_cleanup`; the new key is written to `hub_users`. Audit: `hub.upload_profile_picture`. Returns 200 with the updated owner-view profile.
- [ ] `POST /hub/remove-profile-picture` clears the profile_picture_storage_key (and records the prior key in `pending_storage_cleanup`); returns 200 with the updated profile. Idempotent: returns 200 even if the user had no picture (no audit row written in the no-op case).
- [ ] All upload + remove endpoints are confined to the caller's own profile (no admin override).

#### Visibility & blocks

- [ ] `get-profile` returns the same payload regardless of any block state between viewer and target. Block state is reflected only in the Connect-button widget, which is owned by hub-connections.
- [ ] `get-profile` response does NOT include any aggregate counts (connections, endorsements). The Phase 1 page is bio + photo + verified employers + connect widget.
- [ ] Profile data of an inactive (`status != 'active'`) HubUser is treated as if they don't exist: `get-profile` returns 404, `profile-picture` returns 404.

#### Auditing & RBAC

- [ ] Audit-log entries written inside the same transaction as every write: `hub.update_profile`, `hub.upload_profile_picture`, `hub.remove_profile_picture`.
- [ ] All endpoints require `HubAuth`. No additional role; an active HubUser session is sufficient.

### Field Constraints

| Field                            | Type   | Required (on update)            | Constraints                                                                         |
| -------------------------------- | ------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| `handle`                         | string | (immutable in this spec)        | Already validated at signup; never editable here                                    |
| `display_names`                  | array  | no (when omitted, leave as-is)  | 1..10 entries; exactly one with `is_preferred=true`; unique `language_code` per row |
| `display_names[*].display_name`  | string | yes (within the array)          | 1..100 chars                                                                        |
| `display_names[*].language_code` | string | yes (within the array)          | BCP-47 tag, max 35 chars                                                            |
| `display_names[*].is_preferred`  | bool   | yes (within the array)          | Exactly one row in the array must be `true`                                         |
| `short_bio`                      | string | no                              | 0..160 chars; trimmed; null/empty allowed (clears the field)                        |
| `long_bio`                       | string | no                              | 0..4000 chars; trimmed                                                              |
| `city`                           | string | no                              | 0..100 chars; trimmed                                                               |
| `resident_country_code`          | string | no                              | ISO 3166-1 alpha-2, exactly 2 uppercase letters                                     |
| `image` (upload)                 | bytes  | yes (on upload-profile-picture) | JPEG/PNG/WEBP, ≤ 5 MB, decoded dims 200..4096 per side                              |
| `handle` (in `get-profile`)      | string | yes                             | Standard handle validation (3..50 chars, lowercase alphanumeric + hyphen)           |

### User-Facing Screens

**Screen: My Profile (Hub)**

Portal: hub-ui | Route: `/settings/profile`

Header: Back to Settings button | "My Profile" h2

Form sections (the page uses the standard feature-page layout, no outer Card; sections use Ant Design `Card`s grouped vertically):

- **Display names**: editable list. One row per language. Each row has Language (BCP-47 input with autocomplete), Display Name (text), Is Preferred (radio across rows). "Add language" / "Remove" buttons. At least one row required; exactly one row marked preferred.
- **Bio**: short_bio (single-line input, char-counter to 160), long_bio (textarea with rich-text-light: line breaks preserved, no markdown for Phase 1, char-counter to 4000).
- **Location**: country (Select with the 250 ISO codes, search-by-name), city (text input, optional).
- **Profile picture**: current image thumbnail; "Upload new" button (file-picker for JPEG/PNG/WEBP); "Remove" button. On upload, immediately POST to `upload-profile-picture` and refresh.

Submit: a single "Save profile" button at the bottom. Wraps the network call with `<Spin>`. The picture upload/remove are independent of this button (act immediately via their own endpoints).

Empty-state for a brand-new user: their preferred display name from signup is pre-filled in the only display-names row.

**Screen: Public Profile**

Portal: hub-ui | Route: `/u/:handle`

Layout:

- Top section: profile picture (left, 128×128 rounded) | display name (h2) + short_bio (subtitle) + handle (`@` prefix, monospace) | Connect-button widget (right) — driven by `connections/get-status` (renders the table from hub-connections § "Profile page connection widget").
- Country and city below the top section.
- Long bio rendered as plain text (line breaks preserved) in a single Card below.
- Verified Employers card below: renders the `list-public-employer-stints` widget (Domain | Period). If the user has zero active/ended stints, the card shows _"No verified employers yet."_
- (Phase 1: nothing else. No connections list, no endorsement count, no "About" sub-page, no posts.)

Empty-state pages: when the handle is unknown, the route renders a minimal "User not found" page with a Back-to-Dashboard link.

### API Surface

| Endpoint                             | Portal | Who calls it    | What it does                                               |
| ------------------------------------ | ------ | --------------- | ---------------------------------------------------------- |
| `GET  /hub/get-my-profile`           | hub    | HubUser (owner) | Returns the caller's owner-view profile                    |
| `POST /hub/update-my-profile`        | hub    | HubUser (owner) | Updates any subset of bio + display_names + country + city |
| `POST /hub/upload-profile-picture`   | hub    | HubUser (owner) | Multipart upload; replaces current picture                 |
| `POST /hub/remove-profile-picture`   | hub    | HubUser (owner) | Clears the picture                                         |
| `POST /hub/get-profile`              | hub    | HubUser         | Public-view profile by handle; 404 if unknown              |
| `GET  /hub/profile-picture/{handle}` | hub    | HubUser         | Streams picture bytes by handle; 404 if no picture         |

### Audit Log Events

| event_type                   | when                                                  | actor_user_id | event_data keys                                                                      |
| ---------------------------- | ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `hub.update_profile`         | update-my-profile success                             | calling user  | `fields_updated` (string array of non-null fields), `display_names_count` if updated |
| `hub.upload_profile_picture` | upload-profile-picture success                        | calling user  | `new_storage_key`, `prior_storage_key` (or null)                                     |
| `hub.remove_profile_picture` | remove-profile-picture success when a picture existed | calling user  | `prior_storage_key`                                                                  |

All entries land in the regional `audit_logs`.

### Out of Scope for Phase 1 (deferred)

- Handle-prefix or name-prefix search. Discovery is by exact handle only; users obtain handles out-of-band (email signature, etc.). A future spec may introduce search.
- "People you may know" suggestions.
- Public connection counts and endorsement counts.
- Owner-controlled visibility (public/connections-only/hidden).
- Activity feed, posts, likes, comments. Out of scope; lives with future hub-posts.
- A dedicated "Block this user" button on the profile page that doesn't go via hub-connections.
- Bulk import of display names from external services.

---

## Stage 2: Implementation Plan

Status: READY-FOR-IMPLEMENTATION
Authors: @psankar

### API Contract

TypeSpec definitions in `specs/typespec/hub/profile.tsp` with matching `.ts` and `.go`.

```typespec
// specs/typespec/hub/profile.tsp
import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model DisplayNameEntry {
  language_code: string;
  display_name:  string;
  is_preferred:  boolean;
}

model HubProfileOwnerView {
  handle:                  Handle;
  display_names:           DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
  has_profile_picture:     boolean;
  preferred_language:      LanguageCode;
  created_at:              utcDateTime;
  updated_at:              utcDateTime;
}

model HubProfilePublicView {
  handle:                  Handle;
  display_names:           DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
  profile_picture_url?:    string;       // absent when has_profile_picture = false
}

model UpdateMyProfileRequest {
  display_names?:          DisplayNameEntry[];
  short_bio?:              string;
  long_bio?:               string;
  city?:                   string;
  resident_country_code?:  CountryCode;
}

model GetProfileRequest { handle: Handle; }

@route("/hub/get-my-profile")           @get  getMyProfile():                                            OkResponse<HubProfileOwnerView>;
@route("/hub/update-my-profile")        @post updateMyProfile     (...UpdateMyProfileRequest):           OkResponse<HubProfileOwnerView> | BadRequestResponse;
@route("/hub/upload-profile-picture")   @post uploadProfilePicture(@bodyRoot form: { image: bytes }):    OkResponse<HubProfileOwnerView> | BadRequestResponse;
@route("/hub/remove-profile-picture")   @post removeProfilePicture():                                    OkResponse<HubProfileOwnerView>;
@route("/hub/get-profile")              @post getProfile          (...GetProfileRequest):                OkResponse<HubProfilePublicView> | NotFoundResponse;
@route("/hub/profile-picture/{handle}") @get  getProfilePicture   (@path handle: Handle):                { @statusCode statusCode: 200; @header contentType: string; @body image: bytes; } | NotFoundResponse;
```

The matching `.ts` and `.go` files mirror this and export `validateUpdateMyProfileRequest`, `validateGetProfileRequest`, plus per-field validators (e.g. `validateShortBio`, `validateLongBio`, `validateCity`, `validateDisplayNames`).

### Database Schema

#### Regional DB additions to `hub_users` (`api-server/db/migrations/regional/00000000000001_initial_schema.sql`)

```sql
-- Existing CREATE TABLE hub_users(...) — extend it with these columns:
ALTER TABLE hub_users ADD COLUMN short_bio                  VARCHAR(160);
ALTER TABLE hub_users ADD COLUMN long_bio                   TEXT;
ALTER TABLE hub_users ADD COLUMN city                       VARCHAR(100);
ALTER TABLE hub_users ADD COLUMN profile_picture_storage_key TEXT;
ALTER TABLE hub_users ADD COLUMN updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

(Per CLAUDE.md, schema changes go directly into the initial-schema file before production — these become `CREATE TABLE` columns rather than ALTERs.)

```sql
CREATE TABLE pending_storage_cleanup (
  storage_key   TEXT        PRIMARY KEY,
  bucket        TEXT        NOT NULL DEFAULT 'vetchium',
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason        TEXT        NOT NULL                       -- e.g. 'profile_picture_replaced', 'profile_picture_removed'
);
```

#### Global DB — no new tables needed

`hub_user_display_names` already exists. No additions.

#### sqlc queries (regional)

`api-server/db/regional/queries/hub_profile.sql`:

```sql
-- name: GetMyHubProfile :one
SELECT hub_user_global_id, handle, status, preferred_language,
       resident_country_code, short_bio, long_bio, city,
       profile_picture_storage_key, created_at, updated_at
FROM hub_users
WHERE hub_user_global_id = @hub_user_global_id;

-- name: UpdateMyHubProfile :one
UPDATE hub_users
SET short_bio             = COALESCE(sqlc.narg('short_bio')::text, short_bio),
    long_bio              = COALESCE(sqlc.narg('long_bio')::text, long_bio),
    city                  = COALESCE(sqlc.narg('city')::text, city),
    resident_country_code = COALESCE(sqlc.narg('country')::text, resident_country_code),
    updated_at            = NOW()
WHERE hub_user_global_id = @hub_user_global_id
RETURNING *;

-- name: SetHubProfilePictureKey :one
UPDATE hub_users
SET profile_picture_storage_key = @storage_key,
    updated_at = NOW()
WHERE hub_user_global_id = @hub_user_global_id
RETURNING profile_picture_storage_key;

-- name: ClearHubProfilePictureKey :one
UPDATE hub_users
SET profile_picture_storage_key = NULL,
    updated_at = NOW()
WHERE hub_user_global_id = @hub_user_global_id
RETURNING NULL::text AS profile_picture_storage_key;

-- name: EnqueueStorageCleanup :exec
INSERT INTO pending_storage_cleanup (storage_key, reason)
VALUES (@storage_key, @reason)
ON CONFLICT (storage_key) DO NOTHING;

-- name: GetPublicProfileByHandle :one
SELECT u.handle, u.status, u.short_bio, u.long_bio, u.city,
       u.resident_country_code, u.profile_picture_storage_key
FROM hub_users u
WHERE u.handle = @handle AND u.status = 'active';
```

#### sqlc queries (global)

`api-server/db/global/queries/hub_user_display_names.sql`:

```sql
-- name: ListHubUserDisplayNames :many
SELECT * FROM hub_user_display_names
WHERE hub_user_global_id = @hub_user_global_id
ORDER BY is_preferred DESC, language_code ASC;

-- name: ReplaceHubUserDisplayNames :many
WITH wipe AS (
  DELETE FROM hub_user_display_names WHERE hub_user_global_id = @hub_user_global_id RETURNING 1
)
INSERT INTO hub_user_display_names (hub_user_global_id, language_code, display_name, is_preferred)
SELECT @hub_user_global_id::uuid,
       UNNEST(@language_codes::text[]),
       UNNEST(@display_names::text[]),
       UNNEST(@is_preferred::boolean[])
RETURNING *;
```

(The wipe-then-insert pattern is allowed because this is the only mutation path for display names; no concurrent writer per user exists.)

### Backend

#### Endpoints

| Method | Path                            | Handler file              | Auth + role |
| ------ | ------------------------------- | ------------------------- | ----------- |
| GET    | `/hub/get-my-profile`           | `handlers/hub/profile.go` | `HubAuth`   |
| POST   | `/hub/update-my-profile`        | `handlers/hub/profile.go` | `HubAuth`   |
| POST   | `/hub/upload-profile-picture`   | `handlers/hub/profile.go` | `HubAuth`   |
| POST   | `/hub/remove-profile-picture`   | `handlers/hub/profile.go` | `HubAuth`   |
| POST   | `/hub/get-profile`              | `handlers/hub/profile.go` | `HubAuth`   |
| GET    | `/hub/profile-picture/{handle}` | `handlers/hub/profile.go` | `HubAuth`   |

#### Handler implementation notes

- **`get-my-profile`** flow: one regional read (`GetMyHubProfile`) + one global read (`ListHubUserDisplayNames`). Compose owner view; `has_profile_picture = profile_picture_storage_key IS NOT NULL`. Return 200.
- **`update-my-profile`** flow:
  1. Decode + validate. If `display_names` provided, validate the array invariants (at least one entry, exactly one preferred, unique languages, length, BCP-47 shape).
  2. If `display_names` provided: do a global tx via `s.WithGlobalTx` calling `ReplaceHubUserDisplayNames`. Otherwise skip the global tx.
  3. Regional tx via `s.WithRegionalTx`: `UpdateMyHubProfile` (any subset of nullable args), then write `audit_logs` row `hub.update_profile` with `fields_updated` listing the non-null inputs.
  4. On regional failure after a global write succeeded: compensate by re-fetching the previous display-names snapshot (we held a copy before the global write) and re-inserting via `ReplaceHubUserDisplayNames`. If the compensation itself fails, log `CONSISTENCY_ALERT` per CLAUDE.md.
  5. Return 200 with the freshly-composed owner view (one extra global read for display names).
- **`upload-profile-picture`** flow:
  1. Parse multipart; reject early if Content-Length > 5MB or no `image` field (400).
  2. Read bytes (capped at 5 MB); detect mime via the leading byte signature; reject if not JPEG/PNG/WEBP (400).
  3. Decode image dimensions (use Go's `image.Decode` from the std lib + WEBP via `golang.org/x/image/webp`) — reject if outside 200..4096 per side (400).
  4. Generate `new_key = "hub-profile-pictures/{hub_user_global_id}/{uuid}.{ext}"`. Upload via the existing AWS SDK v2 client to the `vetchium` bucket (use `UsePathStyle: true`).
  5. Regional tx: `SetHubProfilePictureKey(hub_user_global_id, new_key)` returning the prior key. If prior key non-null, `EnqueueStorageCleanup(prior_key, 'profile_picture_replaced')`. Audit `hub.upload_profile_picture` with `{ new_storage_key, prior_storage_key }`.
  6. On regional tx failure: best-effort delete the just-uploaded S3 object; do not surface partial state.
  7. Return 200 with the owner-view profile.
- **`remove-profile-picture`** flow:
  1. Regional tx: read current key; if null → return 200 (no-op, no audit row).
  2. Otherwise `ClearHubProfilePictureKey` + `EnqueueStorageCleanup(prior_key, 'profile_picture_removed')` + audit row.
  3. Return 200 with the owner-view profile.
- **`get-profile`** flow:
  1. Validate handle.
  2. Resolve handle's home region by global lookup on `hub_users(handle)`. (One global read.)
  3. If unknown handle or status != 'active' → 404.
  4. Single regional read: `GetPublicProfileByHandle(handle)` against the resolved region.
  5. Single global read: `ListHubUserDisplayNames`.
  6. Compose `HubProfilePublicView`. `profile_picture_url` populated as `/hub/profile-picture/{handle}` when `profile_picture_storage_key IS NOT NULL`; else absent.
  7. Return 200.
- **`profile-picture/{handle}`** flow:
  1. Resolve handle's home region (global read).
  2. Regional read: get `profile_picture_storage_key` for the active user.
  3. If null or user not found → 404.
  4. Stream the S3 object back with the correct `Content-Type` (extracted from key extension).
  5. Cache hint header `Cache-Control: private, max-age=300` to discourage server churn but avoid stale photos beyond 5 minutes.

Per CLAUDE.md "Database Performance & Efficiency" — each handler does at most one global round-trip and one regional round-trip.

### Frontend

#### New routes

| Portal | Route path          | Page component                            |
| ------ | ------------------- | ----------------------------------------- |
| hub-ui | `/settings/profile` | `src/pages/Profile/MyProfilePage.tsx`     |
| hub-ui | `/u/:handle`        | `src/pages/Profile/PublicProfilePage.tsx` |

#### Implementation notes

- Standard feature-page layout. `MyProfilePage` uses Ant Design `Form` with `Spin` wrap; submit button disabled while validation errors exist; form sections grouped by `Card`s.
- Display-names editor: a controlled list. "Add language" appends a new row; "Remove" deletes; "Is preferred" radio across rows. Validation: non-empty list, exactly one preferred, unique language code.
- Picture upload: Ant Design `Upload` with `beforeUpload` validating type/size client-side; on success refreshes the page (re-fetches `get-my-profile`).
- Remove-picture: `Popconfirm` → POST → refresh.
- `PublicProfilePage` uses the same layout. Top section uses Flex (gap 24, align center). Verified-employers Card calls `list-public-employer-stints?handle=…` (from hub-employer-ids); Connect widget calls `connections/get-status?handle=…` (from hub-connections) and renders per the table in hub-connections "Profile page connection widget" section.
- 404 view: dedicated minimal layout with handle echo and Back link.

### RBAC

No new roles. `HubAuth` is sufficient for every endpoint.

### i18n

Add `hub-ui/src/locales/{en-US,de-DE,ta-IN}/profile.json`:

```json
{
	"myProfile": {
		"title": "My Profile",
		"backToSettings": "Back to Settings",
		"saveProfile": "Save profile",
		"displayNames": {
			"title": "Display names",
			"languageCode": "Language",
			"displayName": "Display name",
			"isPreferred": "Preferred",
			"addLanguage": "Add language",
			"remove": "Remove",
			"errors": {
				"atLeastOne": "At least one display name is required.",
				"exactlyOnePreferred": "Exactly one display name must be marked as preferred.",
				"duplicateLanguage": "Each language can be used at most once."
			}
		},
		"bio": {
			"title": "Bio",
			"shortBio": "Short bio",
			"shortBioHelp": "One line shown under your name.",
			"longBio": "About me",
			"longBioHelp": "A longer description of yourself."
		},
		"location": {
			"title": "Location",
			"country": "Country",
			"city": "City"
		},
		"picture": {
			"title": "Profile picture",
			"upload": "Upload new",
			"remove": "Remove",
			"removeConfirm": "Remove your profile picture?",
			"errors": {
				"tooLarge": "Image must be 5 MB or smaller.",
				"wrongFormat": "Image must be JPEG, PNG, or WEBP.",
				"wrongDimensions": "Image dimensions must be between 200 and 4096 pixels per side."
			}
		},
		"success": {
			"saved": "Profile saved.",
			"pictureUploaded": "Profile picture updated.",
			"pictureRemoved": "Profile picture removed."
		},
		"errors": {
			"loadFailed": "Failed to load your profile.",
			"saveFailed": "Failed to save your profile.",
			"pictureFailed": "Failed to update your profile picture."
		}
	},
	"publicProfile": {
		"userNotFound": "User not found",
		"verifiedEmployers": "Verified employers",
		"noVerifiedEmployers": "No verified employers yet.",
		"current": "current"
	}
}
```

Mirror keys in `de-DE/profile.json` and `ta-IN/profile.json` with placeholder English values to start.

### Test Matrix

Tests in `playwright/tests/api/hub/profile.spec.ts`. Types imported from `vetchium-specs/hub/profile`.

Test helpers in `playwright/lib/db.ts`:

- `createTestHubUserWithProfileDirect({ short_bio?, long_bio?, city?, country?, display_names? })` — bypass the API for setup.
- `setHubUserProfilePictureKeyDirect(hub_user_global_id, key)` — used by tests that need a pre-seeded picture.
- `getHubUserProfilePictureKey(hub_user_global_id)` — assertion helper.

Add to `playwright/lib/hub-api-client.ts`:

- `getMyProfile`, `getMyProfileRaw`
- `updateMyProfile`, `updateMyProfileRaw`
- `uploadProfilePicture`, `uploadProfilePictureRaw`
- `removeProfilePicture`, `removeProfilePictureRaw`
- `getProfile`, `getProfileRaw`
- `getProfilePictureBytes(handle)` — fetches `/hub/profile-picture/{handle}` and returns the body bytes + Content-Type.

#### Endpoint scenarios

| Endpoint                 | Scenario                                            | Expected                                              |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| get-my-profile           | Success                                             | 200 + handle + display_names + bio fields             |
| get-my-profile           | Unauthenticated                                     | 401                                                   |
| update-my-profile        | Success — single bio field                          | 200 + updated profile                                 |
| update-my-profile        | Success — full replace of display_names             | 200; new languages and preferred flag persisted       |
| update-my-profile        | display_names with zero entries                     | 400                                                   |
| update-my-profile        | display_names with two preferred                    | 400                                                   |
| update-my-profile        | display_names with duplicate language_code          | 400                                                   |
| update-my-profile        | short_bio > 160 chars                               | 400                                                   |
| update-my-profile        | long_bio > 4000 chars                               | 400                                                   |
| update-my-profile        | invalid country code                                | 400                                                   |
| update-my-profile        | empty short_bio clears the field                    | 200; subsequent get returns null                      |
| update-my-profile        | unauthenticated                                     | 401                                                   |
| update-my-profile        | audit row written                                   | `hub.update_profile` with `fields_updated`            |
| update-my-profile        | no audit row on 4xx                                 | count unchanged                                       |
| upload-profile-picture   | Success JPEG                                        | 200 + has_profile_picture=true                        |
| upload-profile-picture   | Success PNG                                         | 200                                                   |
| upload-profile-picture   | Success WEBP                                        | 200                                                   |
| upload-profile-picture   | Replaces prior picture                              | 200; prior key recorded in pending_storage_cleanup    |
| upload-profile-picture   | Rejects GIF                                         | 400                                                   |
| upload-profile-picture   | Rejects > 5 MB                                      | 400                                                   |
| upload-profile-picture   | Rejects 100×100 image                               | 400                                                   |
| upload-profile-picture   | Rejects 5000×5000 image                             | 400                                                   |
| upload-profile-picture   | Audit `hub.upload_profile_picture`                  | row written with new + prior keys                     |
| remove-profile-picture   | Success when picture exists                         | 200; storage key cleared; pending_storage_cleanup row |
| remove-profile-picture   | No-op when no picture                               | 200; no audit row written                             |
| remove-profile-picture   | Audit `hub.remove_profile_picture` (non-no-op case) | row written                                           |
| get-profile              | Success                                             | 200 + public view; no internal fields leaked          |
| get-profile              | Includes profile_picture_url when picture present   | 200                                                   |
| get-profile              | Omits profile_picture_url when no picture           | 200                                                   |
| get-profile              | Unknown handle                                      | 404                                                   |
| get-profile              | Inactive handle (status != 'active')                | 404                                                   |
| get-profile              | Cross-region (target's home region != caller's)     | 200; correct region used                              |
| profile-picture/{handle} | Success                                             | 200 + Content-Type matching upload                    |
| profile-picture/{handle} | No picture set                                      | 404                                                   |
| profile-picture/{handle} | Unknown handle                                      | 404                                                   |
| profile-picture/{handle} | Inactive user                                       | 404                                                   |

### Out-of-spec dependencies (forward links)

- **hub-employer-ids** — public profile page calls `list-public-employer-stints` to render the verified-employers card.
- **hub-connections** — public profile page calls `connections/get-status` to render the connect-button widget. The widget table is owned by hub-connections; this spec only renders the slot.

This spec ships TypeSpec, schema deltas (regional column additions + the global no-op), sqlc queries, handler step lists, Frontend route definitions and i18n keys, and a complete test matrix. A Haiku implementer can follow this without further interpretation.
