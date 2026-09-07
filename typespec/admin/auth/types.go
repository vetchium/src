package auth

import (
	"time"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/common"
)

type AdminSessionToken common.OpaqueToken
type AdminLoginChallengeToken common.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      AdminSessionToken        `json:"session_token"`
	SessionExpiresAt  time.Time                `json:"session_expires_at"`
	PreferredLanguage adminspec.FrontendLocale `json:"preferred_language"`
}
