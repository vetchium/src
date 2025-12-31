Status: COMPLETED
Authors: @psankar
Dependencies: 3-emails-sending

Note: This is not a good example of a specification. This was generated from an open-source AI and it caused more rework than needed.

## Acceptance Criteria

- Admin users can add domains to a global "Approved Domains" list
- Admin users can remove domains from the list
- Admin users can view all approved domains with fuzzy search
- Admin users can view detailed information about a specific domain including its audit history
- HubUser signup is only allowed with email addresses from approved domains
- All admin actions that modify the domain list are comprehensively logged for audit purposes
- Domain names are case-insensitive (stored and compared in lowercase)
- The feature name is "Approved Domains"

## Scope

### UI Overview

The Admin Portal home page (`/`) will display a new card alongside the logout button:

**Card Design:**

- Icon: Safety/Security icon (shield)
- Title: "Approved Domains"
- Subtitle: "Manage permitted email domains for HubUser signup"
- Action: Click to navigate to `/approved-domains`

**Approved Domains Page (`/approved-domains`):**

1. **Header Section**
   - Page title: "Approved Domains"
   - Search bar with autocomplete: "Search domains..."
   - "Add Domain" button (primary action)

2. **Domains Table**
   Columns:
   - Domain Name (sortable, clickable to view details)
   - Added On (timestamp, sortable)
   - Added By (admin ID)
   - Actions (View Details, Delete)

3. **Add Domain Modal**
   - Input field: "Enter domain (e.g., example.com)"
   - Auto-converts to lowercase on input
   - Validates domain format
   - "Add" and "Cancel" buttons

4. **Domain Details Modal** (accessed via clicking domain name)
   - Domain information card:
     - Domain name
     - Added on (timestamp)
     - Added by (admin ID/email)
     - Last updated (timestamp)
   - Audit logs table:
     - Timestamp
     - Action (Created, Deleted)
     - Admin ID
     - IP Address
     - Request ID

5. **Delete Confirmation**
   - Modal with warning message
   - "Are you sure you want to remove example.com?"
   - "Remove" and "Cancel" buttons

### Database Changes

```dbml
Table global.approved_domains {
    domain_id uuid [primary key, not null, default: gen_random_uuid()]
    domain_name varchar(255) [not null, unique]
    created_by_admin_id uuid [not null, ref: > admin_users.admin_user_id]
    created_at timestamp [not null, default: now()]
    updated_at timestamp [not null, default: now()]
    deleted_at timestamp [null]
}

Table global.approved_domains_audit_log {
    audit_id uuid [primary key, not null, default: gen_random_uuid()]
    admin_id uuid [null, ref: > admin_users.admin_user_id]
    action varchar(50) [not null]
    target_domain_id uuid [null, ref: > approved_domains.domain_id]
    target_domain_name varchar(255) [null]
    old_value jsonb [null]
    new_value jsonb [null]
    ip_address inet [null]
    user_agent text [null]
    request_id varchar(255) [null]
    created_at timestamp [not null, default: now()]
}

enum approved_domains_audit_log.action {
    created
    deleted
}

Note: No additional indexes beyond primary/foreign keys as per requirements.
Soft delete: DELETE operation sets deleted_at timestamp, does not remove row.
List/Search queries filter WHERE deleted_at IS NULL.
```

### API Changes

```typespec
import {
  AdminUUID,
  ISO8601Timestamp,
  RequestID,
  IPAddress,
  UserAgent,
} from "../common/types";

// Domain name type - lowercase, validated domain format
scalar DomainName;

// Audit action types - only for modifications, not reads
enum AuditAction {
  "created",
  "deleted",
}

// Request: Create approved domain
model CreateApprovedDomainRequest {
  domain_name: DomainName;
}

// Response: Single approved domain
model ApprovedDomain {
  domain_id: AdminUUID;
  domain_name: DomainName;
  created_by_admin_id: AdminUUID;
  created_at: ISO8601Timestamp;
  updated_at: ISO8601Timestamp;
  deleted_at: ISO8601Timestamp?;
}

// Response: List of domains with optional search filter
model ApprovedDomainListResponse {
  domains: ApprovedDomain[];
  total_count: int32;
}

// Request: Search/filter domains
model SearchApprovedDomainsRequest {
  search?: string;
  page?: int32;
  page_size?: int32;
}

// Response: Domain details with audit logs
model ApprovedDomainDetailResponse {
  domain: ApprovedDomain;
  audit_logs: ApprovedDomainAuditLog[];
}

// Response: Single audit log entry
model ApprovedDomainAuditLog {
  audit_id: AdminUUID;
  admin_id: AdminUUID;
  action: AuditAction;
  target_domain_id: AdminUUID?;
  target_domain_name: DomainName?;
  old_value: object?;
  new_value: object?;
  ip_address: IPAddress?;
  user_agent: UserAgent?;
  request_id: RequestID?;
  created_at: ISO8601Timestamp;
}

// Endpoints
@route("/api/admin/approved-domains")
@post
op createApprovedDomain: CreateApprovedDomainRequest => ApprovedDomain;

@route("/api/admin/approved-domains")
@get
op listApprovedDomains: SearchApprovedDomainsRequest => ApprovedDomainListResponse;

@route("/api/admin/approved-domains/{domain_id}")
@get
op getApprovedDomain: ApprovedDomainDetailResponse;

@route("/api/admin/approved-domains/{domain_id}")
@delete
op deleteApprovedDomain: void;

// Validation rules (implemented in typespec validation)
DomainName@pattern("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$");
DomainName@minLength(3);
DomainName@maxLength(255);
```

