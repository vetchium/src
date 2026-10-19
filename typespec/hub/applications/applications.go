// Package applications holds the Hub contract for applying to Openings and
// reading the caller's own applications (agent-guides/hiring-pipeline.md).
package applications

import (
	"slices"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	orgapplications "github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/openings"
)

type ApplicationStatus string
type PendingActionKind string
type MyApplicationPageSize int32

const (
	Applied        ApplicationStatus = "applied"
	InReview       ApplicationStatus = "in_review"
	Interviewing   ApplicationStatus = "interviewing"
	Offer          ApplicationStatus = "offer"
	Hired          ApplicationStatus = "hired"
	NotProgressing ApplicationStatus = "not_progressing"
	Withdrawn      ApplicationStatus = "withdrawn"
)

const (
	InterviewResponse      PendingActionKind = "interview_response"
	BackgroundCheckConsent PendingActionKind = "background_check_consent"
	OfferResponse          PendingActionKind = "offer_response"
)

var applicationStatuses = []ApplicationStatus{
	Applied, InReview, Interviewing, Offer, Hired, NotProgressing, Withdrawn,
}

var pendingActionKinds = []PendingActionKind{
	InterviewResponse, BackgroundCheckConsent, OfferResponse,
}

// ApplicationStatuses returns every status this contract version defines.
func ApplicationStatuses() []ApplicationStatus {
	return slices.Clone(applicationStatuses)
}

// PendingActionKinds returns every pending action this contract version
// defines.
func PendingActionKinds() []PendingActionKind {
	return slices.Clone(pendingActionKinds)
}

func IsApplicationStatus(value ApplicationStatus) bool {
	return slices.Contains(applicationStatuses, value)
}

func IsPendingActionKind(value PendingActionKind) bool {
	return slices.Contains(pendingActionKinds, value)
}

type ApplyToOpeningRequest struct {
	Domain        orgs.OrgDomain                        `json:"domain"`
	OpeningNumber openings.OpeningNumber                `json:"opening_number"`
	CoverNote     *orgapplications.ApplicationCoverNote `json:"cover_note,omitempty"`
}

// Normalize lower-cases the domain, trims the cover note, and drops a blank
// one. It assigns a new pointer and never mutates the caller's note.
func (r *ApplyToOpeningRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
	if r.CoverNote != nil {
		trimmed := orgapplications.ApplicationCoverNote(
			strings.TrimSpace(string(*r.CoverNote)),
		)
		if trimmed == "" {
			r.CoverNote = nil
		} else {
			r.CoverNote = &trimmed
		}
	}
}

func (r ApplyToOpeningRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if r.CoverNote != nil &&
		!orgapplications.IsApplicationCoverNote(*r.CoverNote) {
		fields = append(fields, "cover_note")
	}
	return fields
}

type ApplicationReference struct {
	Domain            orgs.OrgDomain                    `json:"domain"`
	OpeningNumber     openings.OpeningNumber            `json:"opening_number"`
	ApplicationNumber orgapplications.ApplicationNumber `json:"application_number"`
}

func (r *ApplicationReference) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}

func (r ApplicationReference) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.Domain) {
		fields = append(fields, "domain")
	}
	if r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	if !orgapplications.IsApplicationNumber(r.ApplicationNumber) {
		fields = append(fields, "application_number")
	}
	return fields
}

type WithdrawApplicationRequest = ApplicationReference
type GetMyApplicationRequest = ApplicationReference

type MyApplication struct {
	OrgDomain         orgs.OrgDomain                    `json:"org_domain"`
	OrgDisplayName    common.DisplayName                `json:"org_display_name"`
	OpeningNumber     openings.OpeningNumber            `json:"opening_number"`
	OpeningTitle      string                            `json:"opening_title"`
	ApplicationNumber orgapplications.ApplicationNumber `json:"application_number"`
	Status            ApplicationStatus                 `json:"status"`
	PendingActions    []PendingActionKind               `json:"pending_actions"`
}

// Valid reports whether every field holds a value this contract defines, so
// a peer's answer can be checked before it reaches the browser.
func (a MyApplication) Valid() bool {
	if !orgs.IsOrgDomain(a.OrgDomain) ||
		!common.IsDisplayName(a.OrgDisplayName) || a.OpeningNumber < 1 ||
		strings.TrimSpace(a.OpeningTitle) == "" ||
		!orgapplications.IsApplicationNumber(a.ApplicationNumber) ||
		!IsApplicationStatus(a.Status) || a.PendingActions == nil {
		return false
	}
	for _, action := range a.PendingActions {
		if !IsPendingActionKind(action) {
			return false
		}
	}
	return true
}

type MyApplicationSummary struct {
	MyApplication
	AppliedAt      time.Time `json:"applied_at"`
	LastActivityAt time.Time `json:"last_activity_at"`
}

type ListMyApplicationsRequest struct {
	PaginationKey *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit         *MyApplicationPageSize `json:"limit,omitempty"`
}

func (r *ListMyApplicationsRequest) Normalize() {}

func (r ListMyApplicationsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return 50
	}
	return int32(*r.Limit)
}

func (r ListMyApplicationsRequest) Validate() []string {
	fields := []string{}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if limit := r.EffectiveLimit(); limit < 1 || limit > 50 {
		fields = append(fields, "limit")
	}
	return fields
}

type ListMyApplicationsResponse struct {
	Applications      []MyApplicationSummary `json:"applications"`
	NextPaginationKey *common.PaginationKey  `json:"next_pagination_key,omitempty"`
}
