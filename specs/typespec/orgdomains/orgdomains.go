package orgdomains

import (
	"time"

	"vetchium-api-server.typespec/common"
)

// Domain Verification Token - secret expected in DNS TXT record
type DomainVerificationToken string

// Domain verification status enum
type DomainVerificationStatus string

const (
	DomainVerificationStatusPending  DomainVerificationStatus = "PENDING"
	DomainVerificationStatusVerified DomainVerificationStatus = "VERIFIED"
	DomainVerificationStatusFailing  DomainVerificationStatus = "FAILING"
)

// Constants for domain verification
const (
	TokenExpiryDays          = 7
	VerificationIntervalDays = 60
	GracePeriodDays          = 14
	MaxConsecutiveFailures   = 3
)

// ============================================
// Domain Verification Flow
// ============================================

type ClaimDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r ClaimDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type ClaimDomainResponse struct {
	Domain            string                  `json:"domain"`
	VerificationToken DomainVerificationToken `json:"verification_token"`
	ExpiresAt         time.Time               `json:"expires_at"`
	Instructions      string                  `json:"instructions"`
}

type VerifyDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r VerifyDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type VerifyDomainResponse struct {
	Status     DomainVerificationStatus `json:"status"`
	VerifiedAt *time.Time               `json:"verified_at,omitempty"`
	Message    *string                  `json:"message,omitempty"`
}

type GetDomainStatusRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r GetDomainStatusRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type GetDomainStatusResponse struct {
	Domain            string                   `json:"domain"`
	Status            DomainVerificationStatus `json:"status"`
	VerificationToken *DomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt         *time.Time               `json:"expires_at,omitempty"`
	LastVerifiedAt    *time.Time               `json:"last_verified_at,omitempty"`
}

type ListDomainStatusRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
}

func (r ListDomainStatusRequest) Validate() []common.ValidationError {
	return nil
}

type ListDomainStatusItem struct {
	Domain            string                   `json:"domain"`
	Status            DomainVerificationStatus `json:"status"`
	VerificationToken *DomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt         *time.Time               `json:"expires_at,omitempty"`
	LastVerifiedAt    *time.Time               `json:"last_verified_at,omitempty"`
}

type ListDomainStatusResponse struct {
	Items            []ListDomainStatusItem `json:"items"`
	NextPaginationKey *string               `json:"next_pagination_key,omitempty"`
}
