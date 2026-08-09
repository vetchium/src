package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
)

type AdminSessionToken common.OpaqueToken
type AdminLoginChallengeToken common.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      AdminSessionToken   `json:"session_token"`
	SessionExpiresAt  time.Time           `json:"session_expires_at"`
	EffectiveLanguage common.LanguageCode `json:"effective_language"`
	EffectiveTimezone common.TimeZoneID   `json:"effective_timezone"`
}
