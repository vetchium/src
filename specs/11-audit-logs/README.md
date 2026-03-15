Status: COMPLETED
Authors: @psankar
Dependencies: specs/9-tags/README.md, specs/10-costcenters-employer/README.md

## Acceptance Criteria

- Three new roles for viewing audit logs:
  - `admin:view_audit_logs` — Admin portal audit log access
  - `employer:view_audit_logs` — Employer portal audit log access
  - `agency:view_audit_logs` — Agency portal audit log access
- Admin portal: users with `admin:view_audit_logs` or `admin:superadmin` can query all admin portal audit events
- Employer portal: users with `employer:view_audit_logs` or `employer:superadmin` can query audit events scoped to their org
- Agency portal: users with `agency:view_audit_logs` or `agency:superadmin` can query audit events scoped to their agency
- Hub users can query their own audit events (no special role required; automatically scoped to the authenticated user)
- All write operations on all portals produce an audit log entry atomically within the same DB transaction as the primary operation

## Scope

### Auditable Events

Every successful write operation produces an audit log entry. The audit log write is part of the same DB transaction as the primary operation — if the audit write fails, the whole operation rolls back. Failed requests (4xx/5xx) are not logged, except for login failures which are logged as standalone writes for security purposes.

#### Admin Portal

| Event Type                      | Trigger                                  |
| ------------------------------- | ---------------------------------------- |
| `admin.login`                   | Successful login (after TFA if enabled)  |
| `admin.login_failed`            | Failed login attempt (wrong credentials) |
| `admin.logout`                  | Logout                                   |
| `admin.invite_user`             | Admin user invited                       |
| `admin.complete_setup`          | Invited admin completes account setup    |
| `admin.enable_user`             | Admin user enabled                       |
| `admin.disable_user`            | Admin user disabled                      |
| `admin.assign_role`             | Role assigned to admin user              |
| `admin.remove_role`             | Role removed from admin user             |
| `admin.change_password`         | Password changed                         |
| `admin.request_password_reset`  | Password reset requested                 |
| `admin.complete_password_reset` | Password reset completed                 |
| `admin.set_language`            | Preferred language changed               |
| `admin.add_approved_domain`     | Approved domain added                    |
| `admin.remove_approved_domain`  | Approved domain removed                  |
| `admin.add_tag`                 | Tag created                              |
| `admin.update_tag`              | Tag updated                              |
| `admin.upload_tag_icon`         | Tag icon uploaded                        |
| `admin.delete_tag_icon`         | Tag icon deleted                         |

#### Employer Portal

| Event Type                         | Trigger                                          |
| ---------------------------------- | ------------------------------------------------ |
| `employer.init_signup`             | Employer signup initiated                        |
| `employer.complete_signup`         | First org user completes signup                  |
| `employer.login`                   | Successful login (after TFA if enabled)          |
| `employer.login_failed`            | Failed login attempt                             |
| `employer.logout`                  | Logout                                           |
| `employer.invite_user`             | Org user invited                                 |
| `employer.complete_setup`          | Invited org user completes account setup         |
| `employer.enable_user`             | Org user enabled                                 |
| `employer.disable_user`            | Org user disabled                                |
| `employer.assign_role`             | Role assigned to org user                        |
| `employer.remove_role`             | Role removed from org user                       |
| `employer.claim_domain`            | Domain claim initiated                           |
| `employer.verify_domain`           | Domain ownership verified                        |
| `employer.change_password`         | Password changed                                 |
| `employer.request_password_reset`  | Password reset requested                         |
| `employer.complete_password_reset` | Password reset completed                         |
| `employer.set_language`            | Preferred language changed                       |
| `employer.add_cost_center`         | CostCenter created                               |
| `employer.update_cost_center`      | CostCenter updated (display_name, notes, status) |

#### Agency Portal

