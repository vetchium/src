package org

import (
	"vetchium-api-server.typespec/common"
)

type CandidacyState string
type InterviewType string
type InterviewState string
type InterviewRSVP string

const (
	CandidacyStateInterviewing           CandidacyState = "interviewing"
	CandidacyStateOffered                CandidacyState = "offered"
	CandidacyStateOfferAccepted          CandidacyState = "offer_accepted"
	CandidacyStateOfferDeclined          CandidacyState = "offer_declined"
	CandidacyStateCandidateUnsuitable    CandidacyState = "candidate_unsuitable"
	CandidacyStateCandidateNotResponding CandidacyState = "candidate_not_responding"
	CandidacyStateEmployerDefunct        CandidacyState = "employer_defunct"

	InterviewTypeInPerson InterviewType = "in_person"
	InterviewTypeVideo    InterviewType = "video"
	InterviewTypeTakeHome InterviewType = "take_home"
	InterviewTypeOther    InterviewType = "other"

	InterviewStateScheduled InterviewState = "scheduled"
	InterviewStateCompleted InterviewState = "completed"
	InterviewStateCancelled InterviewState = "cancelled"

	InterviewRSVPYes InterviewRSVP = "yes"
	InterviewRSVPNo  InterviewRSVP = "no"
)

type CandidacyComment struct {
	CommentID    string  `json:"comment_id"`
	AuthorKind   string  `json:"author_kind"`
	AuthorHandle *string `json:"author_handle,omitempty"`
	Body         string  `json:"body"`
	CreatedAt    string  `json:"created_at"`
}

type ListCandidaciesRequest struct {
	FilterOpeningID *string          `json:"filter_opening_id,omitempty"`
	FilterState     []CandidacyState `json:"filter_state,omitempty"`
	PaginationKey   *string          `json:"pagination_key,omitempty"`
	Limit           *int32           `json:"limit,omitempty"`
}

type OrgCandidacySummary struct {
	CandidacyID             string         `json:"candidacy_id"`
	ApplicationID           string         `json:"application_id"`
	OpeningID               string         `json:"opening_id"`
	CandidateHandle         string         `json:"candidate_handle"`
	CandidateDisplayName    string         `json:"candidate_display_name"`
	State                   CandidacyState `json:"state"`
	ScheduledInterviewCount int32          `json:"scheduled_interview_count"`
	CreatedAt               string         `json:"created_at"`
	StateChangedAt          string         `json:"state_changed_at"`
}

type ListCandidaciesResponse struct {
	Candidacies       []OrgCandidacySummary `json:"candidacies"`
	NextPaginationKey *string               `json:"next_pagination_key,omitempty"`
}

type CandidacyIDRequest struct {
	CandidacyID string `json:"candidacy_id"`
}

type OrgInterviewSummary struct {
	InterviewID            string         `json:"interview_id"`
	InterviewType          InterviewType  `json:"interview_type"`
	StartsAt               string         `json:"starts_at"`
	EndsAt                 string         `json:"ends_at"`
	State                  InterviewState `json:"state"`
	InterviewerCount       int32          `json:"interviewer_count"`
	CandidateRSVP          *InterviewRSVP `json:"candidate_rsvp,omitempty"`
	FeedbackSubmittedCount int32          `json:"feedback_submitted_count"`
}

type OrgOfferView struct {
	ExtendedByOrgUserID    string  `json:"extended_by_org_user_id"`
	ExtendedAt             string  `json:"extended_at"`
	StartDate              *string `json:"start_date,omitempty"`
	Notes                  *string `json:"notes,omitempty"`
	OfferLetterDownloadURL string  `json:"offer_letter_download_url"`
}

type OrgCandidacy struct {
	CandidacyID          string                `json:"candidacy_id"`
	ApplicationID        string                `json:"application_id"`
	OpeningID            string                `json:"opening_id"`
	OpeningTitle         string                `json:"opening_title"`
	CandidateHandle      string                `json:"candidate_handle"`
	CandidateDisplayName string                `json:"candidate_display_name"`
	State                CandidacyState        `json:"state"`
	CreatedAt            string                `json:"created_at"`
	StateChangedAt       string                `json:"state_changed_at"`
	Interviews           []OrgInterviewSummary `json:"interviews"`
	Comments             []CandidacyComment    `json:"comments"`
	Offer                *OrgOfferView         `json:"offer,omitempty"`
}

type OrgAddCandidacyCommentRequest struct {
	CandidacyID string `json:"candidacy_id"`
	Body        string `json:"body"`
}

// Validation functions
func (r *ListCandidaciesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}

func (r *CandidacyIDRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "candidacy_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *OrgAddCandidacyCommentRequest) Validate() []common.ValidationError {
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
