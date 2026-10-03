package auth

import (
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

type OrgSSOState common.OpaqueToken

// MaxSSOCodeLength bounds the authorization code a provider may return.
const MaxSSOCodeLength = 4096

type StartGoogleSignInRequest struct {
	Domain orgs.OrgDomain `json:"domain"`
}

func (r *StartGoogleSignInRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}

func (r StartGoogleSignInRequest) Validate() []string {
	if !orgs.IsOrgDomain(r.Domain) {
		return []string{"domain"}
	}
	return []string{}
}

type StartGoogleSignInResponse struct {
	AuthorizationURL string `json:"authorization_url"`
}

type CompleteGoogleSignInRequest struct {
	State OrgSSOState `json:"state"`
	Code  string      `json:"code"`
}

func (r *CompleteGoogleSignInRequest) Normalize() {}

func (r CompleteGoogleSignInRequest) Validate() []string {
	fields := make([]string, 0, 2)
	if !common.IsOpaqueToken(string(r.State)) {
		fields = append(fields, "state")
	}
	if length := utf8.RuneCountInString(r.Code); length < 1 ||
		length > MaxSSOCodeLength {
		fields = append(fields, "code")
	}
	return fields
}
