package work

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"
)

type CreditedApplicationSummary struct {
	EngagementID      marketplace.EngagementID           `json:"engagement_id"`
	Client            marketplace.EngagementCounterparty `json:"client"`
	Opening           WorkOpening                        `json:"opening"`
	ApplicationNumber applications.ApplicationNumber     `json:"application_number"`
	Route             marketplace.ReferralRoute          `json:"route"`
	Status            hubspec.ApplicationStatus          `json:"status"`
	ContactID         *contacts.ContactID                `json:"contact_id,omitempty"`
	ApplicantDID      *directoryspec.PrincipalDID        `json:"applicant_did,omitempty"`
	AppliedAt         time.Time                          `json:"applied_at"`
}

func (s CreditedApplicationSummary) Valid() bool {
	return marketplace.IsEngagementID(s.EngagementID) &&
		orgs.IsOrgDomain(s.Client.Domain) &&
		s.Client.DisplayName != "" &&
		s.Opening.Number >= 1 &&
		s.Opening.Title != "" &&
		s.ApplicationNumber >= 1 &&
		marketplace.IsReferralRoute(s.Route) &&
		hubspec.IsApplicationStatus(s.Status) &&
		!s.AppliedAt.IsZero()
}

type ListCreditedApplicationsRequest struct {
	ClientDomain  *orgs.OrgDomain            `json:"client_domain,omitempty"`
	OpeningNumber *openings.OpeningNumber    `json:"opening_number,omitempty"`
	Route         *marketplace.ReferralRoute `json:"route,omitempty"`
	Status        *hubspec.ApplicationStatus `json:"status,omitempty"`
	ContactID     *contacts.ContactID        `json:"contact_id,omitempty"`
	PaginationKey *common.PaginationKey      `json:"pagination_key,omitempty"`
	Limit         *WorkPageSize              `json:"limit,omitempty"`
}

func (r *ListCreditedApplicationsRequest) Normalize() {
	if r.ClientDomain != nil {
		normalized := orgs.NormalizeOrgDomain(*r.ClientDomain)
		r.ClientDomain = &normalized
	}
}

func (r ListCreditedApplicationsRequest) EffectiveLimit() WorkPageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListCreditedApplicationsRequest) Validate() []string {
	fields := []string{}
	if r.ClientDomain != nil && !orgs.IsOrgDomain(*r.ClientDomain) {
		fields = append(fields, "client_domain")
	}
	if r.OpeningNumber != nil && *r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if r.Route != nil && !marketplace.IsReferralRoute(*r.Route) {
		fields = append(fields, "route")
	}
	if r.Status != nil && !hubspec.IsApplicationStatus(*r.Status) {
		fields = append(fields, "status")
	}
	if r.ContactID != nil && !contacts.IsContactID(*r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && !IsWorkPageSize(*r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListCreditedApplicationsResponse struct {
	Items              []CreditedApplicationSummary `json:"items"`
	UnavailableTenants []directoryspec.TenantID     `json:"unavailable_tenants"`
	NextPaginationKey  *common.PaginationKey        `json:"next_pagination_key,omitempty"`
}
