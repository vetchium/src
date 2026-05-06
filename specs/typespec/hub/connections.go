package hub

import (
	"vetchium-api-server.typespec/common"
)

type ConnectionState string

const (
	ConnectionStateNotConnected          ConnectionState = "not_connected"
	ConnectionStateIneligible            ConnectionState = "ineligible"
	ConnectionStateRequestSent           ConnectionState = "request_sent"
	ConnectionStateRequestReceived       ConnectionState = "request_received"
	ConnectionStateConnected             ConnectionState = "connected"
	ConnectionStateIRejectedTheirRequest ConnectionState = "i_rejected_their_request"
	ConnectionStateTheyRejectedMyRequest ConnectionState = "they_rejected_my_request"
	ConnectionStateIDisconnected         ConnectionState = "i_disconnected"
	ConnectionStateTheyDisconnected      ConnectionState = "they_disconnected"
	ConnectionStateIBlockedThem          ConnectionState = "i_blocked_them"
	ConnectionStateBlockedByThem         ConnectionState = "blocked_by_them"
)

type HandleRequest struct {
	Handle Handle `json:"handle"`
}

func (r HandleRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := ValidateHandle(r.Handle); err != nil {
		errs = append(errs, common.NewValidationError("handle", err))
	}
	return errs
}

type GetStatusRequest struct {
	Handle Handle `json:"handle"`
}

func (r GetStatusRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if err := ValidateHandle(r.Handle); err != nil {
		errs = append(errs, common.NewValidationError("handle", err))
	}
	return errs
}

type GetStatusResponse struct {
	ConnectionState ConnectionState `json:"connection_state"`
}

type Connection struct {
	Handle            Handle  `json:"handle"`
	DisplayName       string  `json:"display_name"`
	ShortBio          *string `json:"short_bio,omitempty"`
	HasProfilePicture bool    `json:"has_profile_picture"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
	ConnectedAt       string  `json:"connected_at"`
}

type PendingRequest struct {
	Handle            Handle  `json:"handle"`
	DisplayName       string  `json:"display_name"`
	ShortBio          *string `json:"short_bio,omitempty"`
	HasProfilePicture bool    `json:"has_profile_picture"`
	ProfilePictureURL *string `json:"profile_picture_url,omitempty"`
	CreatedAt         string  `json:"created_at"`
}

type BlockedUser struct {
	Handle      Handle `json:"handle"`
	DisplayName string `json:"display_name"`
	BlockedAt   string `json:"blocked_at"`
}

type ListConnectionsRequest struct {
	FilterQuery   *string `json:"filter_query,omitempty"`
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r ListConnectionsRequest) Validate() []common.ValidationError {
	return nil
}

type ListConnectionsResponse struct {
	Connections       []Connection `json:"connections"`
	NextPaginationKey *string      `json:"next_pagination_key,omitempty"`
}

type ListPendingRequestsRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r ListPendingRequestsRequest) Validate() []common.ValidationError {
	return nil
}

type ListIncomingRequestsResponse struct {
	Incoming          []PendingRequest `json:"incoming"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

type ListOutgoingRequestsResponse struct {
	Outgoing          []PendingRequest `json:"outgoing"`
	NextPaginationKey *string          `json:"next_pagination_key,omitempty"`
}

type ListBlockedRequest struct {
	PaginationKey *string `json:"pagination_key,omitempty"`
	Limit         *int32  `json:"limit,omitempty"`
}

func (r ListBlockedRequest) Validate() []common.ValidationError {
	return nil
}

type ListBlockedResponse struct {
	Blocked           []BlockedUser `json:"blocked"`
	NextPaginationKey *string       `json:"next_pagination_key,omitempty"`
}

type SearchConnectionsRequest struct {
	Query string `json:"query"`
}

func (r SearchConnectionsRequest) Validate() []common.ValidationError {
	var errs []common.ValidationError
	if r.Query == "" {
		errs = append(errs, common.NewValidationError("query", common.ErrRequired))
	}
	return errs
}

type SearchConnectionsResponse struct {
	Results []Connection `json:"results"`
}

type ConnectionCounts struct {
	PendingIncoming int32 `json:"pending_incoming"`
	PendingOutgoing int32 `json:"pending_outgoing"`
	Connected       int32 `json:"connected"`
	Blocked         int32 `json:"blocked"`
}
