// Package admin contains the hand-maintained Go types corresponding to the
// admin TypeSpec API definitions.
package admin

import (
	"net/mail"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/common"
)

type LoginRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
	Password     common.Password     `json:"password"`
}

// Normalize returns the request with the transformations documented by the
// TypeSpec contract applied. The original request is not modified.
func (r LoginRequest) Normalize() LoginRequest {
	r.EmailAddress = common.EmailAddress(
		strings.ToLower(strings.TrimSpace(string(r.EmailAddress))),
	)
	return r
}

// Validate returns the JSON member names that do not satisfy the TypeSpec
// contract. Validation is performed after applying the documented request
// normalization.
func (r LoginRequest) Validate() []string {
	r = r.Normalize()
	invalidFields := make([]string, 0, 2)

	emailAddress := string(r.EmailAddress)
	parsedEmail, err := mail.ParseAddress(emailAddress)
	if err != nil || parsedEmail.Address != emailAddress {
		invalidFields = append(invalidFields, "email_address")
	}
	if r.Password == "" {
		invalidFields = append(invalidFields, "password")
	}

	return invalidFields
}

type LoginResponse struct {
	SessionToken string    `json:"session_token"`
	ExpiresAt    time.Time `json:"expires_at"`
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
