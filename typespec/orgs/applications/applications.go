// Package applications holds the Orgs contract for reading an Opening's
// applications (agent-guides/hiring-pipeline.md).
package applications

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"
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
type MyInterviewView string
type StageStatus string
type ApplicationHistoryAction string
type ApplicationActorKind string
type OfferLetterID string
type OfferNumber int32
type OfferResponseDays int32
type OfferStatus string
type InterviewNumber int32
type InterviewDurationMinutes int32
type InterviewLocation string
type InterviewRescheduleNote string
type InterviewFeedbackNotes string
type InterviewMode string
type InterviewState string
type InterviewResponse string
type InterviewRecommendation string
type InterviewOutcome string
type PendingApplicantAction string
type AssessmentOutcome string
type AssessmentScore int32
type ResultNotes string
type CheckOutcome string
type BackgroundCheckNumber int32
type ConsentState string
type WorkPerformer string

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
	UpcomingInterviewsView    MyInterviewView = "upcoming"
	FeedbackDueInterviewsView MyInterviewView = "feedback_due"
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

	InterviewScheduledAction  ApplicationHistoryAction = "interview_scheduled"
	InterviewChangedAction    ApplicationHistoryAction = "interview_changed"
	InterviewCancelledAction  ApplicationHistoryAction = "interview_cancelled"
	InterviewCompletedAction  ApplicationHistoryAction = "interview_completed"
	InterviewNoShowAction     ApplicationHistoryAction = "interview_no_show"
	InterviewAcceptedAction   ApplicationHistoryAction = "interview_accepted"
	InterviewRescheduleAction ApplicationHistoryAction = "interview_reschedule_requested"
	InterviewFeedbackAction   ApplicationHistoryAction = "interview_feedback_submitted"

	AssessmentRecordedAction    ApplicationHistoryAction = "assessment_recorded"
	ConsentRequestedAction      ApplicationHistoryAction = "background_check_consent_requested"
	ConsentGivenAction          ApplicationHistoryAction = "background_check_consent_given"
	ConsentDeclinedAction       ApplicationHistoryAction = "background_check_consent_declined"
	BackgroundCheckResultAction ApplicationHistoryAction = "background_check_result_recorded"

	RoutedAction ApplicationHistoryAction = "routed"

	RemovedAction ApplicationHistoryAction = "removed"
)

const (
	// MaxInterviewsPerStage bounds the interviews of one candidacy at one
	// interview stage that are not cancelled (HP-WRK-002).
	MaxInterviewsPerStage = 10
	// MaxInterviewers bounds the interviewers of one interview.
	MaxInterviewers = 10
	// MaxInterviewLocation, MaxRescheduleNote, and MaxFeedbackNotes bound
	// their texts in code points.
	MaxInterviewLocation = 500
	MaxRescheduleNote    = 500
	MaxFeedbackNotes     = 10000
	minInterviewDuration = 15
	maxInterviewDuration = 480
)

const (
	InterviewVideo    InterviewMode = "video"
	InterviewInPerson InterviewMode = "in_person"
)

const (
	InterviewScheduled InterviewState = "scheduled"
	InterviewCompleted InterviewState = "completed"
	InterviewNoShow    InterviewState = "no_show"
	InterviewCancelled InterviewState = "cancelled"
)

const (
	ResponsePending           InterviewResponse = "pending"
	ResponseAccepted          InterviewResponse = "accepted"
	ResponseRescheduleRequest InterviewResponse = "reschedule_requested"
)

const (
	StrongYes InterviewRecommendation = "strong_yes"
	Yes       InterviewRecommendation = "yes"
	No        InterviewRecommendation = "no"
	StrongNo  InterviewRecommendation = "strong_no"
)

const (
	OutcomeCompleted InterviewOutcome = "completed"
	OutcomeNoShow    InterviewOutcome = "no_show"
)

const (
	InterviewResponseAction      PendingApplicantAction = "interview_response"
	BackgroundCheckConsentAction PendingApplicantAction = "background_check_consent"
	OfferResponseAction          PendingApplicantAction = "offer_response"
)

