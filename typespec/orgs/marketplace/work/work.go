// Package work holds the wire types of a provider's routed work: the work
// queue, the jobs of its `sourcing` engagements, and the writes that perform
// a routed stage (agent-guides/marketplace.md, MKT-ACC and MKT-WRK). It sits
// beside the marketplace package because it builds on the applications
// package, which itself uses marketplace.
package work

import (
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
)

// MaxPage bounds one page of the work queue or the jobs.
const MaxPage = 50

type WorkID string
type WorkStatus string

const (
	Pending         WorkStatus = "pending"
	Scheduled       WorkStatus = "scheduled"
	AwaitingConsent WorkStatus = "awaiting_consent"
	InProgress      WorkStatus = "in_progress"
	Completed       WorkStatus = "completed"
)

var workStatuses = []WorkStatus{
	Pending, Scheduled, AwaitingConsent, InProgress, Completed,
}

// WorkStatuses returns every status this contract version defines.
func WorkStatuses() []WorkStatus { return slices.Clone(workStatuses) }

func IsWorkStatus(value WorkStatus) bool {
	return slices.Contains(workStatuses, value)
}

var workIDPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsWorkID accepts the lowercase form the API returns.
func IsWorkID(value WorkID) bool { return workIDPattern.MatchString(string(value)) }

// WorkOpening is an Opening as its provider names it.
type WorkOpening struct {
	Number           openings.OpeningNumber `json:"number"`
	Title            string                 `json:"title"`
	EmployingCountry *common.CountryCode    `json:"employing_country,omitempty"`
}

// WorkItem is one routed candidacy in a list.
type WorkItem struct {
	WorkID          WorkID                             `json:"work_id"`
	EngagementID    marketplace.EngagementID           `json:"engagement_id"`
	Client          marketplace.EngagementCounterparty `json:"client"`
	Capability      marketplace.Capability             `json:"capability"`
	Opening         WorkOpening                        `json:"opening"`
	StageName       string                             `json:"stage_name"`
	Status          WorkStatus                         `json:"status"`
	ApplicantName   common.DisplayName                 `json:"applicant_name"`
	NextInterviewAt *time.Time                         `json:"next_interview_at,omitempty"`
	RoutedAt        time.Time                          `json:"routed_at"`
}

// Valid checks a peer's answer before it reaches the browser.
func (i WorkItem) Valid() bool {
	return IsWorkID(i.WorkID) && marketplace.IsEngagementID(i.EngagementID) &&
		orgs.IsOrgDomain(i.Client.Domain) && i.Client.DisplayName != "" &&
		marketplace.IsCapability(i.Capability) && i.Opening.Number >= 1 &&
		i.Opening.Title != "" && i.StageName != "" && IsWorkStatus(i.Status) &&
		i.ApplicantName != "" && !i.RoutedAt.IsZero()
}

// WorkDetail is a routed candidacy and what its provider may see.
type WorkDetail struct {
	Item            WorkItem                           `json:"item"`
	Snapshot        profile.ApplicantSnapshot          `json:"snapshot"`
	CoverNote       *applications.ApplicationCoverNote `json:"cover_note,omitempty"`
	Interviews      []applications.Interview           `json:"interviews"`
	Assessment      *applications.AssessmentResult     `json:"assessment,omitempty"`
	BackgroundCheck *applications.BackgroundCheck      `json:"background_check,omitempty"`
}

// WorkReference names a routed candidacy by its engagement and work id.
type WorkReference struct {
	EngagementID marketplace.EngagementID `json:"engagement_id"`
	WorkID       WorkID                   `json:"work_id"`
}

