// Package applications holds the Orgs contract for reading an Opening's
// applications (agent-guides/hiring-pipeline.md).
package applications

import (
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	// MaxCoverNote is the most code points an application's cover note holds.
	MaxCoverNote  = 5000
	minNameQuery  = 2
	maxNameQuery  = 100
	maxStateCount = 8
)

type ApplicationNumber int32
type ApplicationVersion int32
type ApplicationCoverNote string
type ApplicantNameQuery string
type ApplicationState string
type ApplicationView string
type StageStatus string
type ApplicationHistoryAction string
type ApplicationActorKind string
type OfferLetterID string
type OfferNumber int32
type OfferResponseDays int32
type OfferStatus string

// CalendarDate is a `YYYY-MM-DD` date with no time or zone.
type CalendarDate string

const calendarDateLayout = "2006-01-02"

const (
	Submitted      ApplicationState = "submitted"
	InPipeline     ApplicationState = "in_pipeline"
	Offered        ApplicationState = "offered"
	OfferAccepted  ApplicationState = "offer_accepted"
	OfferDeclined  ApplicationState = "offer_declined"
	Joined         ApplicationState = "joined"
	DidNotJoin     ApplicationState = "did_not_join"
	NotProgressing ApplicationState = "not_progressing"
	Withdrawn      ApplicationState = "withdrawn"
)

const (
	ApplicantsView ApplicationView = "applicants"
	CandidatesView ApplicationView = "candidates"
)

const (
	StagePending   StageStatus = "pending"
	StageCompleted StageStatus = "completed"
	StageSkipped   StageStatus = "skipped"
)

const (
	AppliedAction        ApplicationHistoryAction = "applied"
	ShortlistedAction    ApplicationHistoryAction = "shortlisted"
	StageMovedAction     ApplicationHistoryAction = "stage_moved"
	OfferExtendedAction  ApplicationHistoryAction = "offer_extended"
	OfferWithdrawnAction ApplicationHistoryAction = "offer_withdrawn"
	OfferAcceptedAction  ApplicationHistoryAction = "offer_accepted"
	OfferDeclinedAction  ApplicationHistoryAction = "offer_declined"
	JoinedAction         ApplicationHistoryAction = "joined"
	DidNotJoinAction     ApplicationHistoryAction = "did_not_join"
	NotProgressingAction ApplicationHistoryAction = "not_progressing"
	WithdrawnAction      ApplicationHistoryAction = "withdrawn"

	StageCompletedAction     ApplicationHistoryAction = "stage_completed"
	SeparatedAction          ApplicationHistoryAction = "separated"
	JoinedCorrectedAction    ApplicationHistoryAction = "joined_corrected"
	SeparatedCorrectedAction ApplicationHistoryAction = "separated_corrected"
)

const (
	ApplicantActor ApplicationActorKind = "applicant"
	OrgUserActor   ApplicationActorKind = "org_user"
	SystemActor    ApplicationActorKind = "system"
)

const (
	OfferStatusExtended  OfferStatus = "extended"
	OfferStatusAccepted  OfferStatus = "accepted"
	OfferStatusDeclined  OfferStatus = "declined"
	OfferStatusExpired   OfferStatus = "expired"
	OfferStatusWithdrawn OfferStatus = "withdrawn"
)

const (
	// MaxOfferLetterBytes bounds an offer letter's PDF body.
	MaxOfferLetterBytes = 5 * 1024 * 1024
	// OfferLetterContentType is the only type an offer letter is uploaded as.
	OfferLetterContentType = "application/pdf"
	minOfferResponseDays   = 1
	maxOfferResponseDays   = 60
)

var offerStatuses = []OfferStatus{
	OfferStatusExtended, OfferStatusAccepted, OfferStatusDeclined,
	OfferStatusExpired, OfferStatusWithdrawn,
}

// OfferStatuses returns every offer status this contract version defines.
func OfferStatuses() []OfferStatus { return slices.Clone(offerStatuses) }

func IsOfferStatus(value OfferStatus) bool {
	return slices.Contains(offerStatuses, value)
}

func IsOfferNumber(value OfferNumber) bool { return value >= 1 }

func IsOfferResponseDays(value OfferResponseDays) bool {
	return value >= minOfferResponseDays && value <= maxOfferResponseDays
}

var uuidPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsOfferLetterID accepts the lowercase form the API returns.
func IsOfferLetterID(value OfferLetterID) bool {
	return uuidPattern.MatchString(string(value))
}

// IsPDF reports whether body starts with the PDF signature.
func IsPDF(body []byte) bool {
	return len(body) >= 5 && string(body[:5]) == "%PDF-"
}

var applicationStates = []ApplicationState{
	Submitted, InPipeline, Offered, OfferAccepted, OfferDeclined, Joined,
	DidNotJoin, NotProgressing, Withdrawn,
}

var stageStatuses = []StageStatus{StagePending, StageCompleted, StageSkipped}

// ApplicationStates returns every state this contract version defines.
func ApplicationStates() []ApplicationState {
	return slices.Clone(applicationStates)
}

// StageStatuses returns every stage status this contract version defines.
func StageStatuses() []StageStatus { return slices.Clone(stageStatuses) }

func IsApplicationState(value ApplicationState) bool {
	return slices.Contains(applicationStates, value)
}

func IsApplicationView(value ApplicationView) bool {
	return value == ApplicantsView || value == CandidatesView
}

func IsStageStatus(value StageStatus) bool {
	return slices.Contains(stageStatuses, value)
}

// IsCandidacy reports whether an application in state is a candidate:
// shortlisted and neither finished nor ended.
func IsCandidacy(state ApplicationState) bool {
	switch state {
	case InPipeline, Offered, OfferAccepted:
		return true
	default:
		return false
	}
}

// ParseCalendarDate reads a canonical `YYYY-MM-DD` date as midnight UTC.
func ParseCalendarDate(value CalendarDate) (time.Time, bool) {
	parsed, err := time.Parse(calendarDateLayout, string(value))
	if err != nil || parsed.Format(calendarDateLayout) != string(value) {
		return time.Time{}, false
	}
	return parsed, true
}

func IsCalendarDate(value CalendarDate) bool {
	_, ok := ParseCalendarDate(value)
	return ok
}

// FormatCalendarDate renders the UTC calendar date of instant.
func FormatCalendarDate(instant time.Time) CalendarDate {
	return CalendarDate(instant.UTC().Format(calendarDateLayout))
}

func IsApplicationNumber(value ApplicationNumber) bool { return value >= 1 }

func IsApplicationCoverNote(value ApplicationCoverNote) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= MaxCoverNote
}

func NormalizeApplicantNameQuery(value ApplicantNameQuery) ApplicantNameQuery {
	return ApplicantNameQuery(strings.TrimSpace(string(value)))
}

// IsApplicantNameQuery reports a trimmed query of 2 to 100 code points.
func IsApplicantNameQuery(value ApplicantNameQuery) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= minNameQuery && length <= maxNameQuery &&
		value == NormalizeApplicantNameQuery(value)
}

type ApplicationSummary struct {
	ApplicationNumber ApplicationNumber     `json:"application_number"`
	State             ApplicationState      `json:"state"`
	Version           ApplicationVersion    `json:"version"`
	DisplayName       common.DisplayName    `json:"display_name"`
	ResidentCountry   common.CountryCode    `json:"resident_country"`
	CurrentStage      *hiring.PipelineStage `json:"current_stage,omitempty"`
	SubmittedAt       time.Time             `json:"submitted_at"`
	UpdatedAt         time.Time             `json:"updated_at"`
}

type ApplicationStageRecord struct {
	Stage  hiring.PipelineStage `json:"stage"`
	Status StageStatus          `json:"status"`
}

type ApplicationOffer struct {
	OfferNumber         OfferNumber   `json:"offer_number"`
	Status              OfferStatus   `json:"status"`
	LetterURL           string        `json:"letter_url"`
	LetterByteSize      int32         `json:"letter_byte_size"`
	ProposedJoiningDate *CalendarDate `json:"proposed_joining_date,omitempty"`
	RespondBy           time.Time     `json:"respond_by"`
	ExtendedAt          time.Time     `json:"extended_at"`
	EndedAt             *time.Time    `json:"ended_at,omitempty"`
}

