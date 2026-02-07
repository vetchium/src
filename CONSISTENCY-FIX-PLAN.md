# Data Consistency Fix Plan

This plan addresses all cross-database consistency issues in the Vetchium codebase through architectural simplification and targeted bug fixes. The core idea: make the global DB a thin, mostly-immutable routing table so that nearly all mutable operations happen in a single regional DB transaction.

## Architecture Change Summary

### Current Problem

The global DB stores mutable fields (status, preferred_language, full_name, is_admin) alongside routing data (email_hash, home_region). This forces almost every write operation (signup, setup, login, language change, domain verification) to update BOTH global and regional databases without ACID guarantees, creating numerous inconsistency windows.

### Target Architecture

**Global DB = Immutable routing table** (written once during entity creation, never updated except email_hash change):

| Table                   | Fields (after change)                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| hub_users               | hub_user_global_id, email_address_hash, hashing_algorithm, handle, home_region, created_at |
| org_users               | org_user_id, email_address_hash, hashing_algorithm, employer_id, home_region, created_at   |
| agency_users            | agency_user_id, email_address_hash, hashing_algorithm, agency_id, home_region, created_at  |
| employers               | employer_id, employer_name, region, created_at (unchanged)                                 |
| agencies                | agency_id, agency_name, region, created_at (unchanged)                                     |
| global_employer_domains | domain, region, employer_id, created_at (status REMOVED)                                   |
| global_agency_domains   | domain, region, agency_id, created_at (status REMOVED)                                     |
| admin_users             | unchanged (admin is global-only, single-DB transactions)                                   |
| roles                   | unchanged (seed data, never modified)                                                      |

**Regional DB = All mutable data** (single-DB ACID transactions):

| Table        | Fields added                                              |
| ------------ | --------------------------------------------------------- |
| hub_users    | status, preferred_language, resident_country_code, handle |
| org_users    | status, preferred_language, is_admin                      |
| agency_users | status, preferred_language, is_admin                      |

**Fields moved from global to regional:**

- `hub_users.status` - checked during login and middleware auth
- `hub_users.preferred_language` - used for TFA email language
- `hub_users.resident_country_code` - user profile data
- `org_users.status` - checked during login and middleware auth
- `org_users.full_name` - already in regional, remove from global
- `org_users.preferred_language` - used for TFA email language
- `org_users.is_admin` - checked by EmployerAdminOnly middleware
- `agency_users.status` - checked during login and middleware auth
- `agency_users.full_name` - already in regional, remove from global
- `agency_users.preferred_language` - used for TFA email language
- `agency_users.is_admin` - checked by AgencyAdminOnly middleware
- `global_employer_domains.status` - regional is source of truth
- `global_agency_domains.status` - regional is source of truth

**Role assignments moved to regional-only:**

- `org_user_roles` - remove from global, keep in regional only
- `agency_user_roles` - remove from global, keep in regional only
- `admin_user_roles` - stays in global (admin is global-only)

### What This Eliminates

After these changes, the following operations become **single-DB (regional) transactions** instead of cross-DB operations:

- CompleteSetup (org, agency) - was: regional password + global full_name + global status
- SetLanguage (hub, org, agency) - was: global + regional
- VerifyDomain - was: regional status + global status
- DisableUser/EnableUser (org, agency) - was: global status update
- AssignRole/RemoveRole (org, agency) - was: global role update
- InviteUser role assignments - was: global role assignment after regional invite

### What Remains Cross-DB

Only these operations still need cross-DB coordination:

1. **User creation** (signup/invite): Create routing entry in global + full record in regional
2. **Email change** (hub only): Update hash in global + email in regional
3. **Domain claim** (org only): Create uniqueness entry in global + verification entry in regional

For these remaining cross-DB operations, we apply proper SAGA patterns with verified compensating transactions.

### Login Flow Change

**Before:**

1. Hash email -> query global (get user_id, status, preferred_language, region)
2. Check status in global
3. Route to regional -> check password
4. Use preferred_language from global for TFA email

