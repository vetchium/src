// Package admin contains the hand-maintained Go types corresponding to the
// admin TypeSpec API definitions.
package admin

import (
	"time"

	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
)

type SessionToken string

type LoginRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Password     common.Password     `json:"password"`
}

type LoginResponse struct {
	SessionToken SessionToken `json:"session_token"`
	ExpiresAt    time.Time    `json:"expires_at"`
}

type MyInfoResponse struct {
	AdminUserID      string              `json:"admin_user_id"`
	EmailAddress     common.EmailAddress `json:"email_address"`
	DisplayName      string              `json:"display_name"`
	AdminUserState   user.State          `json:"admin_user_state"`
	LastLoginAt      *time.Time          `json:"last_login_at,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
	SessionExpiresAt time.Time           `json:"session_expires_at"`
	TenantID         string              `json:"tenant_id"`
}
