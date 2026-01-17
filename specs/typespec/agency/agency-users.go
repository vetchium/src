package agency

import (
	"errors"

	"vetchium-api-server.typespec/common"
)

// Token types
type AgencySessionToken string
type AgencyTFAToken string
type DNSVerificationToken string
type AgencySignupToken string

// ============================================
// Signup Flow (DNS-based Domain Verification)
// ============================================

type AgencyInitSignupRequest struct {
	Email      common.EmailAddress `json:"email"`
	HomeRegion string              `json:"home_region"`
}

func (r AgencyInitSignupRequest) Validate() []common.ValidationError {
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

type AgencyInitSignupResponse struct {
	Domain         common.DomainName `json:"domain"`
	DNSRecordName  string            `json:"dns_record_name"`
	TokenExpiresAt string            `json:"token_expires_at"`
	Message        string            `json:"message"`
}

type AgencyGetSignupDetailsRequest struct {
	SignupToken AgencySignupToken `json:"signup_token"`
}

func (r AgencyGetSignupDetailsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SignupToken == "" {
		errs = append(errs, common.NewValidationError("signup_token", common.ErrRequired))
	}

	return errs
}

type AgencyGetSignupDetailsResponse struct {
	Domain common.DomainName `json:"domain"`
}

type AgencyCompleteSignupRequest struct {
	SignupToken       AgencySignupToken   `json:"signup_token"`
	Password          common.Password     `json:"password"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
	HasAddedDNSRecord bool                `json:"has_added_dns_record"`
	AgreesToEULA      bool                `json:"agrees_to_eula"`
}

var (
	errDNSRecordNotConfirmed = errors.New("You must confirm that you have added the DNS record")
	errEULANotAccepted       = errors.New("You must agree to the End User License Agreement")
)

func (r AgencyCompleteSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SignupToken == "" {
		errs = append(errs, common.NewValidationError("signup_token", common.ErrRequired))
	}

	if r.Password == "" {
		errs = append(errs, common.NewValidationError("password", common.ErrRequired))
	} else if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	if r.PreferredLanguage == "" {
		errs = append(errs, common.NewValidationError("preferred_language", common.ErrRequired))
	}

	if !r.HasAddedDNSRecord {
		errs = append(errs, common.NewValidationError("has_added_dns_record", errDNSRecordNotConfirmed))
	}

	if !r.AgreesToEULA {
		errs = append(errs, common.NewValidationError("agrees_to_eula", errEULANotAccepted))
	}

	return errs
}

type AgencyCompleteSignupResponse struct {
	SessionToken  AgencySessionToken `json:"session_token"`
	AgencyUserID string             `json:"agency_user_id"`
}

// ============================================
// Login Flow
// ============================================

type AgencyLoginRequest struct {
	Email    common.EmailAddress `json:"email"`
	Domain   common.DomainName   `json:"domain"`
	Password common.Password     `json:"password"`
}

func (r AgencyLoginRequest) Validate() []common.ValidationError {
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

type AgencyLoginResponse struct {
	TFAToken AgencyTFAToken `json:"tfa_token"`
}

type AgencyTFARequest struct {
	TFAToken   AgencyTFAToken `json:"tfa_token"`
	TFACode    common.TFACode `json:"tfa_code"`
	RememberMe bool           `json:"remember_me"`
}

func (r AgencyTFARequest) Validate() []common.ValidationError {
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

type AgencyTFAResponse struct {
	SessionToken      AgencySessionToken  `json:"session_token"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
	AgencyName        string              `json:"agency_name"`
}

// AgencyLogoutRequest is empty - session token passed via Authorization header
type AgencyLogoutRequest struct{}
