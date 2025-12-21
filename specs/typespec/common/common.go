package common

import (
	"errors"
	"fmt"
	"regexp"
)

type EmailAddress string
type Password string

// Validation constraints matching common.tsp
const (
	EmailMinLength    = 3
	EmailMaxLength    = 256
	PasswordMinLength = 12
	PasswordMaxLength = 64
)

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

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
