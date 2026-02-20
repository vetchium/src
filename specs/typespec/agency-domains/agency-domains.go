package agencydomains

import (
	"time"

	"vetchium-api-server.typespec/common"
)

// AgencyDomainVerificationToken - secret expected in DNS TXT record
type AgencyDomainVerificationToken string

// AgencyDomainVerificationStatus enum
type AgencyDomainVerificationStatus string

const (
	AgencyDomainVerificationStatusPending  AgencyDomainVerificationStatus = "PENDING"
	AgencyDomainVerificationStatusVerified AgencyDomainVerificationStatus = "VERIFIED"
	AgencyDomainVerificationStatusFailing  AgencyDomainVerificationStatus = "FAILING"
)

// Constants for agency domain verification
const (
	AgencyTokenExpiryDays             = 7
	AgencyVerificationIntervalDays    = 60
	AgencyGracePeriodDays             = 14
	AgencyMaxConsecutiveFailures      = 3
	AgencyVerificationCooldownMinutes = 60 // Rate limit: 1 hour between verification requests
)

// ============================================
// Agency Domain Verification Flow
// ============================================

type AgencyClaimDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r AgencyClaimDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type AgencyClaimDomainResponse struct {
	Domain            string                        `json:"domain"`
	VerificationToken AgencyDomainVerificationToken `json:"verification_token"`
	ExpiresAt         time.Time                     `json:"expires_at"`
	Instructions      string                        `json:"instructions"`
}

type AgencyVerifyDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r AgencyVerifyDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type AgencyVerifyDomainResponse struct {
	Status     AgencyDomainVerificationStatus `json:"status"`
	VerifiedAt *time.Time                     `json:"verified_at,omitempty"`
	Message    *string                        `json:"message,omitempty"`
}

type AgencyGetDomainStatusRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r AgencyGetDomainStatusRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type AgencyGetDomainStatusResponse struct {
	Domain                    string                         `json:"domain"`
	Status                    AgencyDomainVerificationStatus `json:"status"`
	VerificationToken         *AgencyDomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt                 *time.Time                     `json:"expires_at,omitempty"`
	LastVerifiedAt            *time.Time                     `json:"last_verified_at,omitempty"`
	CanRequestVerification    bool                           `json:"can_request_verification"`
	LastAttemptedAt           *time.Time                     `json:"last_attempted_at,omitempty"`
	NextVerificationAllowedAt *time.Time                     `json:"next_verification_allowed_at,omitempty"`
}

type AgencyListDomainStatusRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
}

func (r AgencyListDomainStatusRequest) Validate() []common.ValidationError {
	return nil
}

type AgencyListDomainStatusItem struct {
	Domain                    string                         `json:"domain"`
	Status                    AgencyDomainVerificationStatus `json:"status"`
	VerificationToken         *AgencyDomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt                 *time.Time                     `json:"expires_at,omitempty"`
	LastVerifiedAt            *time.Time                     `json:"last_verified_at,omitempty"`
	CanRequestVerification    bool                           `json:"can_request_verification"`
	LastAttemptedAt           *time.Time                     `json:"last_attempted_at,omitempty"`
	NextVerificationAllowedAt *time.Time                     `json:"next_verification_allowed_at,omitempty"`
}

type AgencyListDomainStatusResponse struct {
	Items             []AgencyListDomainStatusItem `json:"items"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}
