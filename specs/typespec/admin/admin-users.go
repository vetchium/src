package admin

import (
	"vetchium-api-server.typespec/common"
)

type AdminTFAToken string
type AdminSessionToken string
type TFACode string

// Validation constraints matching admin-users.tsp
const (
	TFACodeLength = 6
)

// Validate checks if the TFA code meets constraints
func (c TFACode) Validate() error {
	if len(c) != TFACodeLength {
		return common.ErrTFACodeInvalidLength
	}
	for _, ch := range c {
		if ch < '0' || ch > '9' {
			return common.ErrTFACodeInvalidFormat
		}
	}
	return nil
}

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
	TFAToken AdminTFAToken `json:"tfa_token"`
	TFACode  TFACode       `json:"tfa_code"`
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
	SessionToken AdminSessionToken `json:"session_token"`
}

type AdminLogoutRequest struct {
	SessionToken AdminSessionToken `json:"session_token"`
}

func (r AdminLogoutRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.SessionToken == "" {
		errs = append(errs, common.NewValidationError("session_token", common.ErrRequired))
	}

	return errs
}
