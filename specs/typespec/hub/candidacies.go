package hub

import (
	"vetchium-api-server.typespec/common"
)

type CandidacyState string

const (
	CandidacyStateInterviewing           CandidacyState = "interviewing"
	CandidacyStateOffered                CandidacyState = "offered"
	CandidacyStateOfferAccepted          CandidacyState = "offer_accepted"
	CandidacyStateOfferDeclined          CandidacyState = "offer_declined"
	CandidacyStateCandidateUnsuitable    CandidacyState = "candidate_unsuitable"
	CandidacyStateCandidateNotResponding CandidacyState = "candidate_not_responding"
	CandidacyStateEmployerDefunct        CandidacyState = "employer_defunct"
)

type InterviewType string

const (
	InterviewTypeInPerson InterviewType = "in_person"
	InterviewTypeVideo    InterviewType = "video"
	InterviewTypeTakeHome InterviewType = "take_home"
	InterviewTypeOther    InterviewType = "other"
)

type InterviewState string

const (
	InterviewStateScheduled InterviewState = "scheduled"
	InterviewStateCompleted InterviewState = "completed"
	InterviewStateCancelled InterviewState = "cancelled"
)

type InterviewRSVP string

const (
	InterviewRSVPYes InterviewRSVP = "yes"
	InterviewRSVPNo  InterviewRSVP = "no"
)

type HubCandidacySummary struct {
	CandidacyID      string         `json:"candidacy_id"`
	ApplicationID    string         `json:"application_id"`
	OrgDomain        string         `json:"org_domain"`
	OrgName          string         `json:"org_name"`
	OpeningTitle     string         `json:"opening_title"`
	State            CandidacyState `json:"state"`
	CreatedAt        string         `json:"created_at"`
	StateChangedAt   string         `json:"state_changed_at"`
	LatestActivityAt string         `json:"latest_activity_at"`
}

type HubInterview struct {
	InterviewID            string         `json:"interview_id"`
	InterviewType          InterviewType  `json:"interview_type"`
	StartsAt               string         `json:"starts_at"`
	EndsAt                 string         `json:"ends_at"`
	Description            *string        `json:"description,omitempty"`
	InterviewLocation      *string        `json:"interview_location,omitempty"`
	State                  InterviewState `json:"state"`
	CandidateRSVP          *InterviewRSVP `json:"candidate_rsvp,omitempty"`
	InterviewerRSVPSummary struct {
		Total   int32 `json:"total"`
		Yes     int32 `json:"yes"`
		No      int32 `json:"no"`
		Pending int32 `json:"pending"`
	} `json:"interviewer_rsvp_summary"`
}

type CandidacyComment struct {
	CommentID    string  `json:"comment_id"`
	AuthorKind   string  `json:"author_kind"`
	AuthorHandle *string `json:"author_handle,omitempty"`
	Body         string  `json:"body"`
	CreatedAt    string  `json:"created_at"`
}

type HubOfferView struct {
	ExtendedAt     string   `json:"extended_at"`
	SalaryCurrency *string  `json:"salary_currency,omitempty"`
	SalaryAmount   *float64 `json:"salary_amount,omitempty"`
	StartDate      *string  `json:"start_date,omitempty"`
	Notes          *string  `json:"notes,omitempty"`
}

type HubCandidacy struct {
	CandidacyID    string             `json:"candidacy_id"`
	ApplicationID  string             `json:"application_id"`
	OrgDomain      string             `json:"org_domain"`
	OrgName        string             `json:"org_name"`
	OpeningNumber  int32              `json:"opening_number"`
	OpeningTitle   string             `json:"opening_title"`
	State          CandidacyState     `json:"state"`
	CreatedAt      string             `json:"created_at"`
	StateChangedAt string             `json:"state_changed_at"`
	Interviews     []HubInterview     `json:"interviews"`
	Comments       []CandidacyComment `json:"comments"`
	Offer          *HubOfferView      `json:"offer,omitempty"`
}

type ListMyCandidaciesRequest struct {
	FilterState   []CandidacyState `json:"filter_state,omitempty"`
	PaginationKey *string          `json:"pagination_key,omitempty"`
	Limit         *int32           `json:"limit,omitempty"`
}

type ListMyCandidaciesResponse struct {
	Candidacies       []HubCandidacySummary `json:"candidacies"`
	NextPaginationKey *string               `json:"next_pagination_key,omitempty"`
}

type GetMyCandidacyRequest struct {
	CandidacyID string `json:"candidacy_id"`
}

type AddCandidacyCommentRequest struct {
	CandidacyID string `json:"candidacy_id"`
	Body        string `json:"body"`
}

type RSVPInterviewRequest struct {
	InterviewID string        `json:"interview_id"`
	RSVP        InterviewRSVP `json:"rsvp"`
}

// Validation functions
func (r *ListMyCandidaciesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}

func (r *GetMyCandidacyRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "candidacy_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *AddCandidacyCommentRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "candidacy_id",
			Message: "is required",
		})
	}

	if r.Body == "" {
		errs = append(errs, common.ValidationError{
			Field:   "body",
			Message: "is required",
		})
	} else if len(r.Body) < 1 || len(r.Body) > 4000 {
		errs = append(errs, common.ValidationError{
			Field:   "body",
			Message: "must be between 1 and 4000 characters",
		})
	}

	return errs
}

func (r *RSVPInterviewRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.RSVP != InterviewRSVPYes && r.RSVP != InterviewRSVPNo {
		errs = append(errs, common.ValidationError{
			Field:   "rsvp",
			Message: "must be 'yes' or 'no'",
		})
	}

	return errs
}

type HubMyInterview struct {
	InterviewID   string         `json:"interview_id"`
	CandidacyID   string         `json:"candidacy_id"`
	OpeningTitle  string         `json:"opening_title"`
	InterviewType InterviewType  `json:"interview_type"`
	StartsAt      string         `json:"starts_at"`
	EndsAt        string         `json:"ends_at"`
	State         InterviewState `json:"state"`
	CandidateRSVP *InterviewRSVP `json:"candidate_rsvp,omitempty"`
}

type ListMyInterviewsRequest struct {
	FilterState   []InterviewState `json:"filter_state,omitempty"`
	PaginationKey *string          `json:"pagination_key,omitempty"`
	Limit         *int32           `json:"limit,omitempty"`
}

type ListMyInterviewsResponse struct {
	Interviews        []HubMyInterview `json:"interviews"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

func (r *ListMyInterviewsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}
	return errs
}
