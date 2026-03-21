Status: COMPLETED
Authors: @psankar
Dependencies: specs/11-audit-logs/README.md

## Overview

Adds an Audit Logs page to all four portals (Admin, Employer, Agency, Hub) so that
users can browse and filter their audit history through the web UI. No new API
endpoints, no schema changes — the UI calls the existing filter endpoints defined
in spec 11.

## Acceptance Criteria

### Dashboard Tiles

- **Admin portal**: A tile labelled "Audit Logs" is shown on the dashboard only when
  the user has the `admin:view_audit_logs` or `admin:superadmin` role. Clicking it
  navigates to `/audit-logs`.
- **Employer portal**: A tile labelled "Audit Logs" is shown on the dashboard only when
  the user has the `employer:view_audit_logs` or `employer:superadmin` role. Clicking it
  navigates to `/audit-logs`.
- **Agency portal**: A tile labelled "Audit Logs" is shown on the dashboard only when
  the user has the `agency:view_audit_logs` or `agency:superadmin` role. Clicking it
  navigates to `/audit-logs`.
- **Hub portal**: A tile labelled "My Activity" (or equivalent i18n key) is shown on the
  dashboard for **every authenticated hub user** — no special role is required. Clicking
  it navigates to `/my-activity`.
- While `myInfo` is loading, dashboard tiles show skeleton placeholders consistent with
  the existing dashboard loading pattern.

### Route Guards

- Admin `/audit-logs`: accessible only to users with `admin:view_audit_logs` or
  `admin:superadmin`; redirect to `/` otherwise.
- Employer `/audit-logs`: accessible only to users with `employer:view_audit_logs` or
  `employer:superadmin`; redirect to `/` otherwise.
- Agency `/audit-logs`: accessible only to users with `agency:view_audit_logs` or
  `agency:superadmin`; redirect to `/` otherwise.
- Hub `/my-activity`: accessible to any authenticated hub user; no role restriction.

### Filter Panel

Each audit logs page shows a collapsible or always-visible filter panel above the
results table. The filter panel contains:

#### Admin, Employer, Agency portals

| Filter field  | UI component          | Notes                                                     |
| ------------- | --------------------- | --------------------------------------------------------- |
| Event types   | Multi-select dropdown | Pre-populated with all event type strings for that portal |
| Actor user ID | Text input (UUID)     | Optional; filters by the user who performed the action    |
| Start time    | Date-time picker      | Inclusive lower bound on `created_at`                     |
| End time      | Date-time picker      | Inclusive upper bound on `created_at`                     |

#### Hub portal

| Filter field | UI component          | Notes                                         |
| ------------ | --------------------- | --------------------------------------------- |
| Event types  | Multi-select dropdown | Pre-populated with all hub event type strings |
| Start time   | Date-time picker      | Inclusive lower bound on `created_at`         |
| End time     | Date-time picker      | Inclusive upper bound on `created_at`         |

The hub portal has **no Actor User ID filter** — results are always scoped to the
authenticated user.

- Pressing a "Search" (or "Apply") button submits the filter and resets to the first
  page of results.
- Pressing a "Reset" button clears all filter fields and reloads the default (unfiltered)
  first page.
- All filter fields are optional; submitting with no filters returns all events for the
  scoped entity, newest first.

### Results Table

All portals share the same column set, with per-portal omissions noted:

| Column         | Admin | Employer | Agency | Hub | Notes                                                     |
| -------------- | ----- | -------- | ------ | --- | --------------------------------------------------------- |
| Timestamp      | ✓     | ✓        | ✓      | ✓   | Displayed in the user's local timezone; ISO 8601 from API |
| Event type     | ✓     | ✓        | ✓      | ✓   | Raw string value (e.g. `employer.login`)                  |
| Actor user ID  | ✓     | ✓        | ✓      | —   | UUID string; "—" when null (unauthenticated events)       |
| Target user ID | ✓     | ✓        | ✓      | —   | UUID string; "—" when null                                |
| IP address     | ✓     | ✓        | ✓      | ✓   | Raw string from API                                       |
| Event data     | ✓     | ✓        | ✓      | ✓   | Rendered as a formatted JSON block or key-value pairs     |

- The hub portal omits Actor user ID and Target user ID columns entirely (they are always
  the authenticated user or null).
- `event_data` that is an empty object `{}` is displayed as "—" rather than `{}`.
- Null UUID fields display as "—".
- Results are sorted newest-first (the API guarantees this; no client-side re-sorting).

### Pagination

- Pagination uses keyset cursors (`pagination_key` from the response).
- The UI shows a **"Load more"** button below the table (not numbered pages).
- When `pagination_key` in the response is `null`, the "Load more" button is hidden,
  indicating no further results.
- Clicking "Load more" appends the next page of rows to the existing table rather than
  replacing it.
- When a new filter search is submitted, the existing rows are cleared and the cursor is
  reset before fetching the first page.