| Event Type                       | Trigger                                     |
| -------------------------------- | ------------------------------------------- |
| `agency.init_signup`             | Agency signup initiated                     |
| `agency.complete_signup`         | First agency user completes signup          |
| `agency.login`                   | Successful login (after TFA if enabled)     |
| `agency.login_failed`            | Failed login attempt                        |
| `agency.logout`                  | Logout                                      |
| `agency.invite_user`             | Agency user invited                         |
| `agency.complete_setup`          | Invited agency user completes account setup |
| `agency.enable_user`             | Agency user enabled                         |
| `agency.disable_user`            | Agency user disabled                        |
| `agency.assign_role`             | Role assigned to agency user                |
| `agency.remove_role`             | Role removed from agency user               |
| `agency.claim_domain`            | Domain claim initiated                      |
| `agency.verify_domain`           | Domain ownership verified                   |
| `agency.change_password`         | Password changed                            |
| `agency.request_password_reset`  | Password reset requested                    |
| `agency.complete_password_reset` | Password reset completed                    |
| `agency.set_language`            | Preferred language changed                  |

#### Hub Portal

| Event Type                    | Trigger                                 |
| ----------------------------- | --------------------------------------- |
| `hub.request_signup`          | Signup email requested                  |
| `hub.complete_signup`         | Hub user completes signup               |
| `hub.login`                   | Successful login (after TFA if enabled) |
| `hub.login_failed`            | Failed login attempt                    |
| `hub.logout`                  | Logout                                  |
| `hub.change_password`         | Password changed                        |
| `hub.request_password_reset`  | Password reset requested                |
| `hub.complete_password_reset` | Password reset completed                |
| `hub.set_language`            | Preferred language changed              |
| `hub.request_email_change`    | Email change requested                  |
| `hub.complete_email_change`   | Email change completed                  |

### Audit Log Entry Fields

| Field            | Type        | Notes                                                                                       |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `id`             | UUID        | Primary key, `gen_random_uuid()`                                                            |
| `event_type`     | varchar(64) | One of the event type strings listed above                                                  |
| `actor_user_id`  | UUID        | User who performed the action; null for unauthenticated events (init_signup, login_failed)  |
| `target_user_id` | UUID        | User affected by the action (invited/enabled/disabled user); null if not applicable         |
| `org_id`         | UUID        | Employer or agency org ID; null for admin/hub events                                        |
| `ip_address`     | inet        | Remote IP extracted from `X-Forwarded-For` header (first entry), falling back to RemoteAddr |
| `event_data`     | JSONB       | Event-specific details (see below)                                                          |
| `created_at`     | timestamptz | Set at insert time                                                                          |

**`event_data` content per event type** (only relevant fields stored; omit nulls):

- `*.invite_user`: `{ "invited_email_hash": "..." }` — SHA-256 hash, never raw email
- `*.assign_role` / `*.remove_role`: `{ "target_user_id": "...", "role_name": "..." }`
- `*.enable_user` / `*.disable_user`: `{ "target_user_id": "..." }`
- `employer.add_cost_center`: `{ "cost_center_id": "..." }`
- `employer.update_cost_center`: `{ "cost_center_id": "...", "fields_changed": ["display_name", "status"] }`
- `admin.add_tag` / `admin.update_tag`: `{ "tag_id": "..." }`
- `admin.upload_tag_icon` / `admin.delete_tag_icon`: `{ "tag_id": "...", "icon_size": "small|large" }`
- `admin.add_approved_domain` / `admin.remove_approved_domain`: `{ "domain": "..." }`
- `employer.claim_domain` / `agency.claim_domain`: `{ "domain": "..." }`
- `employer.verify_domain` / `agency.verify_domain`: `{ "domain": "..." }`
- `hub.complete_email_change`: `{ "new_email_hash": "..." }` — SHA-256 hash of new email, never raw
- All other events: `{}` (empty object)

**Privacy**: Never store raw email addresses in audit logs. Use SHA-256 hash (same algorithm as the global DB) where an email reference is needed.

### Storage

Admin portal events are stored in the **Global DB** (admin users live there).
Employer, Agency, and Hub portal events are stored in the **Regional DB** (all PII and users live there).

