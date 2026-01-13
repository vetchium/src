package org

import (
	"vetchium-api-server.typespec/common"
)

// Token types
type OrgSessionToken string
type OrgTFAToken string
type DNSVerificationToken string

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

type OrgInitSignupRequest struct {
	Email      common.EmailAddress `json:"email"`
	HomeRegion string              `json:"home_region"`
}

func (r OrgInitSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Email == "" {
		errs = append(errs, common.NewValidationError("email", common.ErrRequired))
	} else if err := common.ValidateEmployerEmail(r.Email); err != nil {
		// Use employer email validation which blocks personal email domains
		errs = append(errs, common.NewValidationError("email", err))
	}

	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", common.ErrRequired))
	}

	return errs
}

type OrgInitSignupResponse struct {
	Domain         common.DomainName    `json:"domain"`
	DNSRecordName  string               `json:"dns_record_name"`
	DNSRecordValue DNSVerificationToken `json:"dns_record_value"`
	TokenExpiresAt string               `json:"token_expires_at"`
	Message        string               `json:"message"`
}

type OrgCompleteSignupRequest struct {
	Email    common.EmailAddress `json:"email"`
	Password common.Password     `json:"password"`
}

func (r OrgCompleteSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Email == "" {
		errs = append(errs, common.NewValidationError("email", common.ErrRequired))
	} else if err := common.ValidateEmployerEmail(r.Email); err != nil {
		// Use employer email validation which blocks personal email domains
		errs = append(errs, common.NewValidationError("email", err))
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
// Login Flow
// ============================================

type OrgLoginRequest struct {
	Email    common.EmailAddress `json:"email"`
	Domain   common.DomainName   `json:"domain"`
	Password common.Password     `json:"password"`
}

func (r OrgLoginRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Email == "" {
		errs = append(errs, common.NewValidationError("email", common.ErrRequired))
	} else if err := r.Email.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email", err))
	}

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	if r.Password == "" {
		errs = append(errs, common.NewValidationError("password", common.ErrRequired))
	} else if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	return errs
}

type OrgLoginResponse struct {
	TFAToken OrgTFAToken `json:"tfa_token"`
}

type OrgTFARequest struct {
	TFAToken   OrgTFAToken    `json:"tfa_token"`
	TFACode    common.TFACode `json:"tfa_code"`
	RememberMe bool           `json:"remember_me"`
}

func (r OrgTFARequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.TFAToken == "" {
		errs = append(errs, common.NewValidationError("tfa_token", common.ErrRequired))
	}

	if r.TFACode == "" {
		errs = append(errs, common.NewValidationError("tfa_code", common.ErrRequired))
	} else if err := r.TFACode.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("tfa_code", err))
	}

	return errs
}

type OrgTFAResponse struct {
	SessionToken      OrgSessionToken     `json:"session_token"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
	EmployerName      string              `json:"employer_name"`
}

// OrgLogoutRequest is empty - session token passed via Authorization header
type OrgLogoutRequest struct{}
