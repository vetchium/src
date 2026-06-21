package hub

import (
	"vetchium-api-server.typespec/common"
)

type ReferenceNominationState string

const (
	ReferenceNominationStateNominated ReferenceNominationState = "nominated"
	ReferenceNominationStateAccepted  ReferenceNominationState = "accepted"
	ReferenceNominationStateDeclined  ReferenceNominationState = "declined"
	ReferenceNominationStateSubmitted ReferenceNominationState = "submitted"
	ReferenceNominationStateExpired   ReferenceNominationState = "expired"
)

type ReferenceInboxRequestKind string

const (
	ReferenceInboxRequestKindToNominate ReferenceInboxRequestKind = "to_nominate"
	ReferenceInboxRequestKindToRespond  ReferenceInboxRequestKind = "to_respond"
)

type ReferenceQuestion struct {
	QuestionID string `json:"question_id"`
	Text       string `json:"text"`
	MinChars   int32  `json:"min_chars"`
	MaxChars   int32  `json:"max_chars"`
	Required   bool   `json:"required"`
}

type HubReferenceRequestSummary struct {
	Kind             ReferenceInboxRequestKind `json:"kind"`
	RequestID        string                    `json:"request_id"`
	NominationID     *string                   `json:"nomination_id,omitempty"`
	OrgDomain        string                    `json:"org_domain"`
	OrgName          string                    `json:"org_name"`
	OpeningTitle     string                    `json:"opening_title"`
	CandidateHandle  *string                   `json:"candidate_handle,omitempty"`
	MaxReferences    *int32                    `json:"max_references,omitempty"`
	Questions        []ReferenceQuestion       `json:"questions"`
	ResponseDeadline string                    `json:"response_deadline"`
	State            *ReferenceNominationState `json:"state,omitempty"`
	CreatedAt        string                    `json:"created_at"`
}

type ListReferenceRequestsIncomingRequest struct {
	FilterKind    []ReferenceInboxRequestKind `json:"filter_kind,omitempty"`
	FilterState   []ReferenceNominationState  `json:"filter_state,omitempty"`
	PaginationKey *string                     `json:"pagination_key,omitempty"`
	Limit         *int32                      `json:"limit,omitempty"`
}

type ListReferenceRequestsIncomingResponse struct {
	Requests          []HubReferenceRequestSummary `json:"requests"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type NominateReferencesRequest struct {
	RequestID      string   `json:"request_id"`
	NomineeHandles []string `json:"nominee_handles"`
}

type AcceptReferenceNominationRequest struct {
	NominationID string `json:"nomination_id"`
}

type DeclineReferenceNominationRequest struct {
	NominationID string `json:"nomination_id"`
}

type ReferenceAnswer struct {
	QuestionID   string `json:"question_id"`
	ResponseText string `json:"response_text"`
}

type SubmitReferenceResponseRequest struct {
	NominationID string            `json:"nomination_id"`
	Answers      []ReferenceAnswer `json:"answers"`
}

func (r ListReferenceRequestsIncomingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r NominateReferencesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.RequestID == "" {
		errs = append(errs, common.ValidationError{Field: "request_id", Message: "Must be a non-empty string"})
	}
	if len(r.NomineeHandles) < 1 || len(r.NomineeHandles) > 5 {
		errs = append(errs, common.ValidationError{Field: "nominee_handles", Message: "Must have 1-5 items"})
	}
	for _, h := range r.NomineeHandles {
		if h == "" {
			errs = append(errs, common.ValidationError{Field: "nominee_handles", Message: "All handles must be non-empty strings"})
			break
		}
	}
	return errs
}

func (r AcceptReferenceNominationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.NominationID == "" {
		errs = append(errs, common.ValidationError{Field: "nomination_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r DeclineReferenceNominationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.NominationID == "" {
		errs = append(errs, common.ValidationError{Field: "nomination_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r SubmitReferenceResponseRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.NominationID == "" {
		errs = append(errs, common.ValidationError{Field: "nomination_id", Message: "Must be a non-empty string"})
	}
	if len(r.Answers) == 0 {
		errs = append(errs, common.ValidationError{Field: "answers", Message: "Must have at least one answer"})
	}
	for i, ans := range r.Answers {
		if ans.QuestionID == "" {
			errs = append(errs, common.ValidationError{Field: "answers[" + string(rune(i)) + "].question_id", Message: "Must be a non-empty string"})
		}
		if ans.ResponseText == "" {
			errs = append(errs, common.ValidationError{Field: "answers[" + string(rune(i)) + "].response_text", Message: "Must be a non-empty string"})
		}
	}
	return errs
}
