package auditlogs

import (
	"fmt"
	"time"

	"vetchium-api-server.typespec/common"
)

const (
	defaultAuditLogLimit = 40
	maxAuditLogLimit     = 100
	minAuditLogLimit     = 1

	errAuditLogLimitInvalid     = "must be between 1 and 100"
	errAuditLogStartTimeInvalid = "must be a valid ISO 8601 timestamp"
	errAuditLogEndTimeInvalid   = "must be a valid ISO 8601 timestamp"
)

// AuditLogEntry is a single audit log record returned by the filter APIs.
type AuditLogEntry struct {
	ID           string                 `json:"id"`
	EventType    string                 `json:"event_type"`
	ActorUserID  *string                `json:"actor_user_id"`
	TargetUserID *string                `json:"target_user_id"`
	OrgID        *string                `json:"org_id"`
	IPAddress    string                 `json:"ip_address"`
	EventData    map[string]interface{} `json:"event_data"`
	CreatedAt    string                 `json:"created_at"`
}

// FilterAuditLogsRequest is the shared request body for all filter-audit-logs endpoints.
type FilterAuditLogsRequest struct {
	EventTypes    []string `json:"event_types,omitempty"`
	ActorUserID   *string  `json:"actor_user_id,omitempty"`
	StartTime     *string  `json:"start_time,omitempty"`
	EndTime       *string  `json:"end_time,omitempty"`
	PaginationKey *string  `json:"pagination_key,omitempty"`
	Limit         *int32   `json:"limit,omitempty"`
}

func (r FilterAuditLogsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil {
		if *r.Limit < minAuditLogLimit || *r.Limit > maxAuditLogLimit {
			errs = append(errs, common.NewValidationError("limit", fmt.Errorf(errAuditLogLimitInvalid)))
		}
	}

	if r.StartTime != nil {
		if _, err := time.Parse(time.RFC3339, *r.StartTime); err != nil {
			errs = append(errs, common.NewValidationError("start_time", fmt.Errorf(errAuditLogStartTimeInvalid)))
		}
	}

	if r.EndTime != nil {
		if _, err := time.Parse(time.RFC3339, *r.EndTime); err != nil {
			errs = append(errs, common.NewValidationError("end_time", fmt.Errorf(errAuditLogEndTimeInvalid)))
		}
	}

	return errs
}

// FilterAuditLogsResponse is the response for all filter-audit-logs endpoints.
type FilterAuditLogsResponse struct {
	AuditLogs     []AuditLogEntry `json:"audit_logs"`
	PaginationKey *string         `json:"pagination_key"`
}

// EffectiveLimit returns the limit to use for a query, applying the default if none specified.
func (r FilterAuditLogsRequest) EffectiveLimit() int32 {
	if r.Limit != nil {
		return *r.Limit
	}
	return defaultAuditLogLimit
}