**After:**

1. Hash email -> query global (get user_id, region ONLY)
2. Route to regional -> get full user (status, password, preferred_language)
3. Check status in regional
4. Use preferred_language from regional for TFA email

### Middleware Auth Change

**Before (HubAuth/OrgAuth/AgencyAuth):**

1. Extract region from token prefix
2. Query regional DB for session -> get user_id
3. Query global DB for user -> get status, is_admin, preferred_language, etc.
4. Store global user in context

**After:**

1. Extract region from token prefix
2. Query regional DB for session -> get user_id
3. Query regional DB for user -> get status, is_admin, preferred_language, etc.
4. Store regional user in context (need new context types or keep using global types)
5. Still query global DB only if we need the email_hash or home_region (rare, most handlers don't need this)

**Key decision:** The middleware currently stores `*globaldb.HubUser` / `*globaldb.OrgUser` / `*globaldb.AgencyUser` in context. After the change, these types won't have status/is_admin/preferred_language fields. We have two options:

- **Option A**: Change middleware to store `*regionaldb.HubUser` etc. and update all handlers to use regional types
- **Option B**: Create a unified user type that middleware populates from regional data

**Recommendation**: Option A is simpler and more explicit. The middleware already queries regional for the session - it just needs to also fetch the user from regional. All handlers that currently call `middleware.OrgUserFromContext(ctx)` would get a regional user type instead.

However, some handlers DO need global user data (e.g., employer_id for org users). The regional org_users table already has employer_id, so this should work. Let's verify: the middleware currently provides `globaldb.OrgUser` which has `OrgUserID`, `EmployerID`, `Status`, `IsAdmin`, `PreferredLanguage`, `HomeRegion`. After the change, `regionaldb.OrgUser` would have all these fields EXCEPT `HomeRegion` and `EmailAddressHash` (which are global-only). Handlers rarely need these - and when they do, they can query global explicitly.

---

## Commit Plan

### Commit 1: Schema migration - Make global DB a thin routing table

**Files to modify:**

- `api-server/db/migrations/global/00000000000001_initial_schema.sql`
- `api-server/db/migrations/regional/00000000000001_initial_schema.sql`
- `api-server/db/dev-seed/global.sql`
- `api-server/db/dev-seed/regional.sql`

**Global schema changes:**

1. `hub_users` table: Remove columns `status`, `preferred_language`, `resident_country_code`. Keep: `hub_user_global_id`, `handle`, `email_address_hash`, `hashing_algorithm`, `home_region`, `created_at`
2. `org_users` table: Remove columns `full_name`, `is_admin`, `status`, `preferred_language`. Keep: `org_user_id`, `email_address_hash`, `hashing_algorithm`, `employer_id`, `home_region`, `created_at`
3. `agency_users` table: Remove columns `full_name`, `is_admin`, `status`, `preferred_language`. Keep: `agency_user_id`, `email_address_hash`, `hashing_algorithm`, `agency_id`, `home_region`, `created_at`
4. `global_employer_domains` table: Remove column `status`. Keep: `domain`, `region`, `employer_id`, `created_at`
5. `global_agency_domains` table: Remove column `status`. Keep: `domain`, `region`, `agency_id`, `created_at`
6. Remove `org_user_roles` table from global (keep only in regional)
7. Remove `agency_user_roles` table from global (keep only in regional)
8. Remove `hub_user_status` enum from global (moved to regional)
9. Remove `org_user_status` enum from global (moved to regional)
10. Remove `agency_user_status` enum from global (moved to regional)
11. Remove `domain_verification_status` enum from global (moved to regional)
12. Keep `admin_user_roles` in global (admin is global-only)

**Regional schema changes:**

1. `hub_users` table: Add columns `status` (hub_user_status enum, NOT NULL DEFAULT 'active'), `preferred_language` (TEXT, NOT NULL DEFAULT 'en-US'), `resident_country_code` (TEXT, nullable), `handle` (TEXT, NOT NULL)
2. `org_users` table: Add columns `status` (org_user_status enum, NOT NULL DEFAULT 'active'), `preferred_language` (TEXT, NOT NULL DEFAULT 'en-US'), `is_admin` (BOOLEAN, NOT NULL DEFAULT FALSE)
3. `agency_users` table: Add columns `status` (agency_user_status enum, NOT NULL DEFAULT 'active'), `preferred_language` (TEXT, NOT NULL DEFAULT 'en-US'), `is_admin` (BOOLEAN, NOT NULL DEFAULT FALSE)
4. Add enum types: `hub_user_status` ('active', 'disabled', 'deleted'), `org_user_status` ('invited', 'active', 'disabled'), `agency_user_status` ('invited', 'active', 'disabled')
5. Add `hub_user_display_names` table (copy from global schema, keep in BOTH global and regional for now - global for cross-region visibility, regional as cache)

**Seed data changes:**

- Update global seed to not include removed columns
- Update regional seed to include new columns with appropriate values

### Commit 2: Update SQL queries and regenerate sqlc

**Files to modify:**

- `api-server/db/queries/global.sql`
- `api-server/db/queries/regional.sql`
- `api-server/sqlc.yaml` (if needed)
- All generated files via `sqlc generate`

**Global query changes:**

1. `CreateHubUser`: Remove status, preferred_language, resident_country_code params
2. `CreateOrgUser`: Remove full_name, is_admin, status, preferred_language params
3. `CreateAgencyUser`: Remove full_name, is_admin, status, preferred_language params
4. `GetHubUserByEmailHash`: Return only hub_user_global_id, handle, home_region (no status/language)
5. `GetHubUserByGlobalID`: Return only routing fields
6. `GetOrgUserByID`: Return only org_user_id, employer_id, home_region
7. `GetOrgUserByEmailHashAndEmployer`: Return only routing fields
8. `GetAgencyUserByID`: Return only agency_user_id, agency_id, home_region
9. Remove: `UpdateHubUserPreferredLanguage`, `UpdateOrgUserStatus`, `UpdateOrgUserFullName`, `UpdateOrgUserPreferredLanguage`, `UpdateAgencyUserStatus`, `UpdateAgencyUserFullName`, `UpdateAgencyUserPreferredLanguage` (these now happen in regional only)
10. Remove: `UpdateGlobalEmployerDomainStatus`, `UpdateGlobalAgencyDomainStatus` (status removed from global)
11. Remove: `CreateGlobalEmployerDomain` status param, `CreateGlobalAgencyDomain` status param
12. Remove: `AssignOrgUserRole`, `RemoveOrgUserRole`, `HasOrgUserRole`, `AssignAgencyUserRole`, `RemoveAgencyUserRole`, `HasAgencyUserRole` from global (moved to regional)
13. Remove: `CountOrgUsersByEmployer`, `CountAgencyUsersByAgency` from global (moved to regional)

**Regional query changes:**

1. `CreateHubUser`: Add status, preferred_language, resident_country_code, handle params
2. `CreateOrgUser`: Add status, preferred_language, is_admin params
3. `CreateAgencyUser`: Add status, preferred_language, is_admin params
4. Add: `UpdateHubUserStatus`, `UpdateHubUserPreferredLanguage`
5. Add: `UpdateOrgUserStatus`, `UpdateOrgUserPreferredLanguage`, `UpdateOrgUserFullName`
6. Add: `UpdateAgencyUserStatus`, `UpdateAgencyUserPreferredLanguage`, `UpdateAgencyUserFullName`
7. Add: `GetHubUserByGlobalID` (for middleware - returns full user with status, language, etc.)
8. Update: `GetOrgUserByID` to return status, is_admin, preferred_language
9. Update: `GetAgencyUserByID` to return status, is_admin, preferred_language
10. Add: `CountOrgUsersByEmployer`, `CountAgencyUsersByAgency`
11. Ensure `AssignOrgUserRole`, `RemoveOrgUserRole`, `HasOrgUserRole` exist in regional
12. Ensure `AssignAgencyUserRole`, `RemoveAgencyUserRole`, `HasAgencyUserRole` exist in regional

**After query changes:** Run `sqlc generate` to regenerate Go types.

### Commit 3: Update auth middleware to read from regional DB

**Files to modify:**

- `api-server/internal/middleware/auth.go`
- `api-server/internal/middleware/roles.go`

**auth.go changes:**

1. **HubAuth middleware**: After getting session from regional DB, query regional DB for hub user (instead of global DB for user status). Change the context value from `*globaldb.HubUser` to a new type or `*regionaldb.HubUser`. The middleware should still query global for routing purposes but store regional user data in context.

   Specifically:
   - Keep: `tokens.ExtractRegionFromToken()` to get region
   - Keep: `regionalDB.GetHubSession()` to verify session
   - Change: Instead of `db.GetHubUserByGlobalID()` on global, use `regionalDB.GetHubUserByGlobalID()` on regional
   - Change: Check `regionalUser.Status == "active"` instead of `globalUser.Status`
   - Store: Regional user in context

2. **OrgAuth middleware**: Same pattern as HubAuth.
   - Change: Instead of `db.GetOrgUserByID()` on global, use `regionalDB.GetOrgUserByID()` on regional
   - Regional user now has: org_user_id, email_address, employer_id, full_name, password_hash, status, is_admin, preferred_language
   - Store: Regional user in context (handlers access employer_id, is_admin, etc. from regional user)

3. **AgencyAuth middleware**: Same pattern.

4. **Context accessor functions**: Update return types.
   - `HubUserFromContext(ctx)` returns `*regionaldb.HubUser` (or keep `*globaldb.HubUser` if we adapt the type)
   - `OrgUserFromContext(ctx)` returns `*regionaldb.OrgUser`
   - `AgencyUserFromContext(ctx)` returns `*regionaldb.AgencyUser`

**roles.go changes:**

1. **EmployerRole**: Change from querying global `HasOrgUserRole` to querying regional `HasOrgUserRole`. The middleware already has access to `getRegionalDB` function.

2. **AgencyRole**: Same change - query regional instead of global.

3. **EmployerAdminOnly**: Currently checks `orgUser.IsAdmin` from global user. After change, `is_admin` comes from regional user. Since middleware now stores regional user, this should work automatically.

4. **AgencyAdminOnly**: Same as EmployerAdminOnly.

5. **AdminRole**: No change needed (admin is global-only).

### Commit 4: Update login handlers to use regional for mutable data

**Files to modify:**

- `api-server/handlers/hub/login.go`
- `api-server/handlers/org/login.go`
- `api-server/handlers/agency/login.go`

**hub/login.go changes:**

1. `GetHubUserByEmailHash` on global now returns only routing data (no status, no preferred_language)
2. After getting region from global, query regional for full user data
3. Check status from regional user (currently checks `globalUser.Status`)
4. Get `preferred_language` from regional user for TFA email (currently uses `globalUser.PreferredLanguage`)

**org/login.go changes:**

1. `GetEmployerByDomain` on global stays the same (employer routing)
2. `GetOrgUserByEmailHashAndEmployer` on global now returns only routing data
3. After routing to regional, get full user from regional (status, preferred_language)
4. Check status from regional user
5. Get `preferred_language` from regional user for TFA email

**agency/login.go changes:**
Same pattern as org/login.go.

### Commit 5: Fix hub CompleteSignup - use WithGlobalTx and simplify

**File to modify:**

- `api-server/handlers/hub/complete-signup.go`

**Current issues:**

- Multiple separate global DB writes (CreateHubUser, CreateHubUserDisplayName x N) without transaction
- Compensating deletes don't verify success

**Fix:**

1. Wrap all global operations in `s.WithGlobalTx()`:
   - CreateHubUser (routing data only: email_hash, handle, home_region)
   - CreateHubUserDisplayName (preferred + others)
2. After global TX succeeds, do regional operations in `s.WithRegionalTx()`:
   - CreateHubUser (full data: email, password, status='active', preferred_language, resident_country_code, handle)
   - CreateHubSession
3. If regional TX fails, compensate by deleting global user (single delete, verified)
4. Move `MarkHubSignupTokenConsumed` into the global TX (not best-effort)

### Commit 6: Fix org CompleteSignup - move roles to regional TX

**File to modify:**

- `api-server/handlers/org/complete-signup.go`

**Current issues:**

- Global TX creates employer + domain + user + roles (complex)
- Regional operations happen outside TX with multi-step compensation

**Fix:**

1. Global TX (simplified): CreateEmployer + CreateGlobalEmployerDomain + CreateOrgUser (routing data only)
2. Regional TX (new, atomic): CreateOrgUser (full data with status, is_admin, preferred_language) + AssignOrgUserRoles + CreateOrgSession
3. If regional TX fails, compensate by deleting employer from global (cascades to domain + user)
4. Check compensating delete return value - log CONSISTENCY_ALERT if it fails
5. Move `MarkOrgSignupTokenConsumed` into global TX

### Commit 7: Fix agency CompleteSignup - same pattern as org

**File to modify:**

- `api-server/handlers/agency/complete-signup.go`

Same changes as Commit 6 but for agency entities.

### Commit 8: Fix org/agency CompleteSetup - regional-only operations

**Files to modify:**

- `api-server/handlers/org/complete-setup.go`
- `api-server/handlers/agency/complete-setup.go`

**Current issues:**

- Updates regional DB (password), then global DB (full_name, status) as separate operations
- Global full_name update failure is silently ignored
- If global status update fails, user is stuck in 'invited' state

**Fix (both files):**
Since status, full_name, and preferred_language are now regional-only:

1. Single regional TX: UpdateOrgUserSetup (password, full_name, authentication_type, status='active', preferred_language)
2. Delete invitation token in same TX
3. No global DB writes needed at all
4. This completely eliminates the cross-DB consistency issue

### Commit 9: Fix org/agency InviteUser - restructure write order

**Files to modify:**

- `api-server/handlers/org/invite-user.go`
- `api-server/handlers/agency/invite-user.go`

**Current issues:**

- 6-step sequential writes with compensating transactions at each step
- Read operations (GetOrgUserByID, GetEmployerByID) interleaved with writes, triggering rollbacks on read failure
- Compensating deletes don't verify success

**Fix:**

1. Move ALL read operations before any writes:
   - Get inviter info from regional DB
   - Get employer info from global DB
   - Prepare email content
2. Then write in two steps:
   - Global: CreateOrgUser (routing data only: email_hash, employer_id, home_region)
   - Regional TX: CreateOrgUser (full data with status='invited') + CreateOrgInvitationToken + EnqueueEmail
3. If regional TX fails, compensate by deleting global user (single verified delete)
4. Check compensating delete return value

### Commit 10: Fix hub CompleteEmailChange - proper compensation

**File to modify:**

- `api-server/handlers/hub/complete-email-change.go`

**Current issue (CRITICAL):**

- Updates regional email first, then global hash
- If global hash update fails, email is inconsistent across DBs
- User can never log in again
- Code acknowledges this with a comment but has no fix

**Fix:**

1. Update global hash FIRST (this is the routing change)
2. Then update regional email
3. If regional update fails, REVERT global hash to old value (compensating transaction)
4. Verify compensating transaction success
5. The key insight: updating global first is safer because if regional fails, the old email still works for login (global routes to correct region, and regional still has the old email that matches)

### Commit 11: Fix domain handlers - regional-only status

**Files to modify:**

- `api-server/handlers/org/verify-domain.go`
- `api-server/handlers/org/claim-domain.go`
- `api-server/handlers/org/get-domain-status.go`

**verify-domain.go:**

- Remove global status update (lines 139-146, 182-191)
- Regional status update is sufficient (it's now the only source of truth)
- No cross-DB consistency issue possible

**claim-domain.go:**

- `CreateGlobalEmployerDomain` no longer takes status param
- Regional `CreateEmployerDomain` sets status=PENDING
- Compensating transaction pattern stays (but verify delete success)

**get-domain-status.go:**

- Read from regional only (if it currently reads global status)

### Commit 12: Fix SetLanguage handlers - regional-only

**Files to modify:**

- `api-server/handlers/hub/set-language.go`
- `api-server/handlers/org/set-language.go`
- `api-server/handlers/agency/set-language.go`

**Fix:** Update preferred_language in regional DB only. Remove any global DB update.

### Commit 13: Fix DisableUser/EnableUser - regional-only

**Files to modify:**

- `api-server/handlers/org/disable-user.go`
- `api-server/handlers/org/enable-user.go`
- `api-server/handlers/agency/disable-user.go`
- `api-server/handlers/agency/enable-user.go`

**Fix:** Update status in regional DB only. Remove any global DB update.

### Commit 14: Fix AssignRole/RemoveRole - regional-only

**Files to modify:**

- `api-server/handlers/org/assign-role.go`
- `api-server/handlers/org/remove-role.go`
- `api-server/handlers/agency/assign-role.go`
- `api-server/handlers/agency/remove-role.go`

**Fix:** Assign/remove roles in regional DB only. Remove any global DB operation.

### Commit 15: Fix remaining compensating transaction patterns

**Files to modify:**

- `api-server/handlers/hub/request-signup.go`
- `api-server/handlers/hub/request-password-reset.go`
- `api-server/handlers/hub/request-email-change.go`
- `api-server/handlers/hub/login.go` (TFA token compensation)
- `api-server/handlers/hub/change-password.go`
- `api-server/handlers/hub/complete-password-reset.go`
- `api-server/handlers/org/login.go` (TFA token compensation)
- `api-server/handlers/org/request-password-reset.go`
- `api-server/handlers/org/complete-password-reset.go`
- `api-server/handlers/org/change-password.go`
- `api-server/handlers/agency/login.go`
- `api-server/handlers/agency/request-password-reset.go`
- `api-server/handlers/agency/complete-password-reset.go`
- `api-server/handlers/agency/change-password.go`
- `api-server/handlers/admin/invite-user.go`

**Pattern to apply everywhere:**

For token + email operations (within a single regional DB), use `WithRegionalTx`:

```go
err = s.WithRegionalTx(ctx, regionalPool, func(qtx *regionaldb.Queries) error {
    // Create token
    err := qtx.CreateTFAToken(ctx, params)
    if err != nil {
        return err
    }
    // Enqueue email
    _, err = qtx.EnqueueEmail(ctx, emailParams)
    return err
})
```

This eliminates the need for compensating transactions within a single DB - both operations succeed or fail atomically.

For cross-DB compensating transactions, verify the compensation succeeded:

```go
if delErr := s.Global.DeleteUser(ctx, userID); delErr != nil {
    log.Error("CONSISTENCY_ALERT: failed to compensate global write",
        "entity_type", "org_user",
        "entity_id", userID,
        "intended_action", "delete",
        "error", delErr,
    )
}
```

**Specific fixes in this commit:**

1. **hub/login.go, org/login.go, agency/login.go**: Wrap TFA token creation + email enqueue in `WithRegionalTx`. This eliminates the compensating delete pattern entirely for these handlers.

2. **hub/request-signup.go**: Wrap signup token creation + email enqueue. Token is in global, email is in regional - these can't be in the same TX. Keep the compensating pattern but verify the delete.

3. **hub/request-password-reset.go, org/request-password-reset.go, agency/request-password-reset.go**: Wrap reset token + email in `WithRegionalTx` (both are regional).

4. **hub/request-email-change.go**: Wrap verification token + email in `WithRegionalTx` (both are regional).

5. **hub/change-password.go, org/change-password.go, agency/change-password.go**: Wrap password update + session invalidation in `WithRegionalTx`. This ensures sessions are always invalidated when password changes.

6. **hub/complete-password-reset.go, org/complete-password-reset.go, agency/complete-password-reset.go**: Wrap password update + token delete + session invalidation in `WithRegionalTx`. This prevents reset token reuse and ensures session cleanup.

7. **admin/invite-user.go**: Admin operations are global-only. Wrap user creation + invitation token creation in `WithGlobalTx`. Email enqueue goes to regional - keep compensating pattern but verify success.

### Commit 16: Fix MyInfo handlers to use regional data

**Files to modify:**

- `api-server/handlers/hub/myinfo.go` (if it exists)
- `api-server/handlers/org/myinfo.go`
- `api-server/handlers/agency/myinfo.go`

**Fix:** These handlers return user profile info. After the schema change, fields like full_name, preferred_language, is_admin come from regional context (set by middleware). Update to use the new context types.

### Commit 17: Fix FilterUsers handlers

**Files to modify:**

- `api-server/handlers/org/filter-users.go`
- `api-server/handlers/agency/filter-users.go`
- `api-server/handlers/admin/filter-users.go`

**Fix:** If these query global DB for user lists with status/name fields, update to query regional DB instead. Admin filter-users can stay global (admin users are global-only).

### Commit 18: Update global-api-server background workers

**Files to modify:**

- `api-server/cmd/global-api-server/main.go`
- Any background worker files

**Fix:** The global server runs cleanup jobs for expired tokens. Since some tokens/status fields moved to regional, verify the cleanup jobs still target the correct database. Hub signup tokens and org/agency signup tokens are still in global, so those cleanups stay. Admin token cleanups stay in global.

### Commit 19: Update tests

**Files to modify:**

- All test files in `playwright/tests/`
- `playwright/lib/api-client.ts`
- `playwright/lib/db.ts`

**Changes:**

1. Update `db.ts` helper functions to insert test data with the new schema (e.g., `createTestOrgUser` now needs to insert status, preferred_language, is_admin in regional DB)
2. Update test assertions that check response fields
3. All existing test scenarios should still pass - the API contract doesn't change, only the internal implementation

### Commit 20: Cleanup - remove unused global queries and types

**Files to modify:**

- `api-server/db/queries/global.sql` (remove any remaining dead queries)
- Run `sqlc generate` one final time
- Remove any unused Go types

---

## Verification Checklist

After all commits, verify:

1. **No handler writes to global DB mutable fields** (status, preferred_language, full_name, is_admin) - only routing fields are in global
2. **All auth middleware reads user data from regional** - no global user data fetch except routing
3. **All role checks happen in regional** (except admin roles which stay global)
4. **All single-DB operations use transactions** (`WithGlobalTx` or `WithRegionalTx`)
5. **All cross-DB compensating transactions verify success** and log CONSISTENCY_ALERT on failure
6. **All read operations happen before write operations** in multi-step handlers
7. **Login flow works**: email hash lookup in global -> route to regional -> full auth in regional
8. **TFA flow works**: token in regional, session creation in regional
9. **Signup flow works**: thin global entry + full regional entry in TX
10. **Domain operations work**: global uniqueness + regional status
11. **All existing tests pass**

## Risk Assessment

**Low risk changes:**

- Commits 11-14 (regional-only handlers): Simple field source change
- Commit 15 (WithRegionalTx wrapping): Strictly better than current compensating patterns

**Medium risk changes:**

- Commits 3-4 (middleware + login): Core auth flow change, well-tested
- Commits 5-9 (signup/invite fixes): Complex flows but simplified by architecture

**High risk changes:**

- Commits 1-2 (schema + queries): Foundational change, everything depends on this
- Commit 10 (email change): CRITICAL bug fix, needs careful testing

**Recommended testing order:**

1. After Commit 2: Verify `sqlc generate` produces valid Go code
2. After Commit 4: Verify login flows work end-to-end
3. After Commit 10: Verify email change doesn't leave inconsistent state
4. After Commit 19: Full test suite passes
