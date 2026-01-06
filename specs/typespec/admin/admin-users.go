package admin

import (
	"vetchium-api-server.typespec/common"
)

type AdminTFAToken string
type AdminSessionToken string

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
