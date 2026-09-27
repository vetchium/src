package auth

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type OrgSignupToken common.OpaqueToken

type RequestSignupRequest struct {
	EmailAddress      common.EmailAddress `json:"email_address"`
	PreferredLanguage orgs.FrontendLocale `json:"preferred_language"`
}

func (r *RequestSignupRequest) Normalize() {
	r.EmailAddress = common.NormalizeEmailAddress(r.EmailAddress)
}

// Validate also requires the address's domain to be a claimable Org domain,
// since that domain is what the signup claims.
func (r RequestSignupRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsEmailAddress(r.EmailAddress) ||
		!orgs.IsOrgDomain(r.Domain()) {
		fields = append(fields, "email_address")
	}
	if !orgs.IsFrontendLocale(r.PreferredLanguage) {
		fields = append(fields, "preferred_language")
	}
	return fields
}

// Domain is the domain the signup claims: the email address's domain.
func (r RequestSignupRequest) Domain() orgs.OrgDomain {
	address := string(r.EmailAddress)
	return orgs.OrgDomain(address[strings.LastIndexByte(address, '@')+1:])
}

type GetSignupDetailsRequest struct {
	SignupToken OrgSignupToken `json:"signup_token"`
}

func (r *GetSignupDetailsRequest) Normalize() {}

func (r GetSignupDetailsRequest) Validate() []string {
	if !common.IsOpaqueToken(string(r.SignupToken)) {
		return []string{"signup_token"}
	}
	return []string{}
}

type SignupDetailsResponse struct {
	Domain         orgs.OrgDomain `json:"domain"`
	DNSRecordName  string         `json:"dns_record_name"`
	DNSRecordValue string         `json:"dns_record_value"`
	ExpiresAt      time.Time      `json:"expires_at"`
}

type CompleteSignupRequest struct {
	SignupToken    OrgSignupToken     `json:"signup_token"`
	OrgDisplayName common.DisplayName `json:"org_display_name"`
	Password       common.NewPassword `json:"password"`
}

func (r *CompleteSignupRequest) Normalize() {
	r.OrgDisplayName = common.NormalizeDisplayName(r.OrgDisplayName)
}

func (r CompleteSignupRequest) Validate() []string {
	fields := make([]string, 0, 3)
	if !common.IsOpaqueToken(string(r.SignupToken)) {
		fields = append(fields, "signup_token")
	}
	if !common.IsDisplayName(r.OrgDisplayName) {
		fields = append(fields, "org_display_name")
	}
	if !common.IsNewPassword(r.Password) {
		fields = append(fields, "password")
	}
	return fields
}

type CompleteSignupResponse struct {
	Domain orgs.OrgDomain `json:"domain"`
}

type SignupCompletionPendingResponse struct {
	OperationID string `json:"operation_id"`
}