const (
	AssessmentPass         AssessmentOutcome = "pass"
	AssessmentFail         AssessmentOutcome = "fail"
	AssessmentInconclusive AssessmentOutcome = "inconclusive"
)

const (
	CheckClear          CheckOutcome = "clear"
	CheckDiscrepancy    CheckOutcome = "discrepancy"
	CheckUnableToVerify CheckOutcome = "unable_to_verify"
)

const (
	ConsentRequested ConsentState = "requested"
	ConsentGiven     ConsentState = "given"
	ConsentDeclined  ConsentState = "declined"
	ConsentEnded     ConsentState = "ended"
)

// PerformerOrg is the Org doing the stage's work itself.
const (
	PerformerOrg      WorkPerformer = "org"
	PerformerProvider WorkPerformer = "provider"
)

const (
	// MaxResultNotes bounds the notes of an assessment or a check in code
	// points.
	MaxResultNotes = 2000
	// MaxAssessmentScore bounds an assessment score; the minimum is 0.
	MaxAssessmentScore = 100
)

var (
	interviewModes  = []InterviewMode{InterviewVideo, InterviewInPerson}
	interviewStates = []InterviewState{
		InterviewScheduled, InterviewCompleted, InterviewNoShow,
		InterviewCancelled,
	}
	interviewResponses = []InterviewResponse{
		ResponsePending, ResponseAccepted, ResponseRescheduleRequest,
	}
	interviewRecommendations = []InterviewRecommendation{
		StrongYes, Yes, No, StrongNo,
	}
	pendingApplicantActions = []PendingApplicantAction{
		InterviewResponseAction, BackgroundCheckConsentAction,
		OfferResponseAction,
	}
	assessmentOutcomes = []AssessmentOutcome{
		AssessmentPass, AssessmentFail, AssessmentInconclusive,
	}
	checkOutcomes = []CheckOutcome{
		CheckClear, CheckDiscrepancy, CheckUnableToVerify,
	}
	consentStates = []ConsentState{
		ConsentRequested, ConsentGiven, ConsentDeclined, ConsentEnded,
	}
	workPerformers = []WorkPerformer{PerformerOrg, PerformerProvider}
)

// AssessmentOutcomes returns every assessment outcome this contract version
// defines.
func AssessmentOutcomes() []AssessmentOutcome {
	return slices.Clone(assessmentOutcomes)
}

// CheckOutcomes returns every background-check outcome this contract version
// defines.
func CheckOutcomes() []CheckOutcome { return slices.Clone(checkOutcomes) }

// ConsentStates returns every consent state this contract version defines.
func ConsentStates() []ConsentState { return slices.Clone(consentStates) }

// WorkPerformers returns every performer this contract version defines.
func WorkPerformers() []WorkPerformer { return slices.Clone(workPerformers) }

func IsAssessmentOutcome(value AssessmentOutcome) bool {
	return slices.Contains(assessmentOutcomes, value)
}

func IsCheckOutcome(value CheckOutcome) bool {
	return slices.Contains(checkOutcomes, value)
}

func IsConsentState(value ConsentState) bool {
	return slices.Contains(consentStates, value)
}

func IsWorkPerformer(value WorkPerformer) bool {
	return slices.Contains(workPerformers, value)
}

func IsAssessmentScore(value AssessmentScore) bool {
	return value >= 0 && value <= MaxAssessmentScore
}

func IsBackgroundCheckNumber(value BackgroundCheckNumber) bool {
	return value >= 1
}

// IsResultNotes reports trimmed notes of 1 to 2,000 code points.
func IsResultNotes(value ResultNotes) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= MaxResultNotes &&
		string(value) == strings.TrimSpace(string(value))
}

