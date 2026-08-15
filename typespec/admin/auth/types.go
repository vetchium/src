package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
)

type AdminSessionToken common.OpaqueToken
type AdminLoginChallengeToken common.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      AdminSessionToken     `json:"session_token"`
	SessionExpiresAt  time.Time             `json:"session_expires_at"`
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
}
