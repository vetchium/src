package contacts

import (
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
)

// RelayReadAgencyProfileRequest is accepted only from the tenant-local
// orgs-api, which authenticated the agency user.
type RelayReadAgencyProfileRequest struct {
	AgencyOrgDID orgs.OrgDID            `json:"agency_org_did"`
	Address      profile.ProfileAddress `json:"address"`
}

func (r *RelayReadAgencyProfileRequest) Normalize() {
	view := ViewHubProfileRequest{Address: r.Address}
	view.Normalize()
	r.Address = view.Address
}

func (r RelayReadAgencyProfileRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.AgencyOrgDID) {
		fields = append(fields, "agency_org_did")
	}
	if !profile.IsProfileAddress(r.Address) {
		fields = append(fields, "address")
	}
	return fields
}

// PeerReadAgencyProfileRequest is sent over authenticated tenant-to-tenant
// HTTPS. The receiver answers only a caller that homes the agency Org.
type PeerReadAgencyProfileRequest struct {
	AgencyOrgDID     orgs.OrgDID    `json:"agency_org_did"`
	TargetHubUserDID hub.HubUserDID `json:"target_hub_user_did"`
}

func (r *PeerReadAgencyProfileRequest) Normalize() {}

func (r PeerReadAgencyProfileRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.AgencyOrgDID) {
		fields = append(fields, "agency_org_did")
	}
	if !hub.IsHubUserDID(r.TargetHubUserDID) {
		fields = append(fields, "target_hub_user_did")
	}
	return fields
}

// AgencyProfileRead is what an agency reads of a Hub user.
type AgencyProfileRead struct {
	HubUserDID      hub.HubUserDID        `json:"hub_user_did"`
	Profile         profile.PublicProfile `json:"profile"`
	VerifiedDomains []VerifiedDomain      `json:"verified_domains"`
}

// Valid holds a peer to its contract: required arrays present and the
// profile a Hub profile.
func (r AgencyProfileRead) Valid() bool {
	if !hub.IsHubUserDID(r.HubUserDID) || !hub.IsHubHandle(r.Profile.Handle) ||
		r.VerifiedDomains == nil || r.Profile.Websites == nil ||
		r.Profile.WorkExperiences == nil || r.Profile.Certifications == nil ||
		r.Profile.LanguageAbilities == nil ||
		r.Profile.EducationalQualifications == nil {
		return false
	}
	for _, domain := range r.VerifiedDomains {
		if !domain.Valid() {
			return false
		}
	}
	return true
}
