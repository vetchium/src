package hub

import (
	"vetchium-api-server.typespec/common"
)

const (
	coverLetterMin  = 100
	coverLetterMax  = 5000
	endorserMax     = 10
	endorsementNote = 500
	rejectionNote   = 2000
)

// Error messages
const (
	errCoverLetterRequired = "cover_letter is required"
	errCoverLetterTooShort = "cover_letter must be at least 100 characters"
	errCoverLetterTooLong  = "cover_letter must be at most 5000 characters"
	errResumeRequired      = "resume is required"
	errEndorsersOverLimit  = "endorser_handles cannot exceed 10"
)

type ApplicationState string

const (
	ApplicationStateApplied     ApplicationState = "applied"
	ApplicationStateShortlisted ApplicationState = "shortlisted"
	ApplicationStateRejected    ApplicationState = "rejected"
	ApplicationStateWithdrawn   ApplicationState = "withdrawn"
	ApplicationStateExpired     ApplicationState = "expired"
)

type ApplicationColorLabel string

const (
	ApplicationColorLabelGreen  ApplicationColorLabel = "green"
	ApplicationColorLabelYellow ApplicationColorLabel = "yellow"
	ApplicationColorLabelRed    ApplicationColorLabel = "red"
)

type ApplyForOpeningRequest struct {
	OrgDomain                string   `json:"org_domain"`
	OpeningNumber            int32    `json:"opening_number"`
	CoverLetter              string   `json:"cover_letter"`
	ResumeUploadID           string   `json:"resume_upload_id"`
	EndorserHandles          []string `json:"endorser_handles,omitempty"`
	EndorsementRequestNote   *string  `json:"endorsement_request_note,omitempty"`
	NotifyColleaguesAtTarget *bool    `json:"notify_colleagues_at_target,omitempty"`
}

type ApplyForOpeningResponse struct {
	ApplicationID string `json:"application_id"`
}

type CannotApplyError struct {
	Code                string   `json:"code"`
	EarliestNextApplyAt *string  `json:"earliest_next_apply_at,omitempty"`
	OffendingHandles    []string `json:"offending_handles,omitempty"`
}

type WithdrawApplicationRequest struct {
	ApplicationID string `json:"application_id"`
}

type HubApplicationSummary struct {
	ApplicationID    string                 `json:"application_id"`
	OrgDomain        string                 `json:"org_domain"`
	OrgName          string                 `json:"org_name"`
	OpeningNumber    int32                  `json:"opening_number"`
	OpeningTitle     string                 `json:"opening_title"`
	State            ApplicationState       `json:"state"`
	Label            *ApplicationColorLabel `json:"label,omitempty"`
	EndorsementCount int32                  `json:"endorsement_count"`
	AppliedAt        string                 `json:"applied_at"`
	StateChangedAt   string                 `json:"state_changed_at"`
}

type HubApplication struct {
	ApplicationID            string                       `json:"application_id"`
	OrgDomain                string                       `json:"org_domain"`
	OrgName                  string                       `json:"org_name"`
	OpeningNumber            int32                        `json:"opening_number"`
	OpeningTitle             string                       `json:"opening_title"`
	State                    ApplicationState             `json:"state"`
	Label                    *ApplicationColorLabel       `json:"label,omitempty"`
	AIScore                  *float64                     `json:"ai_score,omitempty"`
	AppliedAt                string                       `json:"applied_at"`
	StateChangedAt           string                       `json:"state_changed_at"`
	CoverLetter              string                       `json:"cover_letter"`
	ResumeDownloadURL        string                       `json:"resume_download_url"`
	Endorsements             []MyEndorsementOnApplication `json:"endorsements"`
	EndorsementRequests      []MyEndorsementRequestSent   `json:"endorsement_requests"`
	NotifyColleaguesAtTarget bool                         `json:"notify_colleagues_at_target"`
	CandidacyID              *string                      `json:"candidacy_id,omitempty"`
}

type MyEndorsementOnApplication struct {
	EndorsementID       string  `json:"endorsement_id"`
	EndorserHandle      string  `json:"endorser_handle"`
	EndorserDisplayName string  `json:"endorser_display_name"`
	SharedDomain        string  `json:"shared_domain"`
	OverlapStartYear    int32   `json:"overlap_start_year"`
	OverlapEndYear      int32   `json:"overlap_end_year"`
	IsReferral          bool    `json:"is_referral"`
	IsUnsolicited       bool    `json:"is_unsolicited"`
	Text                string  `json:"text"`
	HiddenByCandidate   bool    `json:"hidden_by_candidate"`
	WrittenAt           string  `json:"written_at"`
	EditedAt            *string `json:"edited_at,omitempty"`
}

type MyEndorsementRequestSent struct {
	RequestID           string `json:"request_id"`
	EndorserHandle      string `json:"endorser_handle"`
	EndorserDisplayName string `json:"endorser_display_name"`
	SharedDomain        string `json:"shared_domain"`
	OverlapStartYear    int32  `json:"overlap_start_year"`
	OverlapEndYear      int32  `json:"overlap_end_year"`
	State               string `json:"state"`
	RequestedAt         string `json:"requested_at"`
}

type ListMyApplicationsRequest struct {
	FilterState   []ApplicationState `json:"filter_state,omitempty"`
	PaginationKey *string            `json:"pagination_key,omitempty"`
	Limit         *int32             `json:"limit,omitempty"`
}

type ListMyApplicationsResponse struct {
	Applications      []HubApplicationSummary `json:"applications"`
	NextPaginationKey *string                 `json:"next_pagination_key,omitempty"`
}

type GetMyApplicationRequest struct {
	ApplicationID string `json:"application_id"`
}

// Validation functions
func (r *WithdrawApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *ListMyApplicationsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}

func (r *GetMyApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "application_id",
			Message: "is required",
		})
	}

	return errs
}