func (r WorkReference) validate() []string {
	fields := []string{}
	if !marketplace.IsEngagementID(r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if !IsWorkID(r.WorkID) {
		fields = append(fields, "work_id")
	}
	return fields
}

func (r *WorkReference) Normalize() {}

func (r WorkReference) Validate() []string { return r.validate() }

func validStageName(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 1 && length <= 100 && value == strings.TrimSpace(value) &&
		!strings.ContainsRune(value, 0)
}

type ListWorkQueueRequest struct {
	ClientDomain  *orgs.OrgDomain         `json:"client_domain,omitempty"`
	Capability    *marketplace.Capability `json:"capability,omitempty"`
	OpeningNumber *openings.OpeningNumber `json:"opening_number,omitempty"`
	StageName     *string                 `json:"stage_name,omitempty"`
	Status        *WorkStatus             `json:"status,omitempty"`
	PaginationKey *common.PaginationKey   `json:"pagination_key,omitempty"`
	Limit         *int32                  `json:"limit,omitempty"`
}

func (r *ListWorkQueueRequest) Normalize() {
	if r.ClientDomain != nil {
		domain := orgs.NormalizeOrgDomain(*r.ClientDomain)
		r.ClientDomain = &domain
	}
	if r.StageName != nil {
		name := strings.TrimSpace(*r.StageName)
		r.StageName = &name
	}
}

func (r ListWorkQueueRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return MaxPage
	}
	return *r.Limit
}

