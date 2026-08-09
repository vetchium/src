// Package admin is a compatibility facade for the split Admin API contracts.
package admin

import (
	"github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/admin/users"
)

type LoginRequest = auth.LoginRequest
type AuthenticationState = auth.AuthenticationState
type LoginAuthenticatedResponse = auth.LoginAuthenticatedResponse
type LoginTOTPRequiredResponse = auth.LoginTOTPRequiredResponse
type VerifyTFARequest = auth.VerifyTFARequest
type MyInfoResponse = users.MyInfoResponse

const (
	AuthenticationStateAuthenticated = auth.AuthenticationStateAuthenticated
	AuthenticationStateTOTPRequired  = auth.AuthenticationStateTOTPRequired
)
