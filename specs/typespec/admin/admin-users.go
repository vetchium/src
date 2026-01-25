package admin

import (
	"vetchium-api-server.typespec/common"
)

type AdminTFAToken string
type AdminSessionToken string
type AdminInvitationToken string
type AdminPasswordResetToken string

// RBAC types (re-exported from common)
type RoleName = common.RoleName
type AssignRoleRequest = common.AssignRoleRequest
type RemoveRoleRequest = common.RemoveRoleRequest

type AdminLoginRequest struct {
	EmailAddress common.EmailAddress `json:"email"`
	Password     common.Password     `json:"password"`
}

func (r AdminLoginRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email", err))
	}
	if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	return errs
}

type AdminLoginResponse struct {
	TFAToken AdminTFAToken `json:"tfa_token"`
}

type AdminTFARequest struct {
	TFAToken AdminTFAToken  `json:"tfa_token"`
	TFACode  common.TFACode `json:"tfa_code"`
}

func (r AdminTFARequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.TFAToken == "" {
		errs = append(errs, common.NewValidationError("tfa_token", common.ErrRequired))
	}
	if err := r.TFACode.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("tfa_code", err))
	}

	return errs
}

type AdminTFAResponse struct {
	SessionToken      AdminSessionToken   `json:"session_token"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
}

type AdminLogoutRequest struct {
	// Empty struct - session token passed in Authorization header
}

func (r AdminLogoutRequest) Validate() []common.ValidationError {
	// No fields to validate
	return nil
}

type AdminSetLanguageRequest struct {
	Language common.LanguageCode `json:"language"`
}

func (r AdminSetLanguageRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Language == "" {
		errs = append(errs, common.NewValidationError("language", common.ErrRequired))
	} else if err := r.Language.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("language", err))
	}

	return errs
}

// ============================================================================
// Admin User Invitation
// ============================================================================

type AdminInviteUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	FullName     common.FullName     `json:"full_name"`
}

func (r AdminInviteUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}
	if err := r.FullName.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("full_name", err))
	}

	return errs
}

type AdminInviteUserResponse struct {
	InvitationID string `json:"invitation_id"`
	ExpiresAt    string `json:"expires_at"`
}

type AdminCompleteSetupRequest struct {
	InvitationToken AdminInvitationToken `json:"invitation_token"`
	Password        common.Password      `json:"password"`
	FullName        common.FullName      `json:"full_name"`
}

func (r AdminCompleteSetupRequest) Validate() []common.ValidationError {
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

	return errs
}

type AdminCompleteSetupResponse struct {
	Message string `json:"message"`
}

// ============================================
// User Management (Disable/Enable)
// ============================================

type AdminDisableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r AdminDisableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type AdminEnableUserRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r AdminEnableUserRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

// ============================================
// Password Management
// ============================================

type AdminRequestPasswordResetRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r AdminRequestPasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type AdminRequestPasswordResetResponse struct {
	Message string `json:"message"`
}

type AdminCompletePasswordResetRequest struct {
	ResetToken  AdminPasswordResetToken `json:"reset_token"`
	NewPassword common.Password         `json:"new_password"`
}

func (r AdminCompletePasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ResetToken == "" {
		errs = append(errs, common.NewValidationError("reset_token", common.ErrRequired))
	}
	if err := r.NewPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_password", err))
	}

	return errs
}

type AdminChangePasswordRequest struct {
	CurrentPassword common.Password `json:"current_password"`
	NewPassword     common.Password `json:"new_password"`
}

func (r AdminChangePasswordRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.CurrentPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("current_password", err))
	}
	if err := r.NewPassword.Validate(); err != nil {
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

type AdminUser struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Name         string              `json:"name"`
	Status       string              `json:"status"`
	CreatedAt    string              `json:"created_at"`
}

type FilterAdminUsersRequest struct {
	Limit        *int32  `json:"limit,omitempty"`
	Cursor       *string `json:"cursor,omitempty"`
	FilterEmail  *string `json:"filter_email,omitempty"`
	FilterName   *string `json:"filter_name,omitempty"`
	FilterStatus *string `json:"filter_status,omitempty"`
}

func (r FilterAdminUsersRequest) Validate() []common.ValidationError {
	return nil
}

type FilterAdminUsersResponse struct {
	Items      []AdminUser `json:"items"`
	NextCursor string      `json:"next_cursor"`
}
