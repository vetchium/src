// Package common contains types shared by Admin API concerns.
package common

import (
	"time"

	vetchium "github.com/vetchium/src/typespec/common"
)

type LanguageCode string

const (
	EnglishUnitedStates LanguageCode = "en-US"
	GermanGermany       LanguageCode = "de-DE"
	TamilIndia          LanguageCode = "ta-IN"
)

type AdminUserID string
type AdminInvitationID string
type AdminSessionToken vetchium.OpaqueToken
type AdminLoginChallengeToken vetchium.OpaqueToken
type AdminInvitationToken vetchium.OpaqueToken
type AdminPasswordResetToken vetchium.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      AdminSessionToken   `json:"session_token"`
	SessionExpiresAt  time.Time           `json:"session_expires_at"`
	EffectiveLanguage LanguageCode        `json:"effective_language"`
	EffectiveTimezone vetchium.TimeZoneID `json:"effective_timezone"`
}

func IsLanguageCode(value LanguageCode) bool {
	return value == EnglishUnitedStates ||
		value == GermanGermany ||
		value == TamilIndia
}

func IsAdminUserID(value AdminUserID) bool {
	return isUUID(string(value))
}

func IsAdminInvitationID(value AdminInvitationID) bool {
	return isUUID(string(value))
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') ||
				(character >= 'a' && character <= 'f') ||
				(character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}
