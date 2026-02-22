package agency

import (
	"errors"
	"strings"

	"vetchium-api-server.typespec/common"
)

// Token types
type AgencySessionToken string
type AgencyTFAToken string
type AgencyInvitationToken string
type DNSVerificationToken string
type AgencySignupToken string

// RBAC types (re-exported from common)
type RoleName = common.RoleName
type AssignRoleRequest = common.AssignRoleRequest
type RemoveRoleRequest = common.RemoveRoleRequest

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

// AgencyCompleteSignupRequest completes agency signup after DNS verification.
// The first user is automatically granted admin rights and assigned
// the 'agency:superadmin' role.
// All operations are atomic - either the entire signup succeeds or no data is created.
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
	SessionToken AgencySessionToken `json:"session_token"`
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

// ============================================================================
// Agency User Invitation
// ============================================================================

var (
	errRolesRequired   = errors.New("at least one role is required")
	errRoleWrongPortal = errors.New("role does not belong to the agency portal")
)

type AgencyInviteUserRequest struct {
	EmailAddress        common.EmailAddress `json:"email_address"`
	InviteEmailLanguage common.LanguageCode `json:"invite_email_language,omitempty"`
	Roles               []common.RoleName   `json:"roles"`
}

func (r AgencyInviteUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}
	if r.InviteEmailLanguage != "" {
		if err := r.InviteEmailLanguage.Validate(); err != nil {
			errs = append(errs, common.NewValidationError("invite_email_language", err))
		}
	}

	if len(r.Roles) == 0 {
		errs = append(errs, common.NewValidationError("roles", errRolesRequired))
	} else {
		for _, role := range r.Roles {
			if err := role.Validate(); err != nil {
				errs = append(errs, common.NewValidationError("roles", common.ErrRoleNameInvalid))
			} else if !strings.HasPrefix(string(role), "agency:") {
				errs = append(errs, common.NewValidationError("roles", errRoleWrongPortal))
			}
		}
	}

	return errs
}

type AgencyInviteUserResponse struct {
	InvitationID string `json:"invitation_id"`
	ExpiresAt    string `json:"expires_at"`
}

type AgencyCompleteSetupRequest struct {
	InvitationToken   AgencyInvitationToken `json:"invitation_token"`
	Password          common.Password       `json:"password"`
	FullName          common.FullName       `json:"full_name"`
	PreferredLanguage common.LanguageCode   `json:"preferred_language,omitempty"`
}

func (r AgencyCompleteSetupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InvitationToken == "" {
		errs = append(errs, common.NewValidationError("invitation_token", common.ErrRequired))
	}
	if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}
	if err := r.FullName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("full_name", err))
	}
	if r.PreferredLanguage != "" {
		if err := r.PreferredLanguage.Validate(); err != nil {
			errs = append(errs, common.NewValidationError("preferred_language", err))
		}
	}

	return errs
}

type AgencyCompleteSetupResponse struct {
	Message string `json:"message"`
}

// ============================================
// User Management (Disable/Enable)
// ============================================

type AgencyDisableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r AgencyDisableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type AgencyEnableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r AgencyEnableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

// ============================================
// Password Management
// ============================================

type AgencyPasswordResetToken = string

type AgencyRequestPasswordResetRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Domain       common.DomainName   `json:"domain"`
}

func (r AgencyRequestPasswordResetRequest) Validate() []common.ValidationError {
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

type AgencyRequestPasswordResetResponse struct {
	Message string `json:"message"`
}

type AgencyCompletePasswordResetRequest struct {
	ResetToken  AgencyPasswordResetToken `json:"reset_token"`
	NewPassword common.Password          `json:"new_password"`
}

func (r AgencyCompletePasswordResetRequest) Validate() []common.ValidationError {
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

type AgencyChangePasswordRequest struct {
	CurrentPassword common.Password `json:"current_password"`
	NewPassword     common.Password `json:"new_password"`
}

func (r AgencyChangePasswordRequest) Validate() []common.ValidationError {
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

	if r.CurrentPassword != "" && r.NewPassword != "" && r.CurrentPassword == r.NewPassword {
		errs = append(errs, common.NewValidationError("new_password", common.ErrNewPasswordSameAsCurrent))
	}

	return errs
}

// ============================================
// User Management (Filter Users)
// ============================================

type AgencyRole string

const (
	AgencyRoleViewUsers     AgencyRole = "view_users"
	AgencyRoleManageUsers   AgencyRole = "manage_users"
	AgencyRoleViewDomains   AgencyRole = "view_domains"
	AgencyRoleManageDomains AgencyRole = "manage_domains"
	AgencyRoleSuperadmin    AgencyRole = "superadmin"
)

type AgencyUser struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Name         string              `json:"name"`
	Status       string              `json:"status"`
	CreatedAt    string              `json:"created_at"`
	Roles        []AgencyRole        `json:"roles"`
}

type FilterAgencyUsersRequest struct {
	Limit        *int32  `json:"limit,omitempty"`
	Cursor       *string `json:"cursor,omitempty"`
	FilterEmail  *string `json:"filter_email,omitempty"`
	FilterName   *string `json:"filter_name,omitempty"`
	FilterStatus *string `json:"filter_status,omitempty"`
}

func (r FilterAgencyUsersRequest) Validate() []common.ValidationError {
	// Optional fields
	return nil
}

type FilterAgencyUsersResponse struct {
	Items      []AgencyUser `json:"items"`
	NextCursor string       `json:"next_cursor"`
}

// ===================================
// Language Management
// ===================================

type AgencySetLanguageRequest struct {
	Language common.LanguageCode `json:"language"`
}

func (r AgencySetLanguageRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Language == "" {
		errs = append(errs, common.NewValidationError("language", common.ErrRequired))
	} else if err := r.Language.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("language", err))
	}

	return errs
}

// ===================================
// Get Current User Info
// ===================================

type AgencyMyInfoResponse struct {
	AgencyUserID      string              `json:"agency_user_id"`
	FullName          string              `json:"full_name"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
	AgencyName        string              `json:"agency_name"`
	Roles             []string            `json:"roles"`
}