func (r ListWorkQueueRequest) Validate() []string {
	fields := []string{}
	if r.ClientDomain != nil && !orgs.IsOrgDomain(*r.ClientDomain) {
		fields = append(fields, "client_domain")
	}
	if r.Capability != nil && !marketplace.IsCapability(*r.Capability) {
		fields = append(fields, "capability")
	}
	if r.OpeningNumber != nil && (*r.OpeningNumber < 1 || r.ClientDomain == nil) {
		fields = append(fields, "opening_number")
	}
	if r.StageName != nil && !validStageName(*r.StageName) {
		fields = append(fields, "stage_name")
	}
	if r.Status != nil && !IsWorkStatus(*r.Status) {
		fields = append(fields, "status")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > MaxPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListWorkQueueResponse struct {
	Items              []WorkItem               `json:"items"`
	UnavailableTenants []directoryspec.TenantID `json:"unavailable_tenants"`
	NextPaginationKey  *common.PaginationKey    `json:"next_pagination_key,omitempty"`
}

// Job is an Opening assigned to a `sourcing` engagement.
type Job struct {
	EngagementID marketplace.EngagementID           `json:"engagement_id"`
	Client       marketplace.EngagementCounterparty `json:"client"`
	Opening      WorkOpening                        `json:"opening"`
	State        openings.OpeningState              `json:"state"`
	AssignedAt   time.Time                          `json:"assigned_at"`
}

// Valid checks a peer's answer before it reaches the browser.
func (j Job) Valid() bool {
	return marketplace.IsEngagementID(j.EngagementID) &&
		orgs.IsOrgDomain(j.Client.Domain) && j.Client.DisplayName != "" &&
		j.Opening.Number >= 1 && j.Opening.Title != "" &&
		openings.IsOpeningState(j.State) && !j.AssignedAt.IsZero()
}

// JobDetail is the Opening's live content.
type JobDetail struct {
	Job     Job                   `json:"job"`
	Content common.OpeningContent `json:"content"`
}

type JobReference struct {
	EngagementID  marketplace.EngagementID `json:"engagement_id"`
	OpeningNumber openings.OpeningNumber   `json:"opening_number"`
}

func (r *JobReference) Normalize() {}

func (r JobReference) Validate() []string {
	fields := []string{}
	if !marketplace.IsEngagementID(r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	if r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	return fields
}

type ListJobsRequest struct {
	ClientDomain  *orgs.OrgDomain        `json:"client_domain,omitempty"`
	State         *openings.OpeningState `json:"state,omitempty"`
	PaginationKey *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit         *int32                 `json:"limit,omitempty"`
}

func (r *ListJobsRequest) Normalize() {
	if r.ClientDomain != nil {
		domain := orgs.NormalizeOrgDomain(*r.ClientDomain)
		r.ClientDomain = &domain
	}
}

func (r ListJobsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return MaxPage
	}
	return *r.Limit
}

// EffectiveState is the state listed: `published` unless one is named.
func (r ListJobsRequest) EffectiveState() openings.OpeningState {
	if r.State == nil {
		return openings.Published
	}
	return *r.State
}

func (r ListJobsRequest) Validate() []string {
	fields := []string{}
	if r.ClientDomain != nil && !orgs.IsOrgDomain(*r.ClientDomain) {
		fields = append(fields, "client_domain")
	}
	if r.State != nil && !openings.IsOpeningState(*r.State) {
		fields = append(fields, "state")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > MaxPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListJobsResponse struct {
	Jobs               []Job                    `json:"jobs"`
	UnavailableTenants []directoryspec.TenantID `json:"unavailable_tenants"`
	NextPaginationKey  *common.PaginationKey    `json:"next_pagination_key,omitempty"`
}

// WriteResult is the work a write names and its status afterwards. It holds
// nothing about the applicant, because the client's tenant stores it as the
// command's outcome.
type WriteResult struct {
	WorkID          WorkID                        `json:"work_id"`
	Status          WorkStatus                    `json:"status"`
	InterviewNumber *applications.InterviewNumber `json:"interview_number,omitempty"`
}

// Valid checks a client tenant's answer before it reaches the browser.
func (r WriteResult) Valid() bool {
	return IsWorkID(r.WorkID) && IsWorkStatus(r.Status) &&
		(r.InterviewNumber == nil || applications.IsInterviewNumber(*r.InterviewNumber))
}

// InterviewReference names an interview of a routed candidacy.
type InterviewReference struct {
	EngagementID    marketplace.EngagementID     `json:"engagement_id"`
	WorkID          WorkID                       `json:"work_id"`
	InterviewNumber applications.InterviewNumber `json:"interview_number"`
}

func (r *InterviewReference) Normalize() {}

func (r InterviewReference) Validate() []string {
	fields := WorkReference{EngagementID: r.EngagementID, WorkID: r.WorkID}.validate()
	if !applications.IsInterviewNumber(r.InterviewNumber) {
		fields = append(fields, "interview_number")
	}
	return fields
}

// reference holds an application reference that always validates, so the
// request types of the applications package can check the fields the work
// requests share with them.
func reference() applications.ApplicationReference {
	return applications.ApplicationReference{
		OpeningNumber: 1, ApplicationNumber: 1, Version: 1,
	}
}

// ScheduleInterviewRequest schedules an interview of a routed candidacy at an
// interview stage.
type ScheduleInterviewRequest struct {
	EngagementID marketplace.EngagementID `json:"engagement_id"`
	WorkID       WorkID                   `json:"work_id"`
	applications.InterviewDetails
}

func (r *ScheduleInterviewRequest) Normalize() {
	inner := applications.ScheduleInterviewRequest{InterviewDetails: r.InterviewDetails}
	inner.Normalize()
	r.InterviewDetails = inner.InterviewDetails
}

func (r ScheduleInterviewRequest) Validate() []string {
	fields := WorkReference{EngagementID: r.EngagementID, WorkID: r.WorkID}.validate()
	inner := applications.ScheduleInterviewRequest{
		OpeningNumber: reference().OpeningNumber, ApplicationNumber: reference().ApplicationNumber,
		Version: reference().Version, InterviewDetails: r.InterviewDetails,
	}
	return append(fields, inner.Validate()...)
}

// ChangeInterviewRequest replaces the details and interviewers of an upcoming
// interview.
type ChangeInterviewRequest struct {
	EngagementID    marketplace.EngagementID     `json:"engagement_id"`
	WorkID          WorkID                       `json:"work_id"`
	InterviewNumber applications.InterviewNumber `json:"interview_number"`
	applications.InterviewDetails
}

func (r *ChangeInterviewRequest) Normalize() {
	inner := applications.ChangeInterviewRequest{InterviewDetails: r.InterviewDetails}
	inner.Normalize()
	r.InterviewDetails = inner.InterviewDetails
}

func (r ChangeInterviewRequest) Validate() []string {
	fields := InterviewReference{
		EngagementID: r.EngagementID, WorkID: r.WorkID,
		InterviewNumber: r.InterviewNumber,
	}.Validate()
	inner := applications.ScheduleInterviewRequest{
		OpeningNumber: reference().OpeningNumber, ApplicationNumber: reference().ApplicationNumber,
		Version: reference().Version, InterviewDetails: r.InterviewDetails,
	}
	return append(fields, inner.Validate()...)
}

type RecordInterviewOutcomeRequest struct {
	EngagementID    marketplace.EngagementID      `json:"engagement_id"`
	WorkID          WorkID                        `json:"work_id"`
	InterviewNumber applications.InterviewNumber  `json:"interview_number"`
	Outcome         applications.InterviewOutcome `json:"outcome"`
}

func (r *RecordInterviewOutcomeRequest) Normalize() {}

func (r RecordInterviewOutcomeRequest) Validate() []string {
	fields := InterviewReference{
		EngagementID: r.EngagementID, WorkID: r.WorkID,
		InterviewNumber: r.InterviewNumber,
	}.Validate()
	if !applications.IsInterviewOutcome(r.Outcome) {
		fields = append(fields, "outcome")
	}
	return fields
}

type SubmitInterviewFeedbackRequest struct {
	EngagementID    marketplace.EngagementID             `json:"engagement_id"`
	WorkID          WorkID                               `json:"work_id"`
	InterviewNumber applications.InterviewNumber         `json:"interview_number"`
	Recommendation  applications.InterviewRecommendation `json:"recommendation"`
	Notes           applications.InterviewFeedbackNotes  `json:"notes"`
}

func (r *SubmitInterviewFeedbackRequest) Normalize() {
	inner := applications.SubmitInterviewFeedbackRequest{Notes: r.Notes}
	inner.Normalize()
	r.Notes = inner.Notes
}

func (r SubmitInterviewFeedbackRequest) Validate() []string {
	fields := InterviewReference{
		EngagementID: r.EngagementID, WorkID: r.WorkID,
		InterviewNumber: r.InterviewNumber,
	}.Validate()
	if !applications.IsInterviewRecommendation(r.Recommendation) {
		fields = append(fields, "recommendation")
	}
	if !applications.IsInterviewFeedbackNotes(r.Notes) {
		fields = append(fields, "notes")
	}
	return fields
}

type RecordAssessmentRequest struct {
	EngagementID marketplace.EngagementID       `json:"engagement_id"`
	WorkID       WorkID                         `json:"work_id"`
	Outcome      applications.AssessmentOutcome `json:"outcome"`
	Score        *applications.AssessmentScore  `json:"score,omitempty"`
	Notes        *applications.ResultNotes      `json:"notes,omitempty"`
	ReportURL    *profile.WebsiteURL            `json:"report_url,omitempty"`
}

func (r *RecordAssessmentRequest) Normalize() {
	inner := applications.RecordAssessmentResultRequest{Notes: r.Notes, ReportURL: r.ReportURL}
	inner.Normalize()
	r.Notes, r.ReportURL = inner.Notes, inner.ReportURL
}

func (r RecordAssessmentRequest) Validate() []string {
	fields := WorkReference{EngagementID: r.EngagementID, WorkID: r.WorkID}.validate()
	inner := applications.RecordAssessmentResultRequest{
		OpeningNumber: reference().OpeningNumber, ApplicationNumber: reference().ApplicationNumber,
		Version: reference().Version, Outcome: r.Outcome, Score: r.Score,
		Notes: r.Notes, ReportURL: r.ReportURL,
	}
	return append(fields, inner.Validate()...)
}

type RecordBackgroundCheckResultRequest struct {
	EngagementID marketplace.EngagementID  `json:"engagement_id"`
	WorkID       WorkID                    `json:"work_id"`
	CheckType    hiring.CheckType          `json:"check_type"`
	Outcome      applications.CheckOutcome `json:"outcome"`
	Notes        *applications.ResultNotes `json:"notes,omitempty"`
	ReportURL    *profile.WebsiteURL       `json:"report_url,omitempty"`
}

func (r *RecordBackgroundCheckResultRequest) Normalize() {
	inner := applications.RecordBackgroundCheckResultRequest{Notes: r.Notes, ReportURL: r.ReportURL}
	inner.Normalize()
	r.Notes, r.ReportURL = inner.Notes, inner.ReportURL
}

func (r RecordBackgroundCheckResultRequest) Validate() []string {
	fields := WorkReference{EngagementID: r.EngagementID, WorkID: r.WorkID}.validate()
	inner := applications.RecordBackgroundCheckResultRequest{
		OpeningNumber: reference().OpeningNumber, ApplicationNumber: reference().ApplicationNumber,
		Version: reference().Version, CheckType: r.CheckType, Outcome: r.Outcome,
		Notes: r.Notes, ReportURL: r.ReportURL,
	}
	return append(fields, inner.Validate()...)
}
