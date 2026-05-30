package hub

import (
	"vetchium-api-server.typespec/common"
)

type EndorsementRequestState string

const (
	EndorsementRequestStatePending  EndorsementRequestState = "pending"
	EndorsementRequestStateWritten  EndorsementRequestState = "written"
	EndorsementRequestStateDeclined EndorsementRequestState = "declined"
	EndorsementRequestStateExpired  EndorsementRequestState = "expired"
)

type RequestEndorsementsRequest struct {
	ApplicationID   string   `json:"application_id"`
	EndorserHandles []string `json:"endorser_handles"`
	Note            *string  `json:"note,omitempty"`
}

type EndorsementRequestIncoming struct {
	RequestID                string                  `json:"request_id"`
	ApplicationID            string                  `json:"application_id"`
	CandidateHandle          string                  `json:"candidate_handle"`
	CandidateDisplayName     string                  `json:"candidate_display_name"`
	OrgDomain                string                  `json:"org_domain"`
	OrgName                  string                  `json:"org_name"`
	OpeningTitle             string                  `json:"opening_title"`
	SharedDomain             string                  `json:"shared_domain"`
	OverlapStartYear         int32                   `json:"overlap_start_year"`
	OverlapEndYear           int32                   `json:"overlap_end_year"`
	Note                     *string                 `json:"note,omitempty"`
	State                    EndorsementRequestState `json:"state"`
	RequestedAt              string                  `json:"requested_at"`
	CandidateConnectionState string                  `json:"candidate_connection_state"`
}

type EndorsementRequestOutgoing struct {
	RequestID           string                  `json:"request_id"`
	ApplicationID       string                  `json:"application_id"`
	EndorserHandle      string                  `json:"endorser_handle"`
	EndorserDisplayName string                  `json:"endorser_display_name"`
	State               EndorsementRequestState `json:"state"`
	RequestedAt         string                  `json:"requested_at"`
}

type ListEndorsementRequestsIncomingRequest struct {
	FilterState   []EndorsementRequestState `json:"filter_state,omitempty"`
	PaginationKey *string                   `json:"pagination_key,omitempty"`
	Limit         *int32                    `json:"limit,omitempty"`
}

type ListEndorsementRequestsIncomingResponse struct {
	Requests          []EndorsementRequestIncoming `json:"requests"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type ListEndorsementRequestsOutgoingRequest struct {
	ApplicationID string  `json:"application_id"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

type ListEndorsementRequestsOutgoingResponse struct {
	Requests          []EndorsementRequestOutgoing `json:"requests"`
	NextPaginationKey *string                      `json:"next_pagination_key,omitempty"`
}

type WriteEndorsementRequest struct {
	RequestID     *string `json:"request_id,omitempty"`
	ApplicationID *string `json:"application_id,omitempty"`
	Text          string  `json:"text"`
}

type WriteEndorsementResponse struct {
	EndorsementID string `json:"endorsement_id"`
}

type UpdateEndorsementRequest struct {
	EndorsementID string `json:"endorsement_id"`
	Text          string `json:"text"`
}

type DeclineEndorsementRequestRequest struct {
	RequestID string `json:"request_id"`
}

type HideEndorsementOnApplicationRequest struct {
	EndorsementID string `json:"endorsement_id"`
}

type ShowEndorsementOnApplicationRequest struct {
	EndorsementID string `json:"endorsement_id"`
}

func (r RequestEndorsementsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{Field: "application_id", Message: "Must be a non-empty string"})
	}
	if len(r.EndorserHandles) < 1 || len(r.EndorserHandles) > 10 {
		errs = append(errs, common.ValidationError{Field: "endorser_handles", Message: "Must have 1-10 items"})
	}
	for _, h := range r.EndorserHandles {
		if h == "" {
			errs = append(errs, common.ValidationError{Field: "endorser_handles", Message: "All handles must be non-empty strings"})
			break
		}
	}
	if r.Note != nil && len(*r.Note) > 500 {
		errs = append(errs, common.ValidationError{Field: "note", Message: "Must be at most 500 characters"})
	}
	return errs
}

func (r ListEndorsementRequestsIncomingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r ListEndorsementRequestsOutgoingRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.ApplicationID == "" {
		errs = append(errs, common.ValidationError{Field: "application_id", Message: "Must be a non-empty string"})
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > 100) {
		errs = append(errs, common.ValidationError{Field: "limit", Message: "Must be between 1 and 100"})
	}
	return errs
}

func (r WriteEndorsementRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	hasReqID := r.RequestID != nil && *r.RequestID != ""
	hasAppID := r.ApplicationID != nil && *r.ApplicationID != ""
	if hasReqID == hasAppID {
		errs = append(errs, common.ValidationError{Field: "request_id", Message: "Exactly one of request_id or application_id must be provided"})
	}
	if len(r.Text) < 100 || len(r.Text) > 2000 {
		errs = append(errs, common.ValidationError{Field: "text", Message: "Must be between 100 and 2000 characters"})
	}
	return errs
}

func (r UpdateEndorsementRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.EndorsementID == "" {
		errs = append(errs, common.ValidationError{Field: "endorsement_id", Message: "Must be a non-empty string"})
	}
	if len(r.Text) < 100 || len(r.Text) > 2000 {
		errs = append(errs, common.ValidationError{Field: "text", Message: "Must be between 100 and 2000 characters"})
	}
	return errs
}

func (r DeclineEndorsementRequestRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.RequestID == "" {
		errs = append(errs, common.ValidationError{Field: "request_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r HideEndorsementOnApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.EndorsementID == "" {
		errs = append(errs, common.ValidationError{Field: "endorsement_id", Message: "Must be a non-empty string"})
	}
	return errs
}

func (r ShowEndorsementOnApplicationRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.EndorsementID == "" {
		errs = append(errs, common.ValidationError{Field: "endorsement_id", Message: "Must be a non-empty string"})
	}
	return errs
}
