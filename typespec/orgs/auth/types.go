// Package auth contains Org API authentication wire types.
package auth

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type OrgSessionToken common.OpaqueToken
type OrgLoginChallengeToken common.OpaqueToken

type AuthenticatedSessionResponse struct {
	SessionToken      OrgSessionToken     `json:"session_token"`
	SessionExpiresAt  time.Time           `json:"session_expires_at"`
	PreferredLanguage orgs.FrontendLocale `json:"preferred_language"`
}
