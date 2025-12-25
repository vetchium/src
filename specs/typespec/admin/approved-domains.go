package admin

import (
	"vetchium-api-server.typespec/common"
)

type AuditAction string

const (
	AuditActionCreated AuditAction = "created"
	AuditActionDeleted AuditAction = "deleted"
)

type CreateApprovedDomainRequest struct {
	DomainName common.DomainName `json:"domain_name"`
}

func (r CreateApprovedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DomainName == "" {
		errs = append(errs, common.NewValidationError("domain_name", common.ErrRequired))
	} else if err := r.DomainName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain_name", err))
	}

	return errs
}

type ApprovedDomain struct {
	DomainName         common.DomainName `json:"domain_name"`
	CreatedByAdminEmail common.EmailAddress `json:"created_by_admin_email"`
	CreatedAt          string            `json:"created_at"`
	UpdatedAt          string            `json:"updated_at"`
}

type ApprovedDomainListResponse struct {
	Domains    []ApprovedDomain `json:"domains"`
	NextCursor string           `json:"next_cursor"`
	HasMore    bool             `json:"has_more"`
}

type ApprovedDomainDetailResponse struct {
	Domain           ApprovedDomain         `json:"domain"`
	AuditLogs        []ApprovedDomainAuditLog `json:"audit_logs"`
	NextAuditCursor  string                 `json:"next_audit_cursor"`
	HasMoreAudit     bool                   `json:"has_more_audit"`
}

type ApprovedDomainAuditLog struct {
	AdminEmail       common.EmailAddress `json:"admin_email"`
	Action           AuditAction        `json:"action"`
	TargetDomainName *common.DomainName `json:"target_domain_name,omitempty"`
	OldValue         map[string]interface{} `json:"old_value,omitempty"`
	NewValue         map[string]interface{} `json:"new_value,omitempty"`
	IpAddress        *string            `json:"ip_address,omitempty"`
	UserAgent        *string            `json:"user_agent,omitempty"`
	RequestID        *string            `json:"request_id,omitempty"`
	CreatedAt        string             `json:"created_at"`
}

type AuditLogsResponse struct {
	Logs       []ApprovedDomainAuditLog `json:"logs"`
	NextCursor string                   `json:"next_cursor"`
	HasMore    bool                     `json:"has_more"`
}
