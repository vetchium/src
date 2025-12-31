package common

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type EmailAddress string
type Password string
type LanguageCode string
type DomainName string
type TFACode string

// Validation constraints matching common.tsp
const (
	EmailMinLength        = 3
	EmailMaxLength        = 256
	PasswordMinLength     = 12
	PasswordMaxLength     = 64
	LanguageCodeMinLength = 2
	LanguageCodeMaxLength = 10
	DomainMinLength       = 3
	DomainMaxLength       = 255
	TFACodeLength         = 6
)

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
var languageCodePattern = regexp.MustCompile(`^[a-z]{2}(-[A-Z]{2})?$`)
var domainNamePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)

// Supported languages (BCP 47 tags)
var SupportedLanguages = []LanguageCode{"en-US", "de-DE", "ta-IN"}

const DefaultLanguage LanguageCode = "en-US"

// Validation errors for base types (no field context - that's the caller's job)
var (
	ErrEmailTooShort        = errors.New("must be at least 3 characters")
	ErrEmailTooLong         = errors.New("must be at most 256 characters")
	ErrEmailInvalidFormat   = errors.New("must be a valid email address")
	ErrPasswordTooShort     = errors.New("must be at least 12 characters")
	ErrPasswordTooLong      = errors.New("must be at most 64 characters")
	ErrRequired             = errors.New("is required")
	ErrTFACodeInvalidLength = errors.New("must be exactly 6 characters")
	ErrTFACodeInvalidFormat = errors.New("must contain only digits")
	ErrLanguageCodeInvalid  = errors.New("must be a valid language code")
	ErrLanguageNotSupported = errors.New("language not supported")
	ErrDomainTooShort       = errors.New("must be at least 3 characters")
	ErrDomainTooLong        = errors.New("must be at most 255 characters")
	ErrDomainInvalidFormat  = errors.New("must be a valid domain name in lowercase")
)

// ValidationError represents a validation failure with field context
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (v ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", v.Field, v.Message)
}

// NewValidationError creates a ValidationError by combining field name with a base error
func NewValidationError(field string, err error) ValidationError {
	return ValidationError{Field: field, Message: err.Error()}
}

// Validate checks if the email address meets constraints (returns error without field context)
func (e EmailAddress) Validate() error {
	if len(e) < EmailMinLength {
		return ErrEmailTooShort
	}
	if len(e) > EmailMaxLength {
		return ErrEmailTooLong
	}
	if !emailPattern.MatchString(string(e)) {
		return ErrEmailInvalidFormat
	}
	return nil
}

// Validate checks if the password meets constraints (returns error without field context)
func (p Password) Validate() error {
	if len(p) < PasswordMinLength {
		return ErrPasswordTooShort
	}
	if len(p) > PasswordMaxLength {
		return ErrPasswordTooLong
	}
	return nil
}

// Validate checks if the language code meets constraints (returns error without field context)
func (l LanguageCode) Validate() error {
	if !languageCodePattern.MatchString(string(l)) {
		return ErrLanguageCodeInvalid
	}
	for _, supported := range SupportedLanguages {
		if l == supported {
			return nil
		}
	}
	return ErrLanguageNotSupported
}

// Validate checks if the domain name meets constraints (returns error without field context)
func (d DomainName) Validate() error {
	domainStr := string(d)
	if len(domainStr) < DomainMinLength {
		return ErrDomainTooShort
	}
	if len(domainStr) > DomainMaxLength {
		return ErrDomainTooLong
	}
	// Check if lowercase
	if domainStr != strings.ToLower(domainStr) {
		return ErrDomainInvalidFormat
	}
	if !domainNamePattern.MatchString(domainStr) {
		return ErrDomainInvalidFormat
	}
	return nil
}

// Validate checks if the TFA code meets constraints (returns error without field context)
func (c TFACode) Validate() error {
	if len(c) != TFACodeLength {
		return ErrTFACodeInvalidLength
	}
	for _, ch := range c {
		if ch < '0' || ch > '9' {
			return ErrTFACodeInvalidFormat
		}
	}
	return nil
}
