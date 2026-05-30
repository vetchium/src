package org

import (
	"vetchium-api-server.typespec/common"
)

type FeedbackDecision string

type ScheduleInterviewRequest struct {
	CandidacyID               string        `json:"candidacy_id"`
	InterviewType             InterviewType `json:"interview_type"`
	StartsAt                  string        `json:"starts_at"`
	EndsAt                    string        `json:"ends_at"`
	Description               *string       `json:"description,omitempty"`
	InterviewerEmailAddresses []string      `json:"interviewer_email_addresses"`
}

type ScheduleInterviewResponse struct {
	InterviewID string `json:"interview_id"`
}

type UpdateInterviewRequest struct {
	InterviewID string  `json:"interview_id"`
	StartsAt    *string `json:"starts_at,omitempty"`
	EndsAt      *string `json:"ends_at,omitempty"`
	Description *string `json:"description,omitempty"`
}

type InterviewIDRequest struct {
	InterviewID string `json:"interview_id"`
}

type AddInterviewerRequest struct {
	InterviewID         string `json:"interview_id"`
	OrgUserEmailAddress string `json:"org_user_email_address"`
}

type RemoveInterviewerRequest struct {
	InterviewID string `json:"interview_id"`
	OrgUserID   string `json:"org_user_id"`
}

type SetInterviewerRSVPRequest struct {
	InterviewID string        `json:"interview_id"`
	RSVP        InterviewRSVP `json:"rsvp"`
}

type SubmitInterviewFeedbackRequest struct {
	InterviewID       string           `json:"interview_id"`
	Decision          FeedbackDecision `json:"decision"`
	Positives         string           `json:"positives"`
	Negatives         string           `json:"negatives"`
	OverallAssessment string           `json:"overall_assessment"`
	CandidateFeedback *string          `json:"candidate_feedback,omitempty"`
}

type InterviewerEntry struct {
	OrgUserID           string         `json:"org_user_id"`
	OrgUserEmailAddress string         `json:"org_user_email_address"`
	DisplayName         string         `json:"display_name"`
	RSVP                *InterviewRSVP `json:"rsvp,omitempty"`
	FeedbackSubmitted   bool           `json:"feedback_submitted"`
}

type InterviewFeedback struct {
	OrgUserID         string           `json:"org_user_id"`
	Decision          FeedbackDecision `json:"decision"`
	Positives         string           `json:"positives"`
	Negatives         string           `json:"negatives"`
	OverallAssessment string           `json:"overall_assessment"`
	CandidateFeedback *string          `json:"candidate_feedback,omitempty"`
	SubmittedAt       string           `json:"submitted_at"`
}

type OrgInterview struct {
	InterviewID   string              `json:"interview_id"`
	CandidacyID   string              `json:"candidacy_id"`
	InterviewType InterviewType       `json:"interview_type"`
	StartsAt      string              `json:"starts_at"`
	EndsAt        string              `json:"ends_at"`
	Description   *string             `json:"description,omitempty"`
	State         InterviewState      `json:"state"`
	CandidateRSVP *InterviewRSVP      `json:"candidate_rsvp,omitempty"`
	Interviewers  []InterviewerEntry  `json:"interviewers"`
	Feedback      []InterviewFeedback `json:"feedback"`
}

type ListInterviewsRequest struct {
	FilterCandidacyID  *string          `json:"filter_candidacy_id,omitempty"`
	FilterState        []InterviewState `json:"filter_state,omitempty"`
	FilterStartsAtFrom *string          `json:"filter_starts_at_from,omitempty"`
	FilterStartsAtTo   *string          `json:"filter_starts_at_to,omitempty"`
	PaginationKey      *string          `json:"pagination_key,omitempty"`
	Limit              *int32           `json:"limit,omitempty"`
}

type ListInterviewsResponse struct {
	Interviews        []OrgInterviewSummary `json:"interviews"`
	NextPaginationKey *string               `json:"next_pagination_key,omitempty"`
}

// Validation functions
func (r *ScheduleInterviewRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "candidacy_id",
			Message: "is required",
		})
	}

	if r.InterviewType != "in_person" && r.InterviewType != "video" && r.InterviewType != "take_home" && r.InterviewType != "other" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_type",
			Message: "must be one of: in_person, video, take_home, other",
		})
	}

	if r.StartsAt == "" {
		errs = append(errs, common.ValidationError{
			Field:   "starts_at",
			Message: "is required",
		})
	}

	if r.EndsAt == "" {
		errs = append(errs, common.ValidationError{
			Field:   "ends_at",
			Message: "is required",
		})
	}

	if r.Description != nil && len(*r.Description) > 2000 {
		errs = append(errs, common.ValidationError{
			Field:   "description",
			Message: "must be at most 2000 characters",
		})
	}

	if len(r.InterviewerEmailAddresses) < 1 || len(r.InterviewerEmailAddresses) > 5 {
		errs = append(errs, common.ValidationError{
			Field:   "interviewer_email_addresses",
			Message: "must have 1-5 items",
		})
	}

	return errs
}

func (r *UpdateInterviewRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.Description != nil && len(*r.Description) > 2000 {
		errs = append(errs, common.ValidationError{
			Field:   "description",
			Message: "must be at most 2000 characters",
		})
	}

	return errs
}

func (r *InterviewIDRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *AddInterviewerRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.OrgUserEmailAddress == "" {
		errs = append(errs, common.ValidationError{
			Field:   "org_user_email_address",
			Message: "is required",
		})
	}

	return errs
}

func (r *RemoveInterviewerRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.OrgUserID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "org_user_id",
			Message: "is required",
		})
	}

	return errs
}

func (r *SetInterviewerRSVPRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.RSVP != "yes" && r.RSVP != "no" {
		errs = append(errs, common.ValidationError{
			Field:   "rsvp",
			Message: "must be one of: yes, no",
		})
	}

	return errs
}

func (r *SubmitInterviewFeedbackRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.InterviewID == "" {
		errs = append(errs, common.ValidationError{
			Field:   "interview_id",
			Message: "is required",
		})
	}

	if r.Decision != "strong_yes" && r.Decision != "yes" && r.Decision != "neutral" && r.Decision != "no" && r.Decision != "strong_no" {
		errs = append(errs, common.ValidationError{
			Field:   "decision",
			Message: "must be one of: strong_yes, yes, neutral, no, strong_no",
		})
	}

	if r.Positives == "" || len(r.Positives) < 1 || len(r.Positives) > 4000 {
		errs = append(errs, common.ValidationError{
			Field:   "positives",
			Message: "must be between 1 and 4000 characters",
		})
	}

	if r.Negatives == "" || len(r.Negatives) < 1 || len(r.Negatives) > 4000 {
		errs = append(errs, common.ValidationError{
			Field:   "negatives",
			Message: "must be between 1 and 4000 characters",
		})
	}

	if r.OverallAssessment == "" || len(r.OverallAssessment) < 1 || len(r.OverallAssessment) > 4000 {
		errs = append(errs, common.ValidationError{
			Field:   "overall_assessment",
			Message: "must be between 1 and 4000 characters",
		})
	}

	if r.CandidateFeedback != nil && len(*r.CandidateFeedback) > 2000 {
		errs = append(errs, common.ValidationError{
			Field:   "candidate_feedback",
			Message: "must be at most 2000 characters",
		})
	}

	return errs
}

func (r *ListInterviewsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError

	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{
			Field:   "limit",
			Message: "must be between 1 and 100",
		})
	}

	return errs
}
