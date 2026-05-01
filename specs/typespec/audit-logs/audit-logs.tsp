import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// ============================================
// Audit Logs
// ============================================

@doc("A single audit log entry returned by the filter APIs.")
model AuditLogEntry {
  @doc("Event type string, e.g. 'admin.invite_user'")
  event_type: string;

  @doc("Email of the user who performed the action; null for unauthenticated events (init_signup, login_failed)")
  actor_email: string | null;

  @doc("Email of the user affected by the action; null if not applicable")
  target_email: string | null;

  @doc("Remote IP extracted from X-Forwarded-For header (first entry), falling back to RemoteAddr")
  ip_address: string;

  @doc("Event-specific details as a JSON object. Never contains raw email addresses; uses SHA-256 hashes.")
  event_data: Record<unknown>;

  @doc("Timestamp of the event in ISO 8601 / RFC 3339 format")
  created_at: string;
}

@doc("Shared request body for all filter-audit-logs endpoints.")
model FilterAuditLogsRequest {
  @doc("Filter to specific event types; omit to return all event types")
  event_types?: string[];

  @doc("Filter by actor email; ignored on /hub/my-audit-logs (always scoped to caller)")
  actor_email?: string;

  @doc("ISO 8601 inclusive lower bound on created_at")
  start_time?: string;

  @doc("ISO 8601 inclusive upper bound on created_at")
  end_time?: string;

  @doc("Keyset cursor encoding (created_at, id) of the last seen entry from a previous page")
  pagination_key?: string;

  @doc("Page size between 1 and 100; defaults to 40")
  limit?: int32;
}

@doc("Response for all filter-audit-logs endpoints.")
model FilterAuditLogsResponse {
  @doc("Audit log entries for the current page, sorted by created_at DESC, id DESC")
  audit_logs: AuditLogEntry[];

  @doc("Cursor for the next page; null when there are no more results")
  pagination_key: string | null;
}

// ============================================
// Admin Audit Log Endpoint
// ============================================

@route("/admin/list-audit-logs")
interface AdminListAuditLogsOps {
  @doc("Filter admin portal audit logs. Requires admin:view_audit_logs or admin:superadmin role.")
  @post
  filterAdminAuditLogs(@body request: FilterAuditLogsRequest): FilterAuditLogsResponse | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  } | {
    @statusCode statusCode: 403;
  };
}

// ============================================
// Hub Audit Log Endpoint
// ============================================

@route("/hub/list-audit-logs")
interface HubListAuditLogsOps {
  @doc("Retrieve the calling hub user's own audit log entries. No special role required; results are always scoped to the authenticated user. The actor_user_id filter field is ignored.")
  @post
  hubMyAuditLogs(@body request: FilterAuditLogsRequest): FilterAuditLogsResponse | {
    @statusCode statusCode: 400;
    @body errors: ValidationError[];
  } | {
    @statusCode statusCode: 401;
  };
}