// normalizedResultNotes trims the notes and drops blank ones, assigning a new
// pointer and never mutating the caller's note.
func normalizedResultNotes(notes *ResultNotes) *ResultNotes {
	if notes == nil {
		return nil
	}
	trimmed := ResultNotes(strings.TrimSpace(string(*notes)))
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizedReportURL(link *profile.WebsiteURL) *profile.WebsiteURL {
	if link == nil {
		return nil
	}
	normalized := profile.NormalizeWebsiteURL(*link)
	return &normalized
}

func validResultDetails(
	notes *ResultNotes, link *profile.WebsiteURL,
) []string {
	fields := []string{}
	if notes != nil && !IsResultNotes(*notes) {
		fields = append(fields, "notes")
	}
	if link != nil && !profile.IsWebsiteURL(*link) {
		fields = append(fields, "report_url")
	}
	return fields
}

// InterviewModes returns every mode this contract version defines.
func InterviewModes() []InterviewMode { return slices.Clone(interviewModes) }

// InterviewStates returns every interview state this contract version
// defines.
func InterviewStates() []InterviewState { return slices.Clone(interviewStates) }

// InterviewResponses returns every applicant response this contract version
// defines.
func InterviewResponses() []InterviewResponse {
	return slices.Clone(interviewResponses)
}

// InterviewRecommendations returns every recommendation this contract
// version defines.
func InterviewRecommendations() []InterviewRecommendation {
	return slices.Clone(interviewRecommendations)
}

// PendingApplicantActions returns every filter value this contract version
// defines.
func PendingApplicantActions() []PendingApplicantAction {
	return slices.Clone(pendingApplicantActions)
}

func IsInterviewMode(value InterviewMode) bool {
	return slices.Contains(interviewModes, value)
}

func IsInterviewState(value InterviewState) bool {
	return slices.Contains(interviewStates, value)
}

func IsInterviewResponse(value InterviewResponse) bool {
	return slices.Contains(interviewResponses, value)
}

func IsInterviewRecommendation(value InterviewRecommendation) bool {
	return slices.Contains(interviewRecommendations, value)
}

func IsPendingApplicantAction(value PendingApplicantAction) bool {
	return slices.Contains(pendingApplicantActions, value)
}

func IsInterviewOutcome(value InterviewOutcome) bool {
	return value == OutcomeCompleted || value == OutcomeNoShow
}

func IsInterviewNumber(value InterviewNumber) bool { return value >= 1 }

func IsInterviewDurationMinutes(value InterviewDurationMinutes) bool {
	return value >= minInterviewDuration && value <= maxInterviewDuration
}

// IsInterviewLocation reports a trimmed place of 1 to 500 code points.
func IsInterviewLocation(value InterviewLocation) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= MaxInterviewLocation &&
		string(value) == strings.TrimSpace(string(value))
}

// IsInterviewRescheduleNote reports a trimmed note of 1 to 500 code points.
func IsInterviewRescheduleNote(value InterviewRescheduleNote) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= MaxRescheduleNote &&
		string(value) == strings.TrimSpace(string(value))
}

// IsInterviewFeedbackNotes reports trimmed notes of 1 to 10,000 code points.
func IsInterviewFeedbackNotes(value InterviewFeedbackNotes) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= MaxFeedbackNotes &&
		string(value) == strings.TrimSpace(string(value))
}

