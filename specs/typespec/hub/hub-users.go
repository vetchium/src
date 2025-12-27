package hub

import (
	"errors"
	"fmt"
	"regexp"
	"vetchium-api-server.typespec/common"
)

// Type aliases
type HubSignupToken string
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
	ErrDisplayNameTooShort   = errors.New("must be at least 1 character")
	ErrDisplayNameTooLong    = errors.New("must be at most 100 characters")
	ErrCountryCodeInvalid    = errors.New("must be 2 uppercase letters")
	ErrHandleInvalidFormat   = errors.New("must contain only lowercase letters, numbers, and hyphens")
	countryCodePattern       = regexp.MustCompile(`^[A-Z]{2}$`)
	handlePattern            = regexp.MustCompile(`^[a-z0-9-]+$`)
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
	Password             common.Password     `json:"password"`
	PreferredDisplayName DisplayName         `json:"preferred_display_name"`
	OtherDisplayNames    []DisplayNameEntry  `json:"other_display_names,omitempty"`
	HomeRegion           string              `json:"home_region"`
	PreferredLanguage    string              `json:"preferred_language"`
	ResidentCountryCode  CountryCode         `json:"resident_country_code"`
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
	SessionToken HubSessionToken `json:"session_token"`
}

type HubLogoutRequest struct {
	SessionToken HubSessionToken `json:"session_token"`
}

func (r HubLogoutRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SessionToken == "" {
		errs = append(errs, common.NewValidationError("session_token", common.ErrRequired))
	}

	return errs
}
