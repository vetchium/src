package org

import (
	"vetchium-api-server.typespec/common"
	hub "vetchium-api-server.typespec/hub"
)

type RequestReferencesRequest struct {
	CandidacyID      string                  `json:"candidacy_id"`
	MaxReferences    int32                   `json:"max_references"`
	ResponseDeadline string                  `json:"response_deadline"`
	Questions        []hub.ReferenceQuestion `json:"questions"`
}

type RequestReferencesResponse struct {
	RequestID string `json:"request_id"`
}

type RequestIdRequest struct {
	RequestID string `json:"request_id"`
}

type OrgReferenceNomination struct {
	NominationID       string                       `json:"nomination_id"`
	NomineeHandle      string                       `json:"nominee_handle"`
	NomineeDisplayName string                       `json:"nominee_display_name"`
	SharedDomain       string                       `json:"shared_domain"`
	OverlapStartYear   int32                        `json:"overlap_start_year"`
	OverlapEndYear     int32                        `json:"overlap_end_year"`
	State              hub.ReferenceNominationState `json:"state"`
	NominatedAt        string                       `json:"nominated_at"`
	SubmittedAt        *string                      `json:"submitted_at,omitempty"`
}

type ListReferenceNominationsResponse struct {
	Nominations []OrgReferenceNomination `json:"nominations"`
}

type ReferenceResponseAnswer struct {
	QuestionID   string `json:"question_id"`
	QuestionText string `json:"question_text"`
	ResponseText string `json:"response_text"`
}

type OrgReferenceResponse struct {
	NominationID       string                    `json:"nomination_id"`
	NomineeHandle      string                    `json:"nominee_handle"`
	NomineeDisplayName string                    `json:"nominee_display_name"`
	SharedDomain       string                    `json:"shared_domain"`
	OverlapStartYear   int32                     `json:"overlap_start_year"`
	OverlapEndYear     int32                     `json:"overlap_end_year"`
	Answers            []ReferenceResponseAnswer `json:"answers"`
	SubmittedAt        string                    `json:"submitted_at"`
}

type ListReferenceResponsesResponse struct {
	Responses           []OrgReferenceResponse   `json:"responses"`
	DeclinedNominations []OrgReferenceNomination `json:"declined_nominations"`
}

func (r RequestReferencesRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.CandidacyID == "" {
		errs = append(errs, common.ValidationError{Field: "candidacy_id", Message: "Must be a non-empty string"})
	}
	if r.MaxReferences < 1 || r.MaxReferences > 5 {
		errs = append(errs, common.ValidationError{Field: "max_references", Message: "Must be between 1 and 5"})
	}
	if r.ResponseDeadline == "" {
		errs = append(errs, common.ValidationError{Field: "response_deadline", Message: "Must be a non-empty string"})
	}
	if len(r.Questions) < 1 || len(r.Questions) > 10 {
		errs = append(errs, common.ValidationError{Field: "questions", Message: "Must have 1-10 items"})
	}
	for i, q := range r.Questions {
		if len(q.Text) < 10 || len(q.Text) > 500 {
			errs = append(errs, common.ValidationError{Field: "questions[" + string(rune(i)) + "].text", Message: "Must be between 10 and 500 characters"})
		}
		if q.MinChars < 0 {
			errs = append(errs, common.ValidationError{Field: "questions[" + string(rune(i)) + "].min_chars", Message: "Must be non-negative"})
		}
		if q.MaxChars < 1 || q.MaxChars > 4000 {
			errs = append(errs, common.ValidationError{Field: "questions[" + string(rune(i)) + "].max_chars", Message: "Must be between 1 and 4000"})
		}
	}
	return errs
}

func (r RequestIdRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.RequestID == "" {
		errs = append(errs, common.ValidationError{Field: "request_id", Message: "Must be a non-empty string"})
	}
	return errs
}