const (
	ApplicantActor ApplicationActorKind = "applicant"
	OrgUserActor   ApplicationActorKind = "org_user"
	ProviderActor  ApplicationActorKind = "provider"
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

func IsMyInterviewView(value MyInterviewView) bool {
	return value == UpcomingInterviewsView || value == FeedbackDueInterviewsView
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
	Removed           bool                  `json:"removed"`
	CurrentStage      *hiring.PipelineStage `json:"current_stage,omitempty"`
	// Route is the provider performing the current stage; absent in-house.
	Route          *marketplace.ApplicationRoute `json:"route,omitempty"`
	CreditedAgency *marketplace.CreditedAgency   `json:"credited_agency,omitempty"`
	ReferralRoute  *marketplace.ReferralRoute    `json:"referral_route,omitempty"`
	// Answers is present, possibly empty, when the request named
	// answer_columns; omitzero keeps an empty list and drops a nil one.
	Answers     []ApplicationAnswer `json:"answers,omitzero"`
	SubmittedAt time.Time           `json:"submitted_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
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

type InterviewerStatus struct {
	Email             common.EmailAddress `json:"email"`
	FeedbackSubmitted bool                `json:"feedback_submitted"`
}

type InterviewFeedback struct {
	InterviewerEmail common.EmailAddress     `json:"interviewer_email"`
	Recommendation   InterviewRecommendation `json:"recommendation"`
	Notes            InterviewFeedbackNotes  `json:"notes"`
	CriteriaAnswers  []AnsweredCriterion     `json:"criteria_answers"`
	SubmittedAt      time.Time               `json:"submitted_at"`
}

// Interview is one interview of a candidacy as the caller may see it:
// Feedback holds the caller's own and, unless the caller is an interviewer
// who has not submitted theirs, everyone's (HP-WRK-004).
type Interview struct {
	InterviewNumber   InterviewNumber          `json:"interview_number"`
	Stage             hiring.PipelineStage     `json:"stage"`
	StartsAt          time.Time                `json:"starts_at"`
	DurationMinutes   InterviewDurationMinutes `json:"duration_minutes"`
	Mode              InterviewMode            `json:"mode"`
	VideoURL          *string                  `json:"video_url,omitempty"`
	Location          *InterviewLocation       `json:"location,omitempty"`
	State             InterviewState           `json:"state"`
	ApplicantResponse InterviewResponse        `json:"applicant_response"`
	RescheduleNote    *InterviewRescheduleNote `json:"reschedule_note,omitempty"`
	Interviewers      []InterviewerStatus      `json:"interviewers"`
	Feedback          []InterviewFeedback      `json:"feedback"`
	// Provider scheduled and holds the interview; absent in-house.
	Provider *marketplace.EngagementCounterparty `json:"provider,omitempty"`
}

// AssessmentResult is the recorded result of an assessment stage.
type AssessmentResult struct {
	Stage           hiring.PipelineStage `json:"stage"`
	Outcome         AssessmentOutcome    `json:"outcome"`
	Score           *AssessmentScore     `json:"score,omitempty"`
	Notes           *ResultNotes         `json:"notes,omitempty"`
	ReportURL       *profile.WebsiteURL  `json:"report_url,omitempty"`
	RecordedByEmail *common.EmailAddress `json:"recorded_by_email,omitempty"`
	RecordedAt      time.Time            `json:"recorded_at"`
	// Provider recorded the result; absent in-house.
	Provider *marketplace.EngagementCounterparty `json:"provider,omitempty"`
}

// BackgroundCheckResult is what one background check found.
type BackgroundCheckResult struct {
	CheckType       hiring.CheckType     `json:"check_type"`
	Outcome         CheckOutcome         `json:"outcome"`
	Notes           *ResultNotes         `json:"notes,omitempty"`
	ReportURL       *profile.WebsiteURL  `json:"report_url,omitempty"`
	RecordedByEmail *common.EmailAddress `json:"recorded_by_email,omitempty"`
	RecordedAt      time.Time            `json:"recorded_at"`
}

// BackgroundCheck is one consent request at a background-check stage with the
// results recorded after consent.
type BackgroundCheck struct {
	CheckNumber  BackgroundCheckNumber `json:"check_number"`
	Stage        hiring.PipelineStage  `json:"stage"`
	ConsentState ConsentState          `json:"consent_state"`
	CheckTypes   []hiring.CheckType    `json:"check_types"`
	Performer    WorkPerformer         `json:"performer"`
	// Provider performs the checks when Performer is `provider`.
	Provider *marketplace.EngagementCounterparty `json:"provider,omitempty"`
	// ConsentDisclosure is the provider's text as copied at routing, which
	// the applicant consents to.
	ConsentDisclosure *string                 `json:"consent_disclosure,omitempty"`
	RequestedAt       time.Time               `json:"requested_at"`
	RespondedAt       *time.Time              `json:"responded_at,omitempty"`
	Results           []BackgroundCheckResult `json:"results"`
}

type ApplicationDetail struct {
	OpeningNumber     openings.OpeningNumber    `json:"opening_number"`
	ApplicationNumber ApplicationNumber         `json:"application_number"`
	State             ApplicationState          `json:"state"`
	Version           ApplicationVersion        `json:"version"`
	Snapshot          profile.ApplicantSnapshot `json:"snapshot"`
	Removed           bool                      `json:"removed"`
	CoverNote         *ApplicationCoverNote     `json:"cover_note,omitempty"`
	CurrentStage      *hiring.PipelineStage     `json:"current_stage,omitempty"`
	// Route is the provider performing the current stage; absent in-house.
	Route            *marketplace.ApplicationRoute `json:"route,omitempty"`
	CreditedAgency   *marketplace.CreditedAgency   `json:"credited_agency,omitempty"`
	ReferralRoute    *marketplace.ReferralRoute    `json:"referral_route,omitempty"`
	Answers          []AnswerRecord                `json:"answers"`
	StageRecords     []ApplicationStageRecord      `json:"stage_records"`
	JoinedOn         *CalendarDate                 `json:"joined_on,omitempty"`
	SeparatedOn      *CalendarDate                 `json:"separated_on,omitempty"`
	Positions        int32                         `json:"positions"`
	JoinedCount      int32                         `json:"joined_count"`
	Offers           []ApplicationOffer            `json:"offers"`
	Interviews       []Interview                   `json:"interviews"`
	Assessments      []AssessmentResult            `json:"assessments"`
	BackgroundChecks []BackgroundCheck             `json:"background_checks"`
	SubmittedAt      time.Time                     `json:"submitted_at"`
	UpdatedAt        time.Time                     `json:"updated_at"`
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
	// InterviewNumber is the interview an interview action concerns.
	InterviewNumber *InterviewNumber `json:"interview_number,omitempty"`
	CreatedAt       time.Time        `json:"created_at"`
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

	// PendingApplicantAction (Candidates view) lists the candidacies with
	// that action awaiting the applicant.
	PendingApplicantAction *PendingApplicantAction `json:"pending_applicant_action,omitempty"`
	// RoutedEngagementID (Candidates view) lists the candidacies routed to
	// that engagement.
	RoutedEngagementID   *marketplace.EngagementID  `json:"routed_engagement_id,omitempty"`
	CreditedAgencyDomain *orgs.OrgDomain            `json:"credited_agency_domain,omitempty"`
	ReferralRoute        *marketplace.ReferralRoute `json:"referral_route,omitempty"`
	// AnswerColumns names live questions whose answers each row returns;
	// list-applications checks them against the live content.
	AnswerColumns []common.ApplicationQuestionID `json:"answer_columns,omitempty"`
	PaginationKey *common.PaginationKey          `json:"pagination_key,omitempty"`
	Limit         *common.PageSize               `json:"limit,omitempty"`
}

func (r *ListApplicationsRequest) Normalize() {
	if r.NameQuery != nil {
		query := NormalizeApplicantNameQuery(*r.NameQuery)
		r.NameQuery = &query
	}
	if r.CreditedAgencyDomain != nil {
		normalized := orgs.NormalizeOrgDomain(*r.CreditedAgencyDomain)
		r.CreditedAgencyDomain = &normalized
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
	if r.PendingApplicantAction != nil &&
		(!candidates || !IsPendingApplicantAction(*r.PendingApplicantAction)) {
		fields = append(fields, "pending_applicant_action")
	}
	if r.RoutedEngagementID != nil &&
		(!candidates || !marketplace.IsEngagementID(*r.RoutedEngagementID)) {
		fields = append(fields, "routed_engagement_id")
	}
	if r.CreditedAgencyDomain != nil && !orgs.IsOrgDomain(*r.CreditedAgencyDomain) {
		fields = append(fields, "credited_agency_domain")
	}
	if r.ReferralRoute != nil && !marketplace.IsReferralRoute(*r.ReferralRoute) {
		fields = append(fields, "referral_route")
	}
	if len(r.AnswerColumns) > MaxAnswerColumns {
		fields = append(fields, "answer_columns")
	}
	for index, id := range r.AnswerColumns {
		if !common.IsApplicationQuestionID(id) || slices.Contains(r.AnswerColumns[:index], id) {
			fields = append(fields, fmt.Sprintf("answer_columns.%d", index))
		}
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

// RouteApplicationRequest routes a candidacy at its current stage to an
// engagement assigned to that stage, or back in-house when EngagementID is
// absent.
type RouteApplicationRequest struct {
	OpeningNumber     openings.OpeningNumber    `json:"opening_number"`
	ApplicationNumber ApplicationNumber         `json:"application_number"`
	Version           ApplicationVersion        `json:"version"`
	EngagementID      *marketplace.EngagementID `json:"engagement_id,omitempty"`
}

func (r *RouteApplicationRequest) Normalize() {}

func (r RouteApplicationRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if r.EngagementID != nil && !marketplace.IsEngagementID(*r.EngagementID) {
		fields = append(fields, "engagement_id")
	}
	return fields
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

// InterviewDetails is what scheduling and changing an interview set.
type InterviewDetails struct {
	StartTime         time.Time                `json:"start_time"`
	DurationMinutes   InterviewDurationMinutes `json:"duration_minutes"`
	Mode              InterviewMode            `json:"mode"`
	VideoURL          *profile.WebsiteURL      `json:"video_url,omitempty"`
	Location          *InterviewLocation       `json:"location,omitempty"`
	InterviewerEmails []common.EmailAddress    `json:"interviewer_emails"`
}

// normalized returns a copy with the link, location, and addresses
// normalized, never mutating the caller's storage.
func (d InterviewDetails) normalized() InterviewDetails {
	d.StartTime = d.StartTime.UTC()
	if d.VideoURL != nil {
		link := profile.NormalizeWebsiteURL(*d.VideoURL)
		d.VideoURL = &link
	}
	if d.Location != nil {
		location := InterviewLocation(strings.TrimSpace(string(*d.Location)))
		d.Location = &location
	}
	if d.InterviewerEmails != nil {
		emails := make([]common.EmailAddress, len(d.InterviewerEmails))
		for index, email := range d.InterviewerEmails {
			emails[index] = common.NormalizeEmailAddress(email)
		}
		d.InterviewerEmails = emails
	}
	return d
}

// validate reports the invalid fields. A video interview names a link and no
// location; an in-person interview a location and no link. That the start is
// in the future is the API's rule, since it needs the clock.
func (d InterviewDetails) validate() []string {
	fields := []string{}
	if d.StartTime.IsZero() {
		fields = append(fields, "start_time")
	}
	if !IsInterviewDurationMinutes(d.DurationMinutes) {
		fields = append(fields, "duration_minutes")
	}
	if !IsInterviewMode(d.Mode) {
		fields = append(fields, "mode")
	} else {
		video := d.Mode == InterviewVideo
		if (d.VideoURL != nil && !profile.IsWebsiteURL(*d.VideoURL)) ||
			(video && d.VideoURL == nil) || (!video && d.VideoURL != nil) {
			fields = append(fields, "video_url")
		}
		if (d.Location != nil && !IsInterviewLocation(*d.Location)) ||
			(!video && d.Location == nil) || (video && d.Location != nil) {
			fields = append(fields, "location")
		}
	}
	if len(d.InterviewerEmails) < 1 || len(d.InterviewerEmails) > MaxInterviewers {
		fields = append(fields, "interviewer_emails")
		return fields
	}
	seen := make(map[common.EmailAddress]bool, len(d.InterviewerEmails))
	for _, email := range d.InterviewerEmails {
		if !common.IsEmailAddress(email) || seen[email] {
			fields = append(fields, "interviewer_emails")
			break
		}
		seen[email] = true
	}
	return fields
}

// ScheduleInterviewRequest schedules an interview for a candidacy.
type ScheduleInterviewRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	InterviewDetails
}

func (r *ScheduleInterviewRequest) Normalize() {
	r.InterviewDetails = r.normalized()
}

func (r ScheduleInterviewRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	return append(fields, r.validate()...)
}

// ChangeInterviewRequest replaces the details of an upcoming interview.
type ChangeInterviewRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	InterviewNumber   InterviewNumber        `json:"interview_number"`
	InterviewDetails
}

func (r *ChangeInterviewRequest) Normalize() {
	r.InterviewDetails = r.normalized()
}

func (r ChangeInterviewRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsInterviewNumber(r.InterviewNumber) {
		fields = append(fields, "interview_number")
	}
	return append(fields, r.validate()...)
}

// CancelInterviewRequest names the interview to cancel.
type CancelInterviewRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	InterviewNumber   InterviewNumber        `json:"interview_number"`
}

func (r *CancelInterviewRequest) Normalize() {}

func (r CancelInterviewRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsInterviewNumber(r.InterviewNumber) {
		fields = append(fields, "interview_number")
	}
	return fields
}

// RecordInterviewOutcomeRequest records completed or no_show after the
// start time; the timing is the API's rule.
type RecordInterviewOutcomeRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	InterviewNumber   InterviewNumber        `json:"interview_number"`
	Outcome           InterviewOutcome       `json:"outcome"`
}

func (r *RecordInterviewOutcomeRequest) Normalize() {}

func (r RecordInterviewOutcomeRequest) Validate() []string {
	fields := CancelInterviewRequest{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version, InterviewNumber: r.InterviewNumber,
	}.Validate()
	if !IsInterviewOutcome(r.Outcome) {
		fields = append(fields, "outcome")
	}
	return fields
}

// SubmitInterviewFeedbackRequest is an interviewer's verdict and notes.
type SubmitInterviewFeedbackRequest struct {
	OpeningNumber     openings.OpeningNumber  `json:"opening_number"`
	ApplicationNumber ApplicationNumber       `json:"application_number"`
	Version           ApplicationVersion      `json:"version"`
	InterviewNumber   InterviewNumber         `json:"interview_number"`
	Recommendation    InterviewRecommendation `json:"recommendation"`
	Notes             InterviewFeedbackNotes  `json:"notes"`
	CriteriaAnswers   []CriterionAnswer       `json:"criteria_answers,omitempty"`
}

// Normalize trims the notes and answers. It assigns new values and never
// mutates storage the caller shares.
func (r *SubmitInterviewFeedbackRequest) Normalize() {
	r.Notes = InterviewFeedbackNotes(strings.TrimSpace(string(r.Notes)))
	r.CriteriaAnswers = NormalizeCriteriaAnswers(r.CriteriaAnswers)
}

func (r SubmitInterviewFeedbackRequest) Validate() []string {
	fields := CancelInterviewRequest{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version, InterviewNumber: r.InterviewNumber,
	}.Validate()
	if !IsInterviewRecommendation(r.Recommendation) {
		fields = append(fields, "recommendation")
	}
	if !IsInterviewFeedbackNotes(r.Notes) {
		fields = append(fields, "notes")
	}
	return append(fields, ValidateCriteriaAnswerShapes(r.CriteriaAnswers)...)
}

type ListMyInterviewsRequest struct {
	View          *MyInterviewView      `json:"view,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *common.PageSize      `json:"limit,omitempty"`
}

func (r *ListMyInterviewsRequest) Normalize() {}

func (r ListMyInterviewsRequest) EffectiveLimit() common.PageSize {
	if r.Limit == nil {
		return 50
	}
	return *r.Limit
}

func (r ListMyInterviewsRequest) Validate() []string {
	fields := []string{}
	if r.View != nil && !IsMyInterviewView(*r.View) {
		fields = append(fields, "view")
	}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && !common.IsPageSize(*r.Limit) {
		fields = append(fields, "limit")
	}
	return fields
}

// MyInterview is an interview the caller is an interviewer of.
type MyInterview struct {
	OpeningNumber     openings.OpeningNumber   `json:"opening_number"`
	ApplicationNumber ApplicationNumber        `json:"application_number"`
	DisplayName       common.DisplayName       `json:"display_name"`
	InterviewNumber   InterviewNumber          `json:"interview_number"`
	StartsAt          time.Time                `json:"starts_at"`
	DurationMinutes   InterviewDurationMinutes `json:"duration_minutes"`
	Mode              InterviewMode            `json:"mode"`
	State             InterviewState           `json:"state"`
	ApplicantResponse InterviewResponse        `json:"applicant_response"`
	FeedbackSubmitted bool                     `json:"feedback_submitted"`
}

type ListMyInterviewsResponse struct {
	Interviews        []MyInterview         `json:"interviews"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// MyInterviewCounts is the size of each view of the caller's interviews.
type MyInterviewCounts struct {
	Upcoming    int32 `json:"upcoming"`
	FeedbackDue int32 `json:"feedback_due"`
}

// RecordAssessmentResultRequest records the result of an assessment stage.
type RecordAssessmentResultRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	Outcome           AssessmentOutcome      `json:"outcome"`
	Score             *AssessmentScore       `json:"score,omitempty"`
	Notes             *ResultNotes           `json:"notes,omitempty"`
	ReportURL         *profile.WebsiteURL    `json:"report_url,omitempty"`
}

// Normalize trims the notes, dropping blank ones, and normalizes the link. It
// assigns new pointers and never mutates what the caller shares.
func (r *RecordAssessmentResultRequest) Normalize() {
	r.Notes = normalizedResultNotes(r.Notes)
	r.ReportURL = normalizedReportURL(r.ReportURL)
}

func (r RecordAssessmentResultRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !IsAssessmentOutcome(r.Outcome) {
		fields = append(fields, "outcome")
	}
	if r.Score != nil && !IsAssessmentScore(*r.Score) {
		fields = append(fields, "score")
	}
	return append(fields, validResultDetails(r.Notes, r.ReportURL)...)
}

// RequestBackgroundCheckConsentRequest asks the applicant to consent to the
// check types.
type RequestBackgroundCheckConsentRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	CheckTypes        []hiring.CheckType     `json:"check_types"`
}

func (r *RequestBackgroundCheckConsentRequest) Normalize() {}

func (r RequestBackgroundCheckConsentRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	valid := len(r.CheckTypes) >= 1 && len(r.CheckTypes) <= MaxCheckTypes
	seen := make(map[hiring.CheckType]bool, len(r.CheckTypes))
	for _, checkType := range r.CheckTypes {
		if !hiring.IsCheckType(checkType) || seen[checkType] {
			valid = false
		}
		seen[checkType] = true
	}
	if !valid {
		fields = append(fields, "check_types")
	}
	return fields
}

// MaxCheckTypes bounds the types one consent request names.
const MaxCheckTypes = 20

// RecordBackgroundCheckResultRequest records one check's result.
type RecordBackgroundCheckResultRequest struct {
	OpeningNumber     openings.OpeningNumber `json:"opening_number"`
	ApplicationNumber ApplicationNumber      `json:"application_number"`
	Version           ApplicationVersion     `json:"version"`
	CheckType         hiring.CheckType       `json:"check_type"`
	Outcome           CheckOutcome           `json:"outcome"`
	Notes             *ResultNotes           `json:"notes,omitempty"`
	ReportURL         *profile.WebsiteURL    `json:"report_url,omitempty"`
}

// Normalize trims the notes, dropping blank ones, and normalizes the link.
func (r *RecordBackgroundCheckResultRequest) Normalize() {
	r.Notes = normalizedResultNotes(r.Notes)
	r.ReportURL = normalizedReportURL(r.ReportURL)
}

func (r RecordBackgroundCheckResultRequest) Validate() []string {
	fields := ApplicationReference{
		OpeningNumber: r.OpeningNumber, ApplicationNumber: r.ApplicationNumber,
		Version: r.Version,
	}.validate()
	if !hiring.IsCheckType(r.CheckType) {
		fields = append(fields, "check_type")
	}
	if !IsCheckOutcome(r.Outcome) {
		fields = append(fields, "outcome")
	}
	return append(fields, validResultDetails(r.Notes, r.ReportURL)...)
}
