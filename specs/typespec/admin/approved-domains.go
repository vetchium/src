package admin

import (
	"fmt"

	"vetchium-api-server.typespec/common"
)

type DomainStatus string

const (
	DomainStatusActive   DomainStatus = "active"
	DomainStatusInactive DomainStatus = "inactive"
)

type DomainFilter string

const (
	DomainFilterActive   DomainFilter = "active"
	DomainFilterInactive DomainFilter = "inactive"
	DomainFilterAll      DomainFilter = "all"
)

type AuditAction string

const (
	AuditActionCreated  AuditAction = "created"
	AuditActionDisabled AuditAction = "disabled"
	AuditActionEnabled  AuditAction = "enabled"
)

const (
	errReasonRequired = "Reason is required"
	errReasonTooLong  = "Reason must be 256 characters or less"
	errInvalidFilter  = "Filter must be 'active', 'inactive', or 'all'"
)

type AddApprovedDomainRequest struct {
	DomainName common.DomainName `json:"domain_name"`
}

func (r AddApprovedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DomainName == "" {
		errs = append(errs, common.NewValidationError("domain_name", common.ErrRequired))
	} else if err := r.DomainName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain_name", err))
	}

	return errs
}

type ListApprovedDomainsRequest struct {
	Search *string       `json:"search,omitempty"`
	Filter *DomainFilter `json:"filter,omitempty"`
	Limit  *int32        `json:"limit,omitempty"`
	Cursor *string       `json:"cursor,omitempty"`
}

func (r ListApprovedDomainsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Filter != nil {
		filter := *r.Filter
		if filter != DomainFilterActive && filter != DomainFilterInactive && filter != DomainFilterAll {
			errs = append(errs, common.NewValidationError("filter", fmt.Errorf(errInvalidFilter)))
		}
	}

	if r.Limit != nil {
		if *r.Limit <= 0 {
			errs = append(errs, common.NewValidationError("limit", fmt.Errorf("Limit must be a positive number")))
		} else if *r.Limit > 100 {
			errs = append(errs, common.NewValidationError("limit", fmt.Errorf("Limit cannot exceed 100")))
		}
	}

	return errs
}

type GetApprovedDomainRequest struct {
	DomainName  common.DomainName `json:"domain_name"`
	AuditCursor *string           `json:"audit_cursor,omitempty"`
	AuditLimit  *int32            `json:"audit_limit,omitempty"`
}

func (r GetApprovedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DomainName == "" {
		errs = append(errs, common.NewValidationError("domain_name", common.ErrRequired))
	} else if err := r.DomainName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain_name", err))
	}

	if r.AuditLimit != nil {
		if *r.AuditLimit <= 0 {
			errs = append(errs, common.NewValidationError("audit_limit", fmt.Errorf("Audit limit must be a positive number")))
		} else if *r.AuditLimit > 100 {
			errs = append(errs, common.NewValidationError("audit_limit", fmt.Errorf("Audit limit cannot exceed 100")))
		}
	}

	return errs
}

type DisableApprovedDomainRequest struct {
	DomainName common.DomainName `json:"domain_name"`
	Reason     string            `json:"reason"`
}

func (r DisableApprovedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DomainName == "" {
		errs = append(errs, common.NewValidationError("domain_name", common.ErrRequired))
	} else if err := r.DomainName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain_name", err))
	}

	if r.Reason == "" {
		errs = append(errs, common.NewValidationError("reason", fmt.Errorf(errReasonRequired)))
	} else if len(r.Reason) > 256 {
		errs = append(errs, common.NewValidationError("reason", fmt.Errorf(errReasonTooLong)))
	}

	return errs
}

type EnableApprovedDomainRequest struct {
	DomainName common.DomainName `json:"domain_name"`
	Reason     string            `json:"reason"`
}

func (r EnableApprovedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.DomainName == "" {
		errs = append(errs, common.NewValidationError("domain_name", common.ErrRequired))
	} else if err := r.DomainName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain_name", err))
	}

	if r.Reason == "" {
		errs = append(errs, common.NewValidationError("reason", fmt.Errorf(errReasonRequired)))
	} else if len(r.Reason) > 256 {
		errs = append(errs, common.NewValidationError("reason", fmt.Errorf(errReasonTooLong)))
	}

	return errs
}

type ApprovedDomain struct {
	DomainName          common.DomainName   `json:"domain_name"`
	CreatedByAdminEmail common.EmailAddress `json:"created_by_admin_email"`
	Status              DomainStatus        `json:"status"`
	CreatedAt           string              `json:"created_at"`
	UpdatedAt           string              `json:"updated_at"`
}

type ApprovedDomainListResponse struct {
	Domains    []ApprovedDomain `json:"domains"`
	NextCursor string           `json:"next_cursor"`
	HasMore    bool             `json:"has_more"`
}

type ApprovedDomainDetailResponse struct {
	Domain          ApprovedDomain           `json:"domain"`
	AuditLogs       []ApprovedDomainAuditLog `json:"audit_logs"`
	NextAuditCursor string                   `json:"next_audit_cursor"`
	HasMoreAudit    bool                     `json:"has_more_audit"`
}

type ApprovedDomainAuditLog struct {
	AdminEmail       common.EmailAddress    `json:"admin_email"`
	Action           AuditAction            `json:"action"`
	TargetDomainName *common.DomainName     `json:"target_domain_name,omitempty"`
	Reason           *string                `json:"reason,omitempty"`
	OldValue         map[string]interface{} `json:"old_value,omitempty"`
	NewValue         map[string]interface{} `json:"new_value,omitempty"`
	IpAddress        *string                `json:"ip_address,omitempty"`
	UserAgent        *string                `json:"user_agent,omitempty"`
	RequestID        *string                `json:"request_id,omitempty"`
	CreatedAt        string                 `json:"created_at"`
}