- Default page size is 40 (matching the API default); this is not user-configurable in
  the UI.

### Event Type Dropdowns

Each portal's event-type multi-select is pre-populated with the full list of event types
defined for that portal in spec 11. The lists are:

#### Admin portal event types

`admin.login`, `admin.login_failed`, `admin.logout`, `admin.invite_user`,
`admin.complete_setup`, `admin.enable_user`, `admin.disable_user`, `admin.assign_role`,
`admin.remove_role`, `admin.change_password`, `admin.request_password_reset`,
`admin.complete_password_reset`, `admin.set_language`, `admin.add_approved_domain`,
`admin.remove_approved_domain`, `admin.add_tag`, `admin.update_tag`,
`admin.upload_tag_icon`, `admin.delete_tag_icon`

#### Employer portal event types

`employer.init_signup`, `employer.complete_signup`, `employer.login`,
`employer.login_failed`, `employer.logout`, `employer.invite_user`,
`employer.complete_setup`, `employer.enable_user`, `employer.disable_user`,
`employer.assign_role`, `employer.remove_role`, `employer.claim_domain`,
`employer.verify_domain`, `employer.change_password`,
`employer.request_password_reset`, `employer.complete_password_reset`,
`employer.set_language`, `employer.add_cost_center`, `employer.update_cost_center`,
`employer.create_suborg`, `employer.rename_suborg`, `employer.disable_suborg`,
`employer.enable_suborg`, `employer.add_suborg_member`, `employer.remove_suborg_member`

#### Agency portal event types

`agency.init_signup`, `agency.complete_signup`, `agency.login`, `agency.login_failed`,
`agency.logout`, `agency.invite_user`, `agency.complete_setup`, `agency.enable_user`,
`agency.disable_user`, `agency.assign_role`, `agency.remove_role`,
`agency.claim_domain`, `agency.verify_domain`, `agency.change_password`,
`agency.request_password_reset`, `agency.complete_password_reset`, `agency.set_language`

#### Hub portal event types

`hub.request_signup`, `hub.complete_signup`, `hub.login`, `hub.login_failed`,
`hub.logout`, `hub.change_password`, `hub.request_password_reset`,
`hub.complete_password_reset`, `hub.set_language`, `hub.request_email_change`,
`hub.complete_email_change`

### Empty and Error States

- When no results match the current filter, the table area shows a brief empty-state
  message (e.g. "No audit log entries found").
- When the API returns an error, a user-visible error message is shown; the table is not
  rendered.
- The "Load more" button shows a loading spinner while the next page is being fetched;
  it is disabled during that time to prevent double-submission.
- The entire page is wrapped in a `<Spin>` while the initial data load is in progress.

### i18n

All user-visible strings must have translation keys in `en-US`, `de-DE`, and `ta-IN`.
Keys to add per portal (pattern: `auditLogs.*`):

- `auditLogs.title` — page heading
- `auditLogs.filterPanel.eventTypes` — label for event type filter
- `auditLogs.filterPanel.actorUserId` — label for actor user ID filter
- `auditLogs.filterPanel.startTime` — label for start time filter
- `auditLogs.filterPanel.endTime` — label for end time filter
- `auditLogs.filterPanel.search` — search/apply button label
- `auditLogs.filterPanel.reset` — reset button label
- `auditLogs.table.timestamp` — column header
- `auditLogs.table.eventType` — column header
- `auditLogs.table.actorUserId` — column header
- `auditLogs.table.targetUserId` — column header
- `auditLogs.table.ipAddress` — column header
- `auditLogs.table.eventData` — column header
- `auditLogs.loadMore` — load more button label
- `auditLogs.empty` — empty-state message
- `auditLogs.error` — generic error message

The hub portal reuses the same key namespace but the page heading key should read
"My Activity" (or equivalent) rather than "Audit Logs".

### Dashboard i18n keys

- `dashboard.auditLogs.title` — tile heading (admin/employer/agency)
- `dashboard.auditLogs.description` — tile subtitle (admin/employer/agency)
- `dashboard.myActivity.title` — tile heading (hub)
- `dashboard.myActivity.description` — tile subtitle (hub)

## Scope

- **In scope**:
  - Audit Logs page in Admin, Employer, and Agency portals (role-gated)
  - My Activity page in Hub portal (open to all authenticated hub users)
  - Dashboard tiles linking to those pages
  - Route guards matching the role requirements
  - Filter panel, results table, keyset pagination ("Load more")
  - Full i18n coverage across en-US, de-DE, ta-IN

- **Out of scope**:
  - Any new API endpoints or changes to existing endpoints
  - Any database schema changes
  - Exporting audit logs to CSV or other formats
  - Real-time / live-updating audit log streams
  - Admin cross-portal audit log views (admin viewing employer/agency/hub events);
    this would require new API work and is not part of this spec
  - Inline user lookup (resolving actor/target UUIDs to display names); UUIDs are
    shown as-is
