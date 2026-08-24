// Package auth contains Hub API authentication wire types.
package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

type HubSessionToken common.OpaqueToken
type HubLoginChallengeToken common.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      HubSessionToken       `json:"session_token"`
	SessionExpiresAt  time.Time             `json:"session_expires_at"`
	PreferredLanguage common.FrontendLocale `json:"preferred_language"`
	ResidentCountry   common.CountryCode    `json:"resident_country"`
	HubUserDID        hub.HubUserDID        `json:"hub_user_did"`
	Handle            hub.HubHandle         `json:"handle"`
}
