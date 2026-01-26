package org

import (
	"errors"

	"vetchium-api-server.typespec/common"
)

// Token types
type OrgSessionToken string
type OrgTFAToken string
type DNSVerificationToken string
type OrgSignupToken string
type OrgInvitationToken string
type OrgPasswordResetToken string

// RBAC types (re-exported from common)
type RoleName = common.RoleName
type AssignRoleRequest = common.AssignRoleRequest
type RemoveRoleRequest = common.RemoveRoleRequest

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
	Domain         common.DomainName `json:"domain"`
	DNSRecordName  string            `json:"dns_record_name"`
	TokenExpiresAt string            `json:"token_expires_at"`
	Message        string            `json:"message"`
}

type OrgGetSignupDetailsRequest struct {
	SignupToken OrgSignupToken `json:"signup_token"`
}

func (r OrgGetSignupDetailsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SignupToken == "" {
		errs = append(errs, common.NewValidationError("signup_token", common.ErrRequired))
	}

	return errs
}

type OrgGetSignupDetailsResponse struct {
	Domain common.DomainName `json:"domain"`
}

type OrgCompleteSignupRequest struct {
	SignupToken       OrgSignupToken      `json:"signup_token"`
	Password          common.Password     `json:"password"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
	HasAddedDNSRecord bool                `json:"has_added_dns_record"`
	AgreesToEULA      bool                `json:"agrees_to_eula"`
}

var (
	errDNSRecordNotConfirmed = errors.New("You must confirm that you have added the DNS record")
	errEULANotAccepted       = errors.New("You must agree to the End User License Agreement")
)

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

// ============================================
// User Invitation Flow
// ============================================

type OrgInviteUserRequest struct {
	EmailAddress      common.EmailAddress `json:"email_address"`
	FullName          common.FullName     `json:"full_name"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
}

func (r OrgInviteUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", common.ErrRequired))
	} else if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	if r.FullName == "" {
		errs = append(errs, common.NewValidationError("full_name", common.ErrRequired))
	} else if err := r.FullName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("full_name", err))
	}
	if r.PreferredLanguage != "" {
		if err := r.PreferredLanguage.Validate(); err != nil {
			errs = append(errs, common.NewValidationError("preferred_language", err))
		}
	}

	return errs
}

type OrgInviteUserResponse struct {
	InvitationID string `json:"invitation_id"`
	ExpiresAt    string `json:"expires_at"`
}

type OrgCompleteSetupRequest struct {
	InvitationToken OrgInvitationToken `json:"invitation_token"`
	Password        common.Password    `json:"password"`
	FullName        common.FullName    `json:"full_name"`
}

func (r OrgCompleteSetupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InvitationToken == "" {
		errs = append(errs, common.NewValidationError("invitation_token", common.ErrRequired))
	}

	if r.Password == "" {
		errs = append(errs, common.NewValidationError("password", common.ErrRequired))
	} else if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	if r.FullName == "" {
		errs = append(errs, common.NewValidationError("full_name", common.ErrRequired))
	} else if err := r.FullName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("full_name", err))
	}

	return errs
}

type OrgCompleteSetupResponse struct {
	Message string `json:"message"`
}

// ============================================
// User Management (Disable/Enable)
// ============================================

type OrgDisableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r OrgDisableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type OrgEnableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r OrgEnableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

// ============================================================================
// Org Password Management
// ============================================================================

type OrgRequestPasswordResetRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Domain       common.DomainName   `json:"domain"`
}

func (r OrgRequestPasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.EmailAddress == "" {
		errs = append(errs, common.NewValidationError("email_address", common.ErrRequired))
	} else if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	if r.Domain == "" {
		errs = append(errs, common.NewValidationError("domain", common.ErrRequired))
	} else if err := r.Domain.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("domain", err))
	}

	return errs
}

type OrgRequestPasswordResetResponse struct {
	Message string `json:"message"`
}

type OrgCompletePasswordResetRequest struct {
	ResetToken  OrgPasswordResetToken `json:"reset_token"`
	NewPassword common.Password       `json:"new_password"`
}

func (r OrgCompletePasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ResetToken == "" {
		errs = append(errs, common.NewValidationError("reset_token", common.ErrRequired))
	}

	if r.NewPassword == "" {
		errs = append(errs, common.NewValidationError("new_password", common.ErrRequired))
	} else if err := r.NewPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_password", err))
	}

	return errs
}

type OrgChangePasswordRequest struct {
	CurrentPassword common.Password `json:"current_password"`
	NewPassword     common.Password `json:"new_password"`
}

func (r OrgChangePasswordRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CurrentPassword == "" {
		errs = append(errs, common.NewValidationError("current_password", common.ErrRequired))
	} else if err := r.CurrentPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("current_password", err))
	}

	if r.NewPassword == "" {
		errs = append(errs, common.NewValidationError("new_password", common.ErrRequired))
	} else if err := r.NewPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_password", err))
	}

	// Check if current and new passwords are the same
	if r.CurrentPassword != "" && r.NewPassword != "" && r.CurrentPassword == r.NewPassword {
		errs = append(errs, common.NewValidationError("new_password", common.ErrNewPasswordSameAsCurrent))
	}

	return errs
}

// ============================================
// User Management (Filter Users)
// ============================================

type OrgRole string

const (
	OrgRoleInviteUsers OrgRole = "invite_users"
	OrgRoleManageUsers OrgRole = "manage_users"
)

type OrgUser struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Name         string              `json:"name"`
	Status       string              `json:"status"`
	CreatedAt    string              `json:"created_at"`
	Roles        []OrgRole           `json:"roles"`
}

type FilterOrgUsersRequest struct {
	Limit        *int32  `json:"limit,omitempty"`
	Cursor       *string `json:"cursor,omitempty"`
	FilterEmail  *string `json:"filter_email,omitempty"`
	FilterName   *string `json:"filter_name,omitempty"`
	FilterStatus *string `json:"filter_status,omitempty"`
}

func (r FilterOrgUsersRequest) Validate() []common.ValidationError {
	// Optional fields
	return nil
}

type FilterOrgUsersResponse struct {
	Items      []OrgUser `json:"items"`
	NextCursor string    `json:"next_cursor"`
}

// ===================================
// Language Management
// ===================================

type OrgSetLanguageRequest struct {
	Language common.LanguageCode `json:"language"`
}

func (r OrgSetLanguageRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Language == "" {
		errs = append(errs, common.NewValidationError("language", common.ErrRequired))
	} else if err := r.Language.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("language", err))
	}

	return errs
}
