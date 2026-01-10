package org

import (
	"time"

	"vetchium-api-server.typespec/common"
)

// Token types
type OrgSignupToken string
type OrgSessionToken string
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
// Signup Flow
// ============================================

type OrgInitSignupRequest struct {
	Email common.EmailAddress `json:"email"`
}

func (r OrgInitSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Email == "" {
		errs = append(errs, common.NewValidationError("email", common.ErrRequired))
	} else if err := r.Email.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email", err))
	}

	return errs
}

type OrgInitSignupResponse struct {
	Message string `json:"message"`
}

type OrgCompleteSignupRequest struct {
	SignupToken OrgSignupToken  `json:"signup_token"`
	Password    common.Password `json:"password"`
}

func (r OrgCompleteSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SignupToken == "" {
		errs = append(errs, common.NewValidationError("signup_token", common.ErrRequired))
	}

	if r.Password == "" {
		errs = append(errs, common.NewValidationError("password", common.ErrRequired))
	} else if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	return errs
}

type OrgCompleteSignupResponse struct {
	SessionToken OrgSessionToken `json:"session_token"`
	OrgUserID    string          `json:"org_user_id"`
}

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
