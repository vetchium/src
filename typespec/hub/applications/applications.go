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
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
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

// MyApplicationOffer is the latest offer unless the Org withdrew it.
type MyApplicationOffer struct {
	OfferNumber         orgapplications.OfferNumber   `json:"offer_number"`
	Status              orgapplications.OfferStatus   `json:"status"`
	LetterURL           string                        `json:"letter_url"`
	LetterByteSize      int32                         `json:"letter_byte_size"`
	ProposedJoiningDate *orgapplications.CalendarDate `json:"proposed_joining_date,omitempty"`
	RespondBy           time.Time                     `json:"respond_by"`
	ExtendedAt          time.Time                     `json:"extended_at"`
}

// Valid reports a status the applicant may see and well-formed values.
func (o MyApplicationOffer) Valid() bool {
	return orgapplications.IsOfferNumber(o.OfferNumber) &&
		orgapplications.IsOfferStatus(o.Status) &&
		o.Status != orgapplications.OfferStatusWithdrawn &&
		strings.HasPrefix(o.LetterURL, "http") && o.LetterByteSize >= 1 &&
		(o.ProposedJoiningDate == nil ||
			orgapplications.IsCalendarDate(*o.ProposedJoiningDate)) &&
		!o.RespondBy.IsZero() && !o.ExtendedAt.IsZero()
}

type MyInterviewState string

const (
	MyInterviewScheduled MyInterviewState = "scheduled"
	MyInterviewCancelled MyInterviewState = "cancelled"
)

// MyInterviewStates returns every state this contract version defines.
func MyInterviewStates() []MyInterviewState {
	return []MyInterviewState{MyInterviewScheduled, MyInterviewCancelled}
}

func IsMyInterviewState(value MyInterviewState) bool {
	return value == MyInterviewScheduled || value == MyInterviewCancelled
}

// MyApplicationInterview is an interview without its stage name or
// interviewers: how a finished interview went is the Org's alone.
type MyApplicationInterview struct {
	InterviewNumber orgapplications.InterviewNumber          `json:"interview_number"`
	State           MyInterviewState                         `json:"state"`
	StartsAt        time.Time                                `json:"starts_at"`
	DurationMinutes orgapplications.InterviewDurationMinutes `json:"duration_minutes"`
	Mode            orgapplications.InterviewMode            `json:"mode"`
	VideoURL        *string                                  `json:"video_url,omitempty"`
	Location        *orgapplications.InterviewLocation       `json:"location,omitempty"`
	Response        orgapplications.InterviewResponse        `json:"response"`
	RescheduleNote  *orgapplications.InterviewRescheduleNote `json:"reschedule_note,omitempty"`
	// Provider holds the interview for the Org; absent when in-house.
	Provider *marketplace.EngagementCounterparty `json:"provider,omitempty"`
}

// Valid checks a peer's answer before it reaches the browser.
func (i MyApplicationInterview) Valid() bool {
	video := i.Mode == orgapplications.InterviewVideo
	return orgapplications.IsInterviewNumber(i.InterviewNumber) &&
		IsMyInterviewState(i.State) && !i.StartsAt.IsZero() &&
		orgapplications.IsInterviewDurationMinutes(i.DurationMinutes) &&
		orgapplications.IsInterviewMode(i.Mode) &&
		(i.VideoURL != nil) == video && (i.Location != nil) == !video &&
		(i.Location == nil || orgapplications.IsInterviewLocation(*i.Location)) &&
		orgapplications.IsInterviewResponse(i.Response) &&
		(i.RescheduleNote != nil) ==
			(i.Response == orgapplications.ResponseRescheduleRequest) &&
		(i.RescheduleNote == nil ||
			orgapplications.IsInterviewRescheduleNote(*i.RescheduleNote)) &&
		(i.Provider == nil || validProvider(*i.Provider))
}

func validProvider(provider marketplace.EngagementCounterparty) bool {
	return orgs.IsOrgDomain(provider.Domain) &&
		strings.TrimSpace(provider.DisplayName) != ""
}

// MyBackgroundCheckConsent is the consent request awaiting the applicant.
type MyBackgroundCheckConsent struct {
	CheckNumber orgapplications.BackgroundCheckNumber `json:"check_number"`
	CheckTypes  []hiring.CheckType                    `json:"check_types"`
	Performer   orgapplications.WorkPerformer         `json:"performer"`
	// Provider performs the checks when Performer is `provider`, and
	// Disclosure is the text it asks the applicant to consent to.
	Provider    *marketplace.EngagementCounterparty `json:"provider,omitempty"`
	Disclosure  *string                             `json:"disclosure,omitempty"`
	RequestedAt time.Time                           `json:"requested_at"`
}