type ApplicationDetail struct {
	OpeningNumber     openings.OpeningNumber    `json:"opening_number"`
	ApplicationNumber ApplicationNumber         `json:"application_number"`
	State             ApplicationState          `json:"state"`
	Version           ApplicationVersion        `json:"version"`
	Snapshot          profile.ApplicantSnapshot `json:"snapshot"`
	CoverNote         *ApplicationCoverNote     `json:"cover_note,omitempty"`
	CurrentStage      *hiring.PipelineStage     `json:"current_stage,omitempty"`
	StageRecords      []ApplicationStageRecord  `json:"stage_records"`
	JoinedOn          *CalendarDate             `json:"joined_on,omitempty"`
	SeparatedOn       *CalendarDate             `json:"separated_on,omitempty"`
	Positions         int32                     `json:"positions"`
	JoinedCount       int32                     `json:"joined_count"`
	Offers            []ApplicationOffer        `json:"offers"`
	SubmittedAt       time.Time                 `json:"submitted_at"`
	UpdatedAt         time.Time                 `json:"updated_at"`
}

type ApplicationHistoryEntry struct {
	Action      ApplicationHistoryAction `json:"action"`
	Actor       ApplicationActorKind     `json:"actor"`
	ActorEmail  *common.EmailAddress     `json:"actor_email,omitempty"`
	State       ApplicationState         `json:"state"`
	Version     ApplicationVersion       `json:"version"`
	Stage       *hiring.PipelineStage    `json:"stage,omitempty"`
	JoinedOn    *CalendarDate            `json:"joined_on,omitempty"`
	SeparatedOn *CalendarDate            `json:"separated_on,omitempty"`
	CreatedAt   time.Time                `json:"created_at"`
}

type ApplicationStateCount struct {
	State ApplicationState `json:"state"`
	Count int32            `json:"count"`
}

type StageApplicationCount struct {
	Stage hiring.PipelineStage `json:"stage"`
	Count int32                `json:"count"`
}

type ApplicationCounts struct {
	OpeningNumber openings.OpeningNumber  `json:"opening_number"`
	States        []ApplicationStateCount `json:"states"`
	Stages        []StageApplicationCount `json:"stages"`
}

type ListApplicationsRequest struct {
	OpeningNumber openings.OpeningNumber  `json:"opening_number"`
	View          ApplicationView         `json:"view"`
	States        []ApplicationState      `json:"states,omitempty"`
	StageID       *hiring.PipelineStageID `json:"stage_id,omitempty"`
	NameQuery     *ApplicantNameQuery     `json:"name_query,omitempty"`
	PaginationKey *common.PaginationKey   `json:"pagination_key,omitempty"`
	Limit         *common.PageSize        `json:"limit,omitempty"`
}

func (r *ListApplicationsRequest) Normalize() {
	if r.NameQuery != nil {
		query := NormalizeApplicantNameQuery(*r.NameQuery)
		r.NameQuery = &query
	}
}

