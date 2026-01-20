package hub

import (
	"errors"
	"fmt"
	"regexp"

	"vetchium-api-server.typespec/common"
)

// Type aliases
type HubSignupToken string
type HubTFAToken string
type HubSessionToken string
type DisplayName string
type CountryCode string
type Handle string

// Constants
const (
	DisplayNameMinLength = 1
	DisplayNameMaxLength = 100
	CountryCodeLength    = 2
	HandleMinLength      = 3
	HandleMaxLength      = 50
)

// Validation errors
var (
	ErrDisplayNameTooShort = errors.New("must be at least 1 character")
	ErrDisplayNameTooLong  = errors.New("must be at most 100 characters")
	ErrCountryCodeInvalid  = errors.New("must be 2 uppercase letters")
	ErrHandleInvalidFormat = errors.New("must contain only lowercase letters, numbers, and hyphens")
	countryCodePattern     = regexp.MustCompile(`^[A-Z]{2}$`)
	handlePattern          = regexp.MustCompile(`^[a-z0-9-]+$`)
)

// Validation functions
func ValidateDisplayName(name DisplayName) error {
	if len(name) < DisplayNameMinLength {
		return ErrDisplayNameTooShort
	}
	if len(name) > DisplayNameMaxLength {
		return ErrDisplayNameTooLong
	}
	return nil
}

func ValidateCountryCode(code CountryCode) error {
	if len(code) != CountryCodeLength {
		return ErrCountryCodeInvalid
	}
	if !countryCodePattern.MatchString(string(code)) {
		return ErrCountryCodeInvalid
	}
	return nil
}

func ValidateHandle(handle Handle) error {
	if len(handle) < HandleMinLength || len(handle) > HandleMaxLength {
		return ErrHandleInvalidFormat
	}
	if !handlePattern.MatchString(string(handle)) {
		return ErrHandleInvalidFormat
	}
	return nil
}

// Structs
type DisplayNameEntry struct {
	LanguageCode string      `json:"language_code"`
	DisplayName  DisplayName `json:"display_name"`
	IsPreferred  bool        `json:"is_preferred"`
}

type RequestSignupRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r RequestSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type RequestSignupResponse struct {
	Message string `json:"message"`
}

type CompleteSignupRequest struct {
	SignupToken          HubSignupToken     `json:"signup_token"`
	Password             common.Password    `json:"password"`
	PreferredDisplayName DisplayName        `json:"preferred_display_name"`
	OtherDisplayNames    []DisplayNameEntry `json:"other_display_names,omitempty"`
	HomeRegion           string             `json:"home_region"`
	PreferredLanguage    string             `json:"preferred_language"`
	ResidentCountryCode  CountryCode        `json:"resident_country_code"`
}

func (r CompleteSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SignupToken == "" {
		errs = append(errs, common.NewValidationError("signup_token", common.ErrRequired))
	}

	if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	if err := ValidateDisplayName(r.PreferredDisplayName); err != nil {
		errs = append(errs, common.NewValidationError("preferred_display_name", err))
	}

	for idx, entry := range r.OtherDisplayNames {
		if entry.LanguageCode == "" {
			errs = append(errs, common.NewValidationError(
				fmt.Sprintf("other_display_names[%d].language_code", idx),
				common.ErrRequired,
			))
		}

		if err := ValidateDisplayName(entry.DisplayName); err != nil {
			errs = append(errs, common.NewValidationError(
				fmt.Sprintf("other_display_names[%d].display_name", idx),
				err,
			))
		}
	}

	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", common.ErrRequired))
	}

	if r.PreferredLanguage == "" {
		errs = append(errs, common.NewValidationError("preferred_language", common.ErrRequired))
	}

	if err := ValidateCountryCode(r.ResidentCountryCode); err != nil {
		errs = append(errs, common.NewValidationError("resident_country_code", err))
	}

	return errs
}

type CompleteSignupResponse struct {
	SessionToken HubSessionToken `json:"session_token"`
	Handle       Handle          `json:"handle"`
}

type HubLoginRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Password     common.Password     `json:"password"`
}

func (r HubLoginRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}
	if err := r.Password.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("password", err))
	}

	return errs
}

type HubLoginResponse struct {
	TFAToken HubTFAToken `json:"tfa_token"`
}

type HubTFARequest struct {
	TFAToken   HubTFAToken    `json:"tfa_token"`
	TFACode    common.TFACode `json:"tfa_code"`
	RememberMe bool           `json:"remember_me"`
}

func (r HubTFARequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.TFAToken == "" {
		errs = append(errs, common.NewValidationError("tfa_token", common.ErrRequired))
	}
	if err := r.TFACode.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("tfa_code", err))
	}
	// remember_me is boolean, no validation needed

	return errs
}

type HubTFAResponse struct {
	SessionToken      HubSessionToken     `json:"session_token"`
	PreferredLanguage common.LanguageCode `json:"preferred_language"`
}

type HubLogoutRequest struct {
	// Empty struct - session token passed in Authorization header
}

func (r HubLogoutRequest) Validate() []common.ValidationError {
	// No fields to validate
	return nil
}

type HubSetLanguageRequest struct {
	Language common.LanguageCode `json:"language"`
}

func (r HubSetLanguageRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Language == "" {
		errs = append(errs, common.NewValidationError("language", common.ErrRequired))
	} else if err := r.Language.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("language", err))
	}
	return errs
}

// Password Reset Types
type HubPasswordResetToken string

type HubRequestPasswordResetRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r HubRequestPasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.EmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email_address", err))
	}

	return errs
}

type HubRequestPasswordResetResponse struct {
	Message string `json:"message"`
}

type HubCompletePasswordResetRequest struct {
	ResetToken  HubPasswordResetToken `json:"reset_token"`
	NewPassword common.Password       `json:"new_password"`
}

func (r HubCompletePasswordResetRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ResetToken == "" {
		errs = append(errs, common.NewValidationError("reset_token", common.ErrRequired))
	}

	if err := r.NewPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_password", err))
	}

	return errs
}

// Change Password Types
type HubChangePasswordRequest struct {
	CurrentPassword common.Password `json:"current_password"`
	NewPassword     common.Password `json:"new_password"`
}

func (r HubChangePasswordRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.CurrentPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("current_password", err))
	}

	if err := r.NewPassword.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_password", err))
	}

	// Check if new password is same as current
	if r.CurrentPassword == r.NewPassword {
		errs = append(errs, common.NewValidationError("new_password", errors.New("must be different from current password")))
	}

	return errs
}

// Email Change Types
type HubEmailVerificationToken string

type HubRequestEmailChangeRequest struct {
	NewEmailAddress common.EmailAddress `json:"new_email_address"`
}

func (r HubRequestEmailChangeRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if err := r.NewEmailAddress.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("new_email_address", err))
	}

	return errs
}

type HubRequestEmailChangeResponse struct {
	Message string `json:"message"`
}

type HubCompleteEmailChangeRequest struct {
	VerificationToken HubEmailVerificationToken `json:"verification_token"`
}

func (r HubCompleteEmailChangeRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.VerificationToken == "" {
		errs = append(errs, common.NewValidationError("verification_token", common.ErrRequired))
	}

	return errs
}