// Valid checks a peer's answer before it reaches the browser.
func (c MyBackgroundCheckConsent) Valid() bool {
	if !orgapplications.IsBackgroundCheckNumber(c.CheckNumber) ||
		len(c.CheckTypes) < 1 || len(c.CheckTypes) > orgapplications.MaxCheckTypes ||
		!orgapplications.IsWorkPerformer(c.Performer) || c.RequestedAt.IsZero() ||
		(c.Performer == orgapplications.PerformerProvider) !=
			(c.Provider != nil && c.Disclosure != nil) ||
		(c.Provider != nil && !validProvider(*c.Provider)) ||
		(c.Disclosure != nil && strings.TrimSpace(*c.Disclosure) == "") {
		return false
	}
	seen := make(map[hiring.CheckType]bool, len(c.CheckTypes))
	for _, checkType := range c.CheckTypes {
		if !hiring.IsCheckType(checkType) || seen[checkType] {
			return false
		}
		seen[checkType] = true
	}
	return true
}

// MyApplicationDetail is the live read of one application.
type MyApplicationDetail struct {
	MyApplication
	Offer                  *MyApplicationOffer       `json:"offer,omitempty"`
	BackgroundCheckConsent *MyBackgroundCheckConsent `json:"background_check_consent,omitempty"`
	Interviews             []MyApplicationInterview  `json:"interviews"`
}

// Valid checks a peer's answer before it reaches the browser.
func (d MyApplicationDetail) Valid() bool {
	if !d.MyApplication.Valid() || (d.Offer != nil && !d.Offer.Valid()) ||
		(d.BackgroundCheckConsent != nil && !d.BackgroundCheckConsent.Valid()) ||
		d.Interviews == nil {
		return false
	}
	for _, interview := range d.Interviews {
		if !interview.Valid() {
			return false
		}
	}
	return true
}

// InterviewReference names an interview of an application.
type InterviewReference struct {
	ApplicationReference
	InterviewNumber orgapplications.InterviewNumber `json:"interview_number"`
}

func (r *InterviewReference) Normalize() {
	r.ApplicationReference.Normalize()
}

func (r InterviewReference) Validate() []string {
	fields := r.ApplicationReference.Validate()
	if !orgapplications.IsInterviewNumber(r.InterviewNumber) {
		fields = append(fields, "interview_number")
	}
	return fields
}

type AcceptInterviewRequest = InterviewReference

// RequestInterviewRescheduleRequest asks the Org to move an interview.
type RequestInterviewRescheduleRequest struct {
	InterviewReference
	Note orgapplications.InterviewRescheduleNote `json:"note"`
}

// Normalize lower-cases the domain and trims the note.
func (r *RequestInterviewRescheduleRequest) Normalize() {
	r.InterviewReference.Normalize()
	r.Note = orgapplications.InterviewRescheduleNote(
		strings.TrimSpace(string(r.Note)),
	)
}

func (r RequestInterviewRescheduleRequest) Validate() []string {
	fields := r.InterviewReference.Validate()
	if !orgapplications.IsInterviewRescheduleNote(r.Note) {
		fields = append(fields, "note")
	}
	return fields
}

// BackgroundCheckConsentRequest names the consent request the applicant read.
type BackgroundCheckConsentRequest struct {
	ApplicationReference
	CheckNumber orgapplications.BackgroundCheckNumber `json:"check_number"`
}

func (r *BackgroundCheckConsentRequest) Normalize() {
	r.ApplicationReference.Normalize()
}

func (r BackgroundCheckConsentRequest) Validate() []string {
	fields := r.ApplicationReference.Validate()
	if !orgapplications.IsBackgroundCheckNumber(r.CheckNumber) {
		fields = append(fields, "check_number")
	}
	return fields
}

// RespondToOfferRequest names the offer the applicant read.
type RespondToOfferRequest struct {
	ApplicationReference
	OfferNumber orgapplications.OfferNumber `json:"offer_number"`
}

func (r *RespondToOfferRequest) Normalize() {
	r.ApplicationReference.Normalize()
}

func (r RespondToOfferRequest) Validate() []string {
	fields := r.ApplicationReference.Validate()
	if !orgapplications.IsOfferNumber(r.OfferNumber) {
		fields = append(fields, "offer_number")
	}
	return fields
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
