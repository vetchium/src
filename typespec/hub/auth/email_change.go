package auth

import (
	"regexp"
	"time"

	"github.com/vetchium/src/typespec/common"
)

type HubEmailChangeChallengeID string

var (
	emailChangeChallengeIDPattern = regexp.MustCompile(
		`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
	)
	emailChangeCodePattern = regexp.MustCompile(`^[0-9]{6}$`)
)

func IsHubEmailChangeChallengeID(value HubEmailChangeChallengeID) bool {
	return emailChangeChallengeIDPattern.MatchString(string(value))
}

type RequestEmailChangeRequest struct {
	NewEmailAddress common.EmailAddress `json:"new_email_address"`
}

func (r *RequestEmailChangeRequest) Normalize() {
	r.NewEmailAddress = common.NormalizeEmailAddress(r.NewEmailAddress)
}

func (r RequestEmailChangeRequest) Validate() []string {
	if !common.IsEmailAddress(r.NewEmailAddress) {
		return []string{"new_email_address"}
	}
	return []string{}
}

type EmailChangeChallenge struct {
	ChallengeID HubEmailChangeChallengeID `json:"challenge_id"`
	ExpiresAt   time.Time                 `json:"expires_at"`
}

type ConfirmEmailChangeRequest struct {
	ChallengeID HubEmailChangeChallengeID `json:"challenge_id"`
	Code        string                    `json:"code"`
}

func (r *ConfirmEmailChangeRequest) Normalize() {}

func (r ConfirmEmailChangeRequest) Validate() []string {
	fields := []string{}
	if !IsHubEmailChangeChallengeID(r.ChallengeID) {
		fields = append(fields, "challenge_id")
	}
	if !emailChangeCodePattern.MatchString(r.Code) {
		fields = append(fields, "code")
	}
	return fields
}
