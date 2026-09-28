package profile

import (
	"regexp"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
)

type ProfessionalEmail struct {
	ID              ProfileEntryID            `json:"id"`
	EmailAddress    common.EmailAddress       `json:"email_address"`
	Domain          common.ProfessionalDomain `json:"domain"`
	FirstVerifiedAt *time.Time                `json:"first_verified_at,omitempty"`
	LastVerifiedAt  *time.Time                `json:"last_verified_at,omitempty"`
	CreatedAt       time.Time                 `json:"created_at"`
}

type ProfessionalEmailPageSize int32

func IsProfessionalEmailPageSize(value ProfessionalEmailPageSize) bool {
	return value >= 1 && value <= 10
}

type ListProfessionalEmailsRequest struct {
	Limit         *ProfessionalEmailPageSize `json:"limit,omitempty"`
	PaginationKey *common.PaginationKey      `json:"pagination_key,omitempty"`
}

func (r *ListProfessionalEmailsRequest) Normalize() {}

func (r ListProfessionalEmailsRequest) EffectiveLimit() ProfessionalEmailPageSize {
	if r.Limit == nil {
		return 10
	}
	return *r.Limit
}

func (r ListProfessionalEmailsRequest) Validate() []string {
	fields := []string{}
	if !IsProfessionalEmailPageSize(r.EffectiveLimit()) {
		fields = append(fields, "limit")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	return fields
}

type ListProfessionalEmailsResponse struct {
	Emails            []ProfessionalEmail   `json:"emails"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type AddProfessionalEmailRequest struct {
	EmailAddress common.EmailAddress `json:"email_address"`
}

func (r *AddProfessionalEmailRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

func (r AddProfessionalEmailRequest) Validate() []string {
	if !common.IsEmailAddress(r.EmailAddress) {
		return []string{"email_address"}
	}
	_, domain, _ := strings.Cut(string(r.EmailAddress), "@")
	if !common.IsProfessionalDomain(common.ProfessionalDomain(domain)) {
		return []string{"email_address"}
	}
	return []string{}
}

type ProfessionalEmailIDRequest struct {
	ID ProfileEntryID `json:"id"`
}

func (r *ProfessionalEmailIDRequest) Normalize() {}

func (r ProfessionalEmailIDRequest) Validate() []string {
	if !IsProfileEntryID(r.ID) {
		return []string{"id"}
	}
	return []string{}
}

type ProfessionalEmailChallenge struct {
	ChallengeID ProfileEntryID `json:"challenge_id"`
	ExpiresAt   time.Time      `json:"expires_at"`
}

type VerifyProfessionalEmailRequest struct {
	ID          ProfileEntryID `json:"id"`
	ChallengeID ProfileEntryID `json:"challenge_id"`
	Code        string         `json:"code"`
}

func (r *VerifyProfessionalEmailRequest) Normalize() {}

var professionalEmailCodePattern = regexp.MustCompile(`^[0-9]{6}$`)

func (r VerifyProfessionalEmailRequest) Validate() []string {
	fields := []string{}
	if !IsProfileEntryID(r.ID) {
		fields = append(fields, "id")
	}
	if !IsProfileEntryID(r.ChallengeID) {
		fields = append(fields, "challenge_id")
	}
	if !professionalEmailCodePattern.MatchString(r.Code) {
		fields = append(fields, "code")
	}
	return fields
}
