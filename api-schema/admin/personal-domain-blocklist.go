package admin

import (
	"errors"
	"strings"

	"vetchium-api-server.typespec/common"
)

type BlockedPersonalDomain struct {
	Domain    string `json:"domain"`
	CreatedAt string `json:"created_at"`
}

type AdminAddBlockedDomainRequest struct {
	Domain string `json:"domain"`
}

type AdminRemoveBlockedDomainRequest struct {
	Domain string `json:"domain"`
}

type AdminListBlockedDomainsRequest struct {
	FilterDomainPrefix *string `json:"filter_domain_prefix,omitempty"`
	PaginationKey      *string `json:"pagination_key,omitempty"`
	Limit              *int32  `json:"limit,omitempty"`
}

type AdminListBlockedDomainsResponse struct {
	Domains           []BlockedPersonalDomain `json:"domains"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

var (
	ErrBlocklistDomainRequired = errors.New("domain is required")
	ErrBlocklistDomainTooLong  = errors.New("domain must be at most 253 characters")
	ErrBlocklistDomainHasAt    = errors.New("domain must not contain @")
)

func (r AdminAddBlockedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	domain := strings.TrimSpace(r.Domain)
	if domain == "" {
		errs = append(errs, common.NewValidationError("domain", ErrBlocklistDomainRequired))
	} else if len(domain) > 253 {
		errs = append(errs, common.NewValidationError("domain", ErrBlocklistDomainTooLong))
	} else if strings.Contains(domain, "@") {
		errs = append(errs, common.NewValidationError("domain", ErrBlocklistDomainHasAt))
	}
	return errs
}

func (r AdminRemoveBlockedDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if strings.TrimSpace(r.Domain) == "" {
		errs = append(errs, common.NewValidationError("domain", ErrBlocklistDomainRequired))
	}
	return errs
}

func (r AdminListBlockedDomainsRequest) Validate() []common.ValidationError {
	return nil
}
