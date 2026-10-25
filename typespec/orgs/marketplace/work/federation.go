package work

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
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

// PeerListJobsRequest is one client tenant's share of a provider's jobs.
// Openings, when present, names the only Jobs to list: those an agency user
// owns, which only the agency's tenant knows.
type PeerListJobsRequest struct {
	ProviderOrgDID   orgs.OrgDID           `json:"provider_org_did"`
	ClientDomain     *orgs.OrgDomain       `json:"client_domain,omitempty"`
	State            openings.OpeningState `json:"state"`
	Search           *JobSearchText        `json:"search,omitempty"`
	EmployingCountry *common.CountryCode   `json:"employing_country,omitempty"`
	Openings         []JobReference        `json:"openings,omitempty"`
	After            *JobPosition          `json:"after,omitempty"`
	Limit            int32                 `json:"limit"`
}

func (r *PeerListJobsRequest) Normalize() {
	list := ListJobsRequest{ClientDomain: r.ClientDomain, Search: r.Search}
	list.Normalize()
	r.ClientDomain, r.Search = list.ClientDomain, list.Search
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
	if r.Search != nil && !IsJobSearchText(*r.Search) {
		fields = append(fields, "search")
	}
	if r.EmployingCountry != nil && !common.IsCountryCode(*r.EmployingCountry) {
		fields = append(fields, "employing_country")
	}
	// An empty list is absent: it would list nothing, so no caller sends it.
	if r.Openings != nil && (len(r.Openings) < 1 || len(r.Openings) > MaxJobsPerOwner) {
		fields = append(fields, "openings")
	} else {
		for _, opening := range r.Openings {
			if len(opening.Validate()) > 0 {
				fields = append(fields, "openings")
				break
			}
		}
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

// CreditedPosition is where the next page of a provider's merged credited
// applications resumes. Each tenant orders newest application first, then by
// the other values in descending order.
type CreditedPosition struct {
	AppliedAt         time.Time                      `json:"applied_at"`
	EngagementID      marketplace.EngagementID       `json:"engagement_id"`
	OpeningNumber     openings.OpeningNumber         `json:"opening_number"`
	ApplicationNumber applications.ApplicationNumber `json:"application_number"`
}

func (p CreditedPosition) Valid() bool {
	return !p.AppliedAt.IsZero() && marketplace.IsEngagementID(p.EngagementID) &&
		p.OpeningNumber >= 1 && p.ApplicationNumber >= 1
}

// maxApplicants bounds the applicants one credited read names: a page of
// Contacts.
const maxApplicants = 100

func validApplicants(dids []hub.HubUserDID) bool {
	if len(dids) < 1 || len(dids) > maxApplicants {
		return false
	}
	for _, did := range dids {
		if !hub.IsHubUserDID(did) {
			return false
		}
	}
	return true
}

type PeerListCreditedApplicationsRequest struct {
	ProviderOrgDID orgs.OrgDID                `json:"provider_org_did"`
	ClientDomain   *orgs.OrgDomain            `json:"client_domain,omitempty"`
	OpeningNumber  *openings.OpeningNumber    `json:"opening_number,omitempty"`
	Route          *marketplace.ReferralRoute `json:"route,omitempty"`
	Status         *hubspec.ApplicationStatus `json:"status,omitempty"`
	// ApplicantDIDs keeps only the applications of these applicants, the
	// people an agency's Contacts name.
	ApplicantDIDs []hub.HubUserDID  `json:"applicant_dids,omitempty"`
	After         *CreditedPosition `json:"after,omitempty"`
	Limit         WorkPageSize      `json:"limit"`
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
	if r.ApplicantDIDs != nil && !validApplicants(r.ApplicantDIDs) {
		fields = append(fields, "applicant_dids")
	}
	if r.After != nil && !r.After.Valid() {
		fields = append(fields, "after")
	}
	if !IsWorkPageSize(r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

// PeerCreditedEntry keeps the applicant on the mesh: the agency's tenant maps
// it to its Contact and never returns it.
type PeerCreditedEntry struct {
	Position     CreditedPosition           `json:"position"`
	ApplicantDID hub.HubUserDID             `json:"applicant_did"`
	Item         CreditedApplicationSummary `json:"item"`
}

type PeerListCreditedApplicationsResponse struct {
	Items   []PeerCreditedEntry `json:"items"`
	HasMore bool                `json:"has_more"`
}

// PeerCountCreditedApplicationsRequest asks how many applications credited to
// the provider each applicant has.
type PeerCountCreditedApplicationsRequest struct {
	ProviderOrgDID orgs.OrgDID      `json:"provider_org_did"`
	ApplicantDIDs  []hub.HubUserDID `json:"applicant_dids"`
}

func (r *PeerCountCreditedApplicationsRequest) Normalize() {}

func (r PeerCountCreditedApplicationsRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	if !validApplicants(r.ApplicantDIDs) {
		fields = append(fields, "applicant_dids")
	}
	return fields
}

type CreditedCount struct {
	ApplicantDID hub.HubUserDID `json:"applicant_did"`
	Count        int32          `json:"count"`
}

// PeerCountCreditedApplicationsResponse leaves out applicants without a
// credited application.
type PeerCountCreditedApplicationsResponse struct {
	Counts []CreditedCount `json:"counts"`
}

type RelayCountCreditedApplicationsRequest struct {
	Tenant  directoryspec.TenantID               `json:"tenant"`
	Request PeerCountCreditedApplicationsRequest `json:"request"`
}

func (r *RelayCountCreditedApplicationsRequest) Normalize() {}

func (r RelayCountCreditedApplicationsRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
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

type PeerGetActivityStatementRequest struct {
	ProviderOrgDID orgs.OrgDID                `json:"provider_org_did"`
	EngagementID   marketplace.EngagementID   `json:"engagement_id"`
	Month          marketplace.StatementMonth `json:"month"`
	PaginationKey  *common.PaginationKey      `json:"pagination_key,omitempty"`
	Limit          int32                      `json:"limit"`
}

func (r *PeerGetActivityStatementRequest) Normalize() {
	r.EngagementID = marketplace.EngagementID(strings.TrimSpace(string(r.EngagementID)))
	r.Month = marketplace.StatementMonth(strings.TrimSpace(string(r.Month)))
}

func (r PeerGetActivityStatementRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDID(r.ProviderOrgDID) {
		fields = append(fields, "provider_org_did")
	}
	if !marketplace.IsEngagementID(r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if !marketplace.IsStatementMonth(r.Month) {
		fields = append(fields, "month")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit < 1 || r.Limit > 100 {
		fields = append(fields, "limit")
	}
	return fields
}

type PeerGetActivityStatementResponse struct {
	EngagementID      marketplace.EngagementID            `json:"engagement_id"`
	Month             marketplace.StatementMonth          `json:"month"`
	Items             []marketplace.ActivityStatementItem `json:"items"`
	NextPaginationKey *common.PaginationKey               `json:"next_pagination_key,omitempty"`
}

type RelayGetActivityStatementRequest struct {
	Tenant  directoryspec.TenantID          `json:"tenant"`
	Request PeerGetActivityStatementRequest `json:"request"`
}

func (r *RelayGetActivityStatementRequest) Normalize() {
	r.Request.Normalize()
}

func (r RelayGetActivityStatementRequest) Validate() []string {
	return relayFields(r.Tenant, r.Request.Validate())
}