func (r ListApplicationsRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListApplicationsRequest) Validate() []string {
	fields := []string{}
	if r.OpeningNumber < 1 {
		fields = append(fields, "opening_number")
	}
	viewValid := IsApplicationView(r.View)
	if !viewValid {
		fields = append(fields, "view")
	}
	// The Applicants view is exactly the `submitted` applications, so the
	// candidacy filters have nothing to select there.
	candidates := viewValid && r.View == CandidatesView
	if r.States != nil {
		valid := candidates && len(r.States) >= 1 &&
			len(r.States) <= maxStateCount
		seen := map[ApplicationState]bool{}
		for _, state := range r.States {
			if !IsApplicationState(state) || state == Submitted || seen[state] {
				valid = false
			}
			seen[state] = true
		}
		if !valid {
			fields = append(fields, "states")
		}
	}
	if r.StageID != nil &&
		(!candidates || !hiring.IsPipelineStageID(*r.StageID)) {
		fields = append(fields, "stage_id")
	}
	if r.NameQuery != nil && !IsApplicantNameQuery(*r.NameQuery) {
		fields = append(fields, "name_query")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && !common.IsPageSize(*r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListApplicationsResponse struct {
	Applications      []ApplicationSummary  `json:"applications"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type GetApplicationRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
}

func (r *GetApplicationRequest) Normalize() {}

func (r GetApplicationRequest) Validate() []string {
	return validateNumbers(r.OpeningNumber, r.ApplicationNumber)
}

type GetApplicationCountsRequest struct {
	OpeningNumber openings.OpeningNumber `json:"opening_number"`
}

func (r *GetApplicationCountsRequest) Normalize() {}

func (r GetApplicationCountsRequest) Validate() []string {
	if r.OpeningNumber < 1 {
		return []string{"opening_number"}
	}
	return []string{}
}

type ListApplicationHistoryRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	PaginationKey     *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit             *common.PageSize       `json:"limit,omitempty"`
}

func (r *ListApplicationHistoryRequest) Normalize() {}

func (r ListApplicationHistoryRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListApplicationHistoryRequest) Validate() []string {
	fields := validateNumbers(r.OpeningNumber, r.ApplicationNumber)
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && !common.IsPageSize(*r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListApplicationHistoryResponse struct {
	Entries           []ApplicationHistoryEntry `json:"entries"`
	NextPaginationKey *common.PaginationKey     `json:"next_pagination_key,omitempty"`
}

func validateNumbers(
	opening openings.OpeningNumber, application ApplicationNumber,
) []string {
	fields := []string{}
	if opening < 1 {
		fields = append(fields, "opening_number")
	}
	if !IsApplicationNumber(application) {
		fields = append(fields, "application_number")
	}
	return fields
}

// ApplicationReference names an application at the version the caller read.
type ApplicationReference struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
}

func (r ApplicationReference) validate() []string {
	fields := validateNumbers(r.OpeningNumber, r.ApplicationNumber)
	if r.Version < 1 {
		fields = append(fields, "version")
	}
	return fields
}

// ApplicationActionRequest names no input beyond the application: complete
// the current review stage, mark not progressing, or record did not join.
type ApplicationActionRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
}

func (r *ApplicationActionRequest) Normalize() {}

func (r ApplicationActionRequest) Validate() []string {
	return ApplicationReference(r).validate()
}

// ApplicationStageRequest shortlists to, or moves forward to, a stage.
type ApplicationStageRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	StageID           hiring.PipelineStageID `json:"stage_id"`
}

func (r *ApplicationStageRequest) Normalize() {}

func (r ApplicationStageRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !hiring.IsPipelineStageID(r.StageID) {
		fields = append(fields, "stage_id")
	}
	return fields
}

// ApplicationJoinedOnRequest records or corrects the joining date. The date
// rules that need the application (the offer, the clock) are the API's.
type ApplicationJoinedOnRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	JoinedOn          CalendarDate           `json:"joined_on"`
}

func (r *ApplicationJoinedOnRequest) Normalize() {}

func (r ApplicationJoinedOnRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsCalendarDate(r.JoinedOn) {
		fields = append(fields, "joined_on")
	}
	return fields
}

// ApplicationSeparatedOnRequest records or corrects the separation date.
type ApplicationSeparatedOnRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	SeparatedOn       CalendarDate           `json:"separated_on"`
}

func (r *ApplicationSeparatedOnRequest) Normalize() {}

func (r ApplicationSeparatedOnRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsCalendarDate(r.SeparatedOn) {
		fields = append(fields, "separated_on")
	}
	return fields
}

// ExtendApplicationOfferRequest extends an offer with a letter the caller
// uploaded. The rules that need the clock (the joining date at least today)
// are the API's.
type ExtendApplicationOfferRequest struct {
	OpeningNumber       openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber   ApplicationNumber      `json:"application_number"`
	Version             ApplicationVersion     `json:"version"`
	LetterID            OfferLetterID          `json:"letter_id"`
	ProposedJoiningDate *CalendarDate          `json:"proposed_joining_date,omitempty"`
	RespondWithinDays   OfferResponseDays      `json:"respond_within_days"`
}

func (r *ExtendApplicationOfferRequest) Normalize() {}

func (r ExtendApplicationOfferRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsOfferLetterID(r.LetterID) {
		fields = append(fields, "letter_id")
	}
	if r.ProposedJoiningDate != nil && !IsCalendarDate(*r.ProposedJoiningDate) {
		fields = append(fields, "proposed_joining_date")
	}
	if !IsOfferResponseDays(r.RespondWithinDays) {
		fields = append(fields, "respond_within_days")
	}
	return fields
}

type OfferLetterUploaded struct {
	LetterID OfferLetterID `json:"letter_id"`
}