### Backend Implementation Notes

**SQL Queries (sqlc):**

Located in `api-server/db/queries/approved_domains.sql`:

- `CreateApprovedDomain` - Insert with admin_id
- `ListApprovedDomains` - Select WHERE deleted_at IS NULL, ordered by domain_name ASC
- `SearchApprovedDomains` - LIKE query WHERE deleted_at IS NULL with pagination
- `GetApprovedDomainByID` - Select by domain_id (includes soft-deleted)
- `GetApprovedDomainByName` - Select by domain_name WHERE deleted_at IS NULL (for duplicate check)
- `SoftDeleteApprovedDomain` - UPDATE SET deleted_at = NOW() by domain_id, returning updated row
- `CountApprovedDomains` - Total count WHERE deleted_at IS NULL
- `CreateAuditLog` - Insert audit entry
- `GetAuditLogsByDomainID` - Select logs for specific domain

**Handler Pattern:**

Each handler:

1. Validates request using TypeSpec validation
2. Extracts admin_id from session
3. Extracts request context (IP, user_agent, request_id) from headers/middleware
4. Performs business logic
5. Creates audit log entry (for create/delete only)
6. Returns response

**Audit Log Fields:**

- For "created": `new_value` contains the full domain object (without deleted_at which is null)
- For "deleted": `old_value` contains the domain before soft delete, `new_value` contains `deleted_at` timestamp
- No audit logs for read operations (list, get details)

### Frontend Implementation Notes

**Files to modify:**

- `admin-ui/src/pages/DashboardPage.tsx` - Add new card
- `admin-ui/src/pages/ApprovedDomainsPage.tsx` - New page
- `admin-ui/src/App.tsx` - Add routing
- `admin-ui/src/locales/en-US/approved-domains.json` - Translations
- `admin-ui/src/locales/de-DE/approved-domains.json` - Translations
- `admin-ui/src/locales/ta-IN/approved-domains.json` - Translations

**State Management:**

- Use React state for modal visibility, search text, selected domain
- Use Ant Design Table for domain list with sorting
- Use Ant Design Modal for add domain and domain details

**Search Implementation:**

- Debounced search input (300ms delay)
- Fuzzy matching on domain_name via search query param
- Real-time filtering as user types

### Testing Strategy

**API Tests (`playwright/tests/api/admin/approved-domains.spec.ts`):**

1. **Create Domain**
   - Successfully add a valid domain
   - Reject duplicate domain (409 Conflict)
   - Reject invalid domain format (400 Bad Request)
   - Normalize uppercase to lowercase

2. **List Domains**
   - Return empty list when no domains
   - Return all domains sorted by name
   - Search filters correctly (uses search query param)
   - Pagination works

3. **Get Domain Details**
   - Return domain + audit logs
   - Audit log includes all required fields
   - 404 for non-existent domain

4. **Delete Domain**
   - Successfully delete domain
   - Audit log captures old_value
   - 404 for non-existent domain

5. **Audit Logging**
   - Create action creates audit log with new_value
   - Delete action creates audit log with old_value
   - IP address captured
   - User agent captured
   - Request ID captured
   - No audit logs for read operations

6. **Authentication**
   - All endpoints require valid session
   - All endpoints require TFA verification

**UI Tests (`playwright/tests/ui/admin/approved-domains.spec.ts`):**

1. **Dashboard Card**
   - Card is visible
   - Click navigates to /approved-domains

2. **List Page**
   - Domains display correctly
   - Search filters list (calls API with search param)
   - Add button opens modal
   - Delete shows confirmation

3. **Add Domain**
   - Valid domain adds successfully
   - Duplicate shows error message
   - Invalid format shows validation error

4. **Domain Details**
   - Clicking domain opens details modal
   - Audit logs display for create/delete actions only
   - All metadata visible

### HubUser Signup Integration

When HubUser signup is implemented (future work), add validation:

1. Extract domain from email address (after @)
2. Query `approved_domains` table in global DB
3. Return 403 Forbidden if domain not approved
4. Proceed with signup if approved

### Localization Keys

**English (`en-US/approved-domains.json`):**

```json
{
	"title": "Approved Domains",
	"addDomain": "Add Domain",
	"addSuccess": "Domain added successfully",
	"addError": "Failed to add domain",
	"deleteSuccess": "Domain removed successfully",
	"deleteError": "Failed to remove domain",
	"deleteConfirm": "Are you sure you want to remove this domain?",
	"fetchError": "Failed to fetch domains",
	"detailsError": "Failed to fetch domain details",
	"domainName": "Domain",
	"createdAt": "Added On",
	"createdBy": "Added By",
	"updatedAt": "Last Updated",
	"actions": "Actions",
	"searchPlaceholder": "Search domains...",
	"domainPlaceholder": "example.com",
	"domainDetails": "Domain Details",
	"domainInfo": "Domain Information",
	"auditLogs": "Audit Logs",
	"auditAction": "Action",
	"auditAdmin": "Admin",
	"auditTimestamp": "Timestamp",
	"auditIpAddress": "IP Address",
	"noDomains": "No approved domains found",
	"domainExists": "This domain is already approved",
	"invalidDomain": "Invalid domain format",
	"dashboardTitle": "Approved Domains",
	"dashboardDescription": "Manage permitted email domains for HubUser signup"
}
```