```dbml
// Global DB
Table admin_audit_logs {
  id             uuid        [pk, default: `gen_random_uuid()`]
  event_type     varchar(64) [not null]
  actor_user_id  uuid        [null, ref: > admin_users.id]
  target_user_id uuid        [null, ref: > admin_users.id]
  ip_address     inet        [not null]
  event_data     jsonb       [not null, default: '{}']
  created_at     timestamptz [not null, default: `now()`]

  indexes {
    (created_at, id) [name: 'admin_audit_logs_created_at_id_idx']
    actor_user_id    [name: 'admin_audit_logs_actor_user_id_idx']
    event_type       [name: 'admin_audit_logs_event_type_idx']
  }
}

// Regional DB
Table audit_logs {
  id             uuid        [pk, default: `gen_random_uuid()`]
  event_type     varchar(64) [not null]
  actor_user_id  uuid        [null]
  target_user_id uuid        [null]
  org_id         uuid        [null]
  ip_address     inet        [not null]
  event_data     jsonb       [not null, default: '{}']
  created_at     timestamptz [not null, default: `now()`]

  indexes {
    (created_at, id)         [name: 'audit_logs_created_at_id_idx']
    actor_user_id            [name: 'audit_logs_actor_user_id_idx']
    (org_id, created_at, id) [name: 'audit_logs_org_created_at_id_idx']
    event_type               [name: 'audit_logs_event_type_idx']
  }
}
```

No foreign key constraints on `audit_logs` or `admin_audit_logs` — referenced users/orgs may be deleted and audit history must be retained independently.

### APIs

| Endpoint                      | Method | Auth / Required Role                                             |
| ----------------------------- | ------ | ---------------------------------------------------------------- |
| `/admin/filter-audit-logs`    | POST   | `admin:view_audit_logs` or `admin:superadmin`                    |
| `/employer/filter-audit-logs` | POST   | `employer:view_audit_logs` or `employer:superadmin`              |
| `/agency/filter-audit-logs`   | POST   | `agency:view_audit_logs` or `agency:superadmin`                  |
| `/hub/my-audit-logs`          | POST   | Any authenticated Hub user; results always scoped to caller's ID |

#### Filter Request

Admin, Employer, and Agency portals share the same request shape:

```typescript
interface FilterAuditLogsRequest {
	event_types?: string[]; // filter to specific event types; omit = all
	actor_user_id?: string; // filter by actor (UUID); ignored on /hub/my-audit-logs
	start_time?: string; // ISO 8601; inclusive lower bound on created_at
	end_time?: string; // ISO 8601; inclusive upper bound on created_at
	pagination_key?: string; // keyset cursor: opaque string encoding (created_at, id) of last seen entry
	limit?: number; // 1–100; default 40
}
```

The hub `POST /hub/my-audit-logs` uses the same shape but ignores `actor_user_id` (always scoped to the caller).

The employer and agency endpoints are automatically scoped to the caller's `org_id` — callers cannot query other orgs' logs.

Results are sorted by `created_at DESC, id DESC` (newest first).

#### Filter Response

```typescript
interface AuditLogEntry {
	id: string;
	event_type: string;
	actor_user_id: string | null;
	target_user_id: string | null;
	org_id: string | null;
	ip_address: string;
	event_data: Record<string, unknown>;
	created_at: string; // ISO 8601
}

interface FilterAuditLogsResponse {
	audit_logs: AuditLogEntry[];
	pagination_key: string | null; // null when no more results
}
```

### Retention and Purge Background Job

Audit log entries are purged by a background job after a configurable retention period. The retention duration is read from environment variables at startup using `parseDurationOrDefault`, following the same pattern as `GlobalConfigFromEnv` / `RegionalConfigFromEnv` in `bgjobs/config.go`.

| Env Var                          | Default            | Applies to                      |
| -------------------------------- | ------------------ | ------------------------------- |
| `ADMIN_AUDIT_LOG_RETENTION`      | `17520h` (2 years) | Global DB `admin_audit_logs`    |
| `AUDIT_LOG_RETENTION`            | `17520h` (2 years) | Regional DB `audit_logs`        |
| `ADMIN_AUDIT_LOG_PURGE_INTERVAL` | `24h`              | How often purge runs (global)   |
| `AUDIT_LOG_PURGE_INTERVAL`       | `24h`              | How often purge runs (regional) |

The purge interval fields are added to `GlobalBgJobsConfig` and `RegionalBgJobsConfig` alongside the retention fields. The purge job deletes rows where `created_at < now() - retention_duration`. There is no API for manual deletion.
