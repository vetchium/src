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

// Domain lifecycle duration constants.
// Each name encodes intent so callers never need to reason about the bare number.
const (
	// VerificationTokenTTL: how long a freshly-issued DNS TXT verification token is valid.
	VerificationTokenTTL = 7 // days

	// PeriodicReverificationCycle: interval at which the background worker re-checks all VERIFIED domains.
	PeriodicReverificationCycle = 60 // days

	// ManualVerificationCooldown: rate-limit between org-triggered manual verify attempts.
	ManualVerificationCooldown = 60 // minutes

	// FailureThreshold: consecutive DNS check failures before a VERIFIED domain transitions to FAILING.
	FailureThreshold = 3

	// PrimaryFailoverGrace: how long the primary domain may remain in FAILING state before the
	// background worker auto-promotes the next available VERIFIED domain to primary.
	PrimaryFailoverGrace = 3 // days

	// DomainReleaseCooldown: quarantine period (days) after an org unclaims a domain before
	// any other org may re-claim it. Prevents domain-squatting after ownership transfers.
	DomainReleaseCooldown = 30 // days
)

// Deprecated aliases kept for callers not yet migrated.
// Remove once all references are updated.
const (
	TokenExpiryDays             = VerificationTokenTTL
	VerificationIntervalDays    = PeriodicReverificationCycle
	MaxConsecutiveFailures      = FailureThreshold
	VerificationCooldownMinutes = ManualVerificationCooldown
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

// ClaimDomainCooldownResponse is returned (HTTP 409) when a domain is in its
// DomainReleaseCooldown quarantine period and cannot yet be re-claimed.
type ClaimDomainCooldownResponse struct {
	Error          string    `json:"error"`
	ClaimableAfter time.Time `json:"claimable_after"`
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
	IsPrimary         bool                     `json:"is_primary"`
	VerificationToken *DomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt         *time.Time               `json:"expires_at,omitempty"`
	LastVerifiedAt    *time.Time               `json:"last_verified_at,omitempty"`
	// FailingSince is set when status is FAILING; marks when the failure streak began.
	FailingSince              *time.Time `json:"failing_since,omitempty"`
	CanRequestVerification    bool       `json:"can_request_verification"`
	LastAttemptedAt           *time.Time `json:"last_attempted_at,omitempty"`
	NextVerificationAllowedAt *time.Time `json:"next_verification_allowed_at,omitempty"`
}

type ListDomainStatusRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
}

func (r ListDomainStatusRequest) Validate() []common.ValidationError {
	return nil
}

type ListDomainStatusItem struct {
	Domain                    string                   `json:"domain"`
	Status                    DomainVerificationStatus `json:"status"`
	IsPrimary                 bool                     `json:"is_primary"`
	VerificationToken         *DomainVerificationToken `json:"verification_token,omitempty"`
	ExpiresAt                 *time.Time               `json:"expires_at,omitempty"`
	LastVerifiedAt            *time.Time               `json:"last_verified_at,omitempty"`
	FailingSince              *time.Time               `json:"failing_since,omitempty"`
	CanRequestVerification    bool                     `json:"can_request_verification"`
	LastAttemptedAt           *time.Time               `json:"last_attempted_at,omitempty"`
	NextVerificationAllowedAt *time.Time               `json:"next_verification_allowed_at,omitempty"`
}

type ListDomainStatusResponse struct {
	Items             []ListDomainStatusItem `json:"items"`
	NextPaginationKey *string                `json:"next_pagination_key,omitempty"`
}

// ============================================
// Set Primary Domain
// ============================================

type SetPrimaryDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r SetPrimaryDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

// ============================================
// Delete (Unclaim) Domain
// ============================================

type DeleteDomainRequest struct {
	Domain common.DomainName `json:"domain"`
}

func (r DeleteDomainRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}
