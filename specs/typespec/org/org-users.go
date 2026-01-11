package org

import (
	"vetchium-api-server.typespec/common"
)

// Token types
type OrgSignupToken string
type OrgSessionToken string

// ============================================
// Signup Flow
// ============================================

type OrgInitSignupRequest struct {
	Email      common.EmailAddress `json:"email"`
	HomeRegion string              `json:"home_region"`
}

func (r OrgInitSignupRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Email == "" {
		errs = append(errs, common.NewValidationError("email", common.ErrRequired))
	} else if err := r.Email.Validate(); err != nil {
		errs = append(errs, common.NewValidationError("email", err))
	}

	if r.HomeRegion == "" {
		errs = append(errs, common.NewValidationError("home_region", common.ErrRequired))
	}

	return errs
}

type OrgInitSignupResponse struct {
	Message string `json:"message"`
}

type OrgCompleteSignupRequest struct {
	SignupToken OrgSignupToken  `json:"signup_token"`
	Password    common.Password `json:"password"`
}

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

	return errs
}

type OrgCompleteSignupResponse struct {
	SessionToken OrgSessionToken `json:"session_token"`
	OrgUserID    string          `json:"org_user_id"`
}
