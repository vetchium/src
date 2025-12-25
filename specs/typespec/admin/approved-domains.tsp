import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Audit action types - only for modifications, not reads
@doc("Audit log action types")
enum AuditAction {
    @doc("Domain was created")
    created: "created",
    @doc("Domain was deleted (soft delete)")
    deleted: "deleted",
}

model CreateApprovedDomainRequest {
    @doc("Domain name to add to approved list")
    domain_name: DomainName;
}

model ApprovedDomain {
    @doc("Domain name in lowercase")
    domain_name: DomainName;
    @doc("Email of admin who added this domain")
    created_by_admin_email: EmailAddress;
    @doc("ISO 8601 timestamp when domain was added")
    created_at: string;
    @doc("ISO 8601 timestamp when domain was last updated")
    updated_at: string;
}

model ApprovedDomainListResponse {
    @doc("List of approved domains")
    domains: ApprovedDomain[];
    @doc("Cursor for next page - base64 encoded last domain_name (empty if no more pages)")
    next_cursor: string;
    @doc("Whether there are more pages available")
    has_more: boolean;
}

model ApprovedDomainDetailResponse {
    @doc("Domain details")
    domain: ApprovedDomain;
    @doc("Audit logs for this domain")
    audit_logs: ApprovedDomainAuditLog[];
    @doc("Cursor for next page of audit logs - base64 encoded timestamp (empty if no more pages)")
    next_audit_cursor: string;
    @doc("Whether there are more audit log pages available")
    has_more_audit: boolean;
}

model ApprovedDomainAuditLog {
    @doc("Email of admin who performed the action")
    admin_email: EmailAddress;
    @doc("Action performed")
    action: AuditAction;
    @doc("Name of affected domain")
    target_domain_name?: DomainName;
    @doc("Previous state before modification")
    old_value?: object;
    @doc("New state after modification")
    new_value?: object;
    @doc("IP address of the request")
    ip_address?: string;
    @doc("User agent of the request")
    user_agent?: string;
    @doc("Request ID for tracing")
    request_id?: string;
    @doc("ISO 8601 timestamp of the audit entry")
    created_at: string;
}

model AuditLogsResponse {
    @doc("List of audit log entries")
    logs: ApprovedDomainAuditLog[];
    @doc("Cursor for next page - base64 encoded timestamp (empty if no more pages)")
    next_cursor: string;
    @doc("Whether there are more pages available")
    has_more: boolean;
}

@route("/admin/approved-domains")
@tag("ApprovedDomains")
@authentication(Authorization)
interface ApprovedDomains {
    @route("/")
    @post
    @doc("Add a domain to the approved list. Domain names are normalized to lowercase.")
    createDomain(@body request: CreateApprovedDomainRequest): {
        @statusCode statusCode: 201;
        @body response: ApprovedDomain;
    } | {
        @doc("Domain already exists")
        @statusCode
        statusCode: 409;
    } | {
        @doc("Invalid domain format")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/")
    @get
    @doc("List all approved domains with optional search (keyset pagination)")
    listDomains(
        @doc("Optional search term for fuzzy domain search")
        @query search?: string,
        @doc("Number of items to return (default 50, max 100)")
        @query limit?: int32,
        @doc("Cursor from previous page - base64 encoded value")
        @query cursor?: string,
    ): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomainListResponse;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/{domain_name}")
    @get
    @doc("Get details of a specific domain including audit logs")
    getDomain(
        @path domain_name: DomainName,
        @doc("Cursor for audit log pagination - base64 encoded timestamp")
        @query audit_cursor?: string,
        @doc("Number of audit logs to return (default 50, max 100)")
        @query audit_limit?: int32,
    ): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomainDetailResponse;
    } | {
        @doc("Domain not found")
        @statusCode
        statusCode: 404;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/{domain_name}")
    @delete
    @doc("Remove a domain from the approved list (soft delete)")
    deleteDomain(@path domain_name: DomainName): {
        @statusCode statusCode: 204;
    } | {
        @doc("Domain not found")
        @statusCode
        statusCode: 404;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };
}

@route("/admin/approved-domains/audit")
@tag("ApprovedDomains")
@authentication(Authorization)
interface ApprovedDomainsAudit {
    @route("/")
    @get
    @doc("Get all audit logs for approved domains (keyset pagination)")
    getAuditLogs(
        @doc("Number of items to return (default 50, max 100)")
        @query limit?: int32,
        @doc("Cursor from previous page - base64 encoded timestamp")
        @query cursor?: string,
    ): {
        @statusCode statusCode: 200;
        @body response: AuditLogsResponse;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };
}
