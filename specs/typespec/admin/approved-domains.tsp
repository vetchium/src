import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Domain status
@doc("Domain status in the approved list")
enum DomainStatus {
    @doc("Domain is active and users can sign up")
    active: "active",
    @doc("Domain is disabled and users cannot sign up")
    inactive: "inactive",
}

// Filter for listing domains
@doc("Filter for listing domains")
enum DomainFilter {
    @doc("Show only active domains")
    active: "active",
    @doc("Show only inactive domains")
    inactive: "inactive",
    @doc("Show all domains (active and inactive)")
    all: "all",
}

// Audit action types - only for modifications, not reads
@doc("Audit log action types")
enum AuditAction {
    @doc("Domain was created")
    created: "created",
    @doc("Domain was disabled")
    disabled: "disabled",
    @doc("Domain was enabled")
    enabled: "enabled",
}

model AddApprovedDomainRequest {
    @doc("Domain name to add to approved list")
    domain_name: DomainName;
    @doc("Reason for adding this domain (max 256 characters)")
    @maxLength(256)
    reason: string;
}

model ListApprovedDomainsRequest {
    @doc("Optional search term for fuzzy domain search")
    search?: string;
    @doc("Filter for active/inactive/all domains (default: active)")
    filter?: DomainFilter;
    @doc("Number of items to return (default 50, max 100)")
    limit?: int32;
    @doc("Cursor from previous page - base64 encoded value")
    cursor?: string;
}

model GetApprovedDomainRequest {
    @doc("Domain name to retrieve")
    domain_name: DomainName;
}

model DisableApprovedDomainRequest {
    @doc("Domain name to disable")
    domain_name: DomainName;
    @doc("Reason for disabling (max 256 characters)")
    @maxLength(256)
    reason: string;
}

model EnableApprovedDomainRequest {
    @doc("Domain name to enable")
    domain_name: DomainName;
    @doc("Reason for enabling (max 256 characters)")
    @maxLength(256)
    reason: string;
}

model ApprovedDomain {
    @doc("Domain name in lowercase")
    domain_name: DomainName;
    @doc("Email of admin who added this domain")
    created_by_admin_email: EmailAddress;
    @doc("Current status of the domain")
    status: DomainStatus;
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
}



@route("/admin")
@tag("ApprovedDomains")
interface ApprovedDomains {
    @route("/create-approved-domain")
    @post
    @doc("Add a domain to the approved list. Domain names are normalized to lowercase. Starts as active.")
    addDomain(@body request: AddApprovedDomainRequest): {
        @statusCode statusCode: 201;
        @body response: ApprovedDomain;
    } | {
        @doc("Domain already exists")
        @statusCode
        statusCode: 409;
    } | {
        @doc("Invalid domain format or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/list-approved-domains")
    @post
    @doc("List approved domains with optional search and status filter (keyset pagination)")
    listDomains(@body request: ListApprovedDomainsRequest): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomainListResponse;
    } | {
        @doc("Invalid request parameters")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/get-approved-domain")
    @post
    @doc("Get details of a specific domain including audit logs")
    getDomain(@body request: GetApprovedDomainRequest): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomainDetailResponse;
    } | {
        @doc("Domain not found")
        @statusCode
        statusCode: 404;
    } | {
        @doc("Invalid request parameters")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/disable-approved-domain")
    @post
    @doc("Disable a domain in the approved list (prevents new signups)")
    disableDomain(@body request: DisableApprovedDomainRequest): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomain;
    } | {
        @doc("Domain not found or already inactive")
        @statusCode
        statusCode: 404;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };

    @route("/enable-approved-domain")
    @post
    @doc("Enable a previously disabled domain (allows new signups)")
    enableDomain(@body request: EnableApprovedDomainRequest): {
        @statusCode statusCode: 200;
        @body response: ApprovedDomain;
    } | {
        @doc("Domain not found or already active")
        @statusCode
        statusCode: 404;
    } | {
        @doc("Invalid request parameters or validation errors")
        @statusCode
        statusCode: 400;
    } | {
        @doc("Unauthorized - invalid or expired session")
        @statusCode
        statusCode: 401;
    };
}
