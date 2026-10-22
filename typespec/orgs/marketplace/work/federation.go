package work

import (
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// The reads below are what a provider's tenant asks a client's tenant. The
// client's tenant answers only a caller that homes the provider Org they name,
// and every miss is one answer: org-engagement-work-not-found.

// Position is where the next page of the merged work queue resumes. Each
// tenant orders by Bucket (upcoming interviews first), then Sort, then the
// work id, so the merge needs no more than these three values.
type Position struct {
	Bucket int32  `json:"bucket"`
	Sort   int64  `json:"sort"`
	WorkID WorkID `json:"work_id"`
}

func (p Position) Valid() bool {
	return (p.Bucket == 0 || p.Bucket == 1) && IsWorkID(p.WorkID)
}

// PeerListWorkRequest asks for the provider's routed work at one tenant.
type PeerListWorkRequest struct {
	ProviderOrgDID orgs.OrgDID             `json:"provider_org_did"`
	ClientDomain   *orgs.OrgDomain         `json:"client_domain,omitempty"`
	Capability     *marketplace.Capability `json:"capability,omitempty"`
	OpeningNumber  *openings.OpeningNumber `json:"opening_number,omitempty"`
	StageName      *string                 `json:"stage_name,omitempty"`
	Status         *WorkStatus             `json:"status,omitempty"`
	After          *Position               `json:"after,omitempty"`
	Limit          int32                   `json:"limit"`
}

func (r *PeerListWorkRequest) Normalize() {
	list := ListWorkQueueRequest{
		ClientDomain: r.ClientDomain, StageName: r.StageName,
	}
	list.Normalize()
	r.ClientDomain, r.StageName = list.ClientDomain, list.StageName
}

func (r PeerListWorkRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	list := ListWorkQueueRequest{
		ClientDomain: r.ClientDomain, Capability: r.Capability,
		OpeningNumber: r.OpeningNumber, StageName: r.StageName, Status: r.Status,
	}
	fields = append(fields, list.Validate()...)
	if r.After != nil && !r.After.Valid() {
		fields = append(fields, "after")
	}
	if r.Limit < 1 || r.Limit > MaxPage {
		fields = append(fields, "limit")
	}
	return fields
}

// PeerWorkEntry is one routed candidacy with the position it sorts at.
type PeerWorkEntry struct {
	Position Position `json:"position"`
	Item     WorkItem `json:"item"`
}

type PeerListWorkResponse struct {
	Items   []PeerWorkEntry `json:"items"`
	HasMore bool            `json:"has_more"`
}

// PeerGetWorkRequest asks for one routed candidacy.
type PeerGetWorkRequest struct {
	ProviderOrgDID orgs.OrgDID              `json:"provider_org_did"`
	EngagementID   marketplace.EngagementID `json:"engagement_id"`
	WorkID         WorkID                   `json:"work_id"`
}

func (r *PeerGetWorkRequest) Normalize() {}

func (r PeerGetWorkRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	return append(fields, WorkReference{EngagementID: r.EngagementID, WorkID: r.WorkID}.validate()...)
}

// JobPosition is where the next page of the merged jobs resumes: jobs list
// by assignment time, newest first, then the assignment id.
type JobPosition struct {
	AssignedAt   time.Time `json:"assigned_at"`
	AssignmentID string    `json:"assignment_id"`
}

func (p JobPosition) Valid() bool {
	return !p.AssignedAt.IsZero() && IsWorkID(WorkID(p.AssignmentID))
}

type PeerListJobsRequest struct {
	ProviderOrgDID orgs.OrgDID           `json:"provider_org_did"`
	ClientDomain   *orgs.OrgDomain       `json:"client_domain,omitempty"`
	State          openings.OpeningState `json:"state"`
	After          *JobPosition          `json:"after,omitempty"`
	Limit          int32                 `json:"limit"`
}

func (r *PeerListJobsRequest) Normalize() {
	list := ListJobsRequest{ClientDomain: r.ClientDomain}
	list.Normalize()
	r.ClientDomain = list.ClientDomain
}

func (r PeerListJobsRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	if r.ClientDomain != nil && !orgs.IsOrgDomain(*r.ClientDomain) {
		fields = append(fields, "client_domain")
	}
	if !openings.IsOpeningState(r.State) {
		fields = append(fields, "state")
	}
	if r.After != nil && !r.After.Valid() {
		fields = append(fields, "after")
	}
	if r.Limit < 1 || r.Limit > MaxPage {
		fields = append(fields, "limit")
	}
	return fields
}

type PeerJobEntry struct {
	Position JobPosition `json:"position"`
	Job      Job         `json:"job"`
}

type PeerListJobsResponse struct {
	Jobs    []PeerJobEntry `json:"jobs"`
	HasMore bool           `json:"has_more"`
}

type PeerGetJobRequest struct {
	ProviderOrgDID orgs.OrgDID              `json:"provider_org_did"`
	EngagementID   marketplace.EngagementID `json:"engagement_id"`
	OpeningNumber  openings.OpeningNumber   `json:"opening_number"`
}

func (r *PeerGetJobRequest) Normalize() {}

func (r PeerGetJobRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	return append(fields, JobReference{
		EngagementID: r.EngagementID, OpeningNumber: r.OpeningNumber,
	}.Validate()...)
}

// The relay wrappers ask the local relay to read at Tenant, which may be the
// relay's own tenant.

type RelayListWorkRequest struct {
	Tenant  directoryspec.TenantID `json:"tenant"`
	Request PeerListWorkRequest    `json:"request"`
}

func (r *RelayListWorkRequest) Normalize() { r.Request.Normalize() }

func (r RelayListWorkRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}

type RelayGetWorkRequest struct {
	Tenant  directoryspec.TenantID `json:"tenant"`
	Request PeerGetWorkRequest     `json:"request"`
}

func (r *RelayGetWorkRequest) Normalize() {}

func (r RelayGetWorkRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}

type RelayListJobsRequest struct {
	Tenant  directoryspec.TenantID `json:"tenant"`
	Request PeerListJobsRequest    `json:"request"`
}

func (r *RelayListJobsRequest) Normalize() { r.Request.Normalize() }

func (r RelayListJobsRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}

type RelayGetJobRequest struct {
	Tenant  directoryspec.TenantID `json:"tenant"`
	Request PeerGetJobRequest      `json:"request"`
}

func (r *RelayGetJobRequest) Normalize() {}

func (r RelayGetJobRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}

func relayFields(tenant directoryspec.TenantID, inner []string) []string {
	fields := []string{}
	if !directoryspec.IsTenantID(tenant) {
		fields = append(fields, "tenant")
	}
	for _, field := range inner {
		fields = append(fields, "request."+field)
	}
	return fields
}

type PeerListCreditedApplicationsRequest struct {
	ProviderOrgDID orgs.OrgDID                `json:"provider_org_did"`
	ClientDomain   *orgs.OrgDomain            `json:"client_domain,omitempty"`
	OpeningNumber  *openings.OpeningNumber    `json:"opening_number,omitempty"`
	Route          *marketplace.ReferralRoute `json:"route,omitempty"`
	Status         *hubspec.ApplicationStatus `json:"status,omitempty"`
	Limit          WorkPageSize               `json:"limit"`
}

func (r *PeerListCreditedApplicationsRequest) Normalize() {
	if r.ClientDomain != nil {
		normalized := orgs.NormalizeOrgDomain(*r.ClientDomain)
		r.ClientDomain = &normalized
	}
}

func (r PeerListCreditedApplicationsRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
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
	if !IsWorkPageSize(r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

type PeerListCreditedApplicationsResponse struct {
	Items []CreditedApplicationSummary `json:"items"`
}

type RelayListCreditedApplicationsRequest struct {
	Tenant  directoryspec.TenantID              `json:"tenant"`
	Request PeerListCreditedApplicationsRequest `json:"request"`
}

func (r *RelayListCreditedApplicationsRequest) Normalize() {
	r.Request.Normalize()
}

func (r RelayListCreditedApplicationsRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}
