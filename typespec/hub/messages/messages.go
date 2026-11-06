package messages

import (
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	DefaultPage = 50
	MaxPage     = 100
	// MaxChatRequestsPerDay bounds the chat requests a Hub user sends per
	// UTC day (MKT-REQ-006).
	MaxChatRequestsPerDay = 10
)

type HubOpeningSuggestion struct {
	ConsumerDomain orgs.OrgDomain         `json:"consumer_domain"`
	OpeningNumber  openings.OpeningNumber `json:"opening_number"`
	SentAt         time.Time              `json:"sent_at"`
}

// HubChatRequest is a chat request between the Hub user and an agency, as
// the Hub user's pointer keeps it. It never carries the note; the
// conversation read does.
type HubChatRequest struct {
	RequestID         contacts.ChatRequestID            `json:"request_id"`
	ContactID         contacts.ContactID                `json:"contact_id"`
	Direction         contacts.ChatRequestDirection     `json:"direction"`
	State             contacts.ChatRequestState         `json:"state"`
	Opening           contacts.OpeningSuggestion        `json:"opening"`
	AgencyDisplayName string                            `json:"agency_display_name"`
	AgencyDomain      orgs.OrgDomain                    `json:"agency_domain"`
	SentAt            time.Time                         `json:"sent_at"`
	AnsweredAt        *time.Time                        `json:"answered_at,omitempty"`
	DeclineScope      *contacts.ChatRequestDeclineScope `json:"decline_scope,omitempty"`
	BlockedUntil      *time.Time                        `json:"blocked_until,omitempty"`
	// WindowDays is the conversation window in whole days, for "Not for N
	// days".
	WindowDays int32 `json:"window_days"`
}

type HubConversationSummary struct {
	ContactID         contacts.ContactID                   `json:"contact_id"`
	AgencyDisplayName string                               `json:"agency_display_name"`
	AgencyDomain      orgs.OrgDomain                       `json:"agency_domain"`
	HasConversation   bool                                 `json:"has_conversation"`
	Unread            bool                                 `json:"unread"`
	UnreadCount       int32                                `json:"unread_count"`
	ReadOnlyReason    *contacts.ConversationReadOnlyReason `json:"read_only_reason,omitempty"`
	Suggestions       []HubOpeningSuggestion               `json:"suggestions"`
	// AgencyMayWriteUntil and HubMayWriteUntil are nil for a side that may
	// not write (MKT-REQ-004).
	AgencyMayWriteUntil *time.Time `json:"agency_may_write_until,omitempty"`
	HubMayWriteUntil    *time.Time `json:"hub_may_write_until,omitempty"`
	// LatestRequest is the latest chat request between the two, in any
	// state.
	LatestRequest  *HubChatRequest `json:"latest_request,omitempty"`
	LastActivityAt time.Time       `json:"last_activity_at"`
}

type HubConversationDetail struct {
	Conversation HubConversationSummary `json:"conversation"`
	// Messages is one page, newest first.
	Messages []contacts.ConversationMessage `json:"messages"`
	// PendingRequestNote is a pending chat request's note, read live from
	// the agency's tenant.
	PendingRequestNote *contacts.ChatRequestNote `json:"pending_request_note,omitempty"`
	// NextPaginationKey resumes with older messages.
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// OpeningAgencyChatState is the Hub user's chat with one agency assigned to
// an Opening.
type OpeningAgencyChatState string

const (
	// OpeningAgencyNone has no conversation or request between the two.
	OpeningAgencyNone OpeningAgencyChatState = "none"
	// OpeningAgencyOpen lets the Hub user write in the conversation.
	OpeningAgencyOpen OpeningAgencyChatState = "open"
	// OpeningAgencyClosed has a conversation the Hub user may not write in.
	OpeningAgencyClosed          OpeningAgencyChatState = "closed"
	OpeningAgencyRequestSent     OpeningAgencyChatState = "request_sent"
	OpeningAgencyRequestReceived OpeningAgencyChatState = "request_received"
	// OpeningAgencyDeclined is the agency's decline blocking a request about
	// this Opening now.
	OpeningAgencyDeclined OpeningAgencyChatState = "declined"
)

// OpeningAgency is an agency with an active sourcing engagement assigned to
// the Opening.
type OpeningAgency struct {
	AgencyDisplayName string                 `json:"agency_display_name"`
	AgencyDomain      orgs.OrgDomain         `json:"agency_domain"`
	ChatState         OpeningAgencyChatState `json:"chat_state"`
	// ContactID is the agency's Contact on the Hub user, when a
	// conversation or request exists.
	ContactID     *contacts.ContactID `json:"contact_id,omitempty"`
	LatestRequest *HubChatRequest     `json:"latest_request,omitempty"`
}

type ListOpeningAgenciesRequest struct {
	Domain        orgs.OrgDomain         `json:"domain"`
	OpeningNumber openings.OpeningNumber `json:"opening_number"`
}

func (r *ListOpeningAgenciesRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
}

func (r ListOpeningAgenciesRequest) Validate() []string {
	return validOpening(r.Domain, r.OpeningNumber)
}

func validOpening(domain orgs.OrgDomain, number openings.OpeningNumber) []string {
	fields := []string{}
	if !orgs.IsOrgDomain(domain) {
		fields = append(fields, "domain")
	}
	if number < 1 {
		fields = append(fields, "opening_number")
	}
	return fields
}

type ListOpeningAgenciesResponse struct {
	// Items holds at most 20, the cap on sourcing assignments per Opening.
	Items []OpeningAgency `json:"items"`
}

// HubSendChatRequestRequest asks an agency assigned to a published Opening
// to open a conversation.
type HubSendChatRequestRequest struct {
	Domain        orgs.OrgDomain            `json:"domain"`
	OpeningNumber openings.OpeningNumber    `json:"opening_number"`
	AgencyDomain  orgs.OrgDomain            `json:"agency_domain"`
	Note          *contacts.ChatRequestNote `json:"note,omitempty"`
}

func (r *HubSendChatRequestRequest) Normalize() {
	r.Domain = orgs.NormalizeOrgDomain(r.Domain)
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
	if r.Note != nil {
		note := contacts.NormalizeChatRequestNote(*r.Note)
		r.Note = &note
	}
}

func (r HubSendChatRequestRequest) Validate() []string {
	fields := validOpening(r.Domain, r.OpeningNumber)
	if !orgs.IsOrgDomain(r.AgencyDomain) {
		fields = append(fields, "agency_domain")
	}
	if r.Note != nil && !contacts.IsChatRequestNote(*r.Note) {
		fields = append(fields, "note")
	}
	return fields
}

type ListHubChatRequestsRequest struct {
	Direction     contacts.ChatRequestDirection `json:"direction"`
	PaginationKey *common.PaginationKey         `json:"pagination_key,omitempty"`
	Limit         *int32                        `json:"limit,omitempty"`
}

func (r *ListHubChatRequestsRequest) Normalize() {}

func (r ListHubChatRequestsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return DefaultPage
	}
	return *r.Limit
}

func (r ListHubChatRequestsRequest) Validate() []string {
	fields := []string{}
	if !contacts.IsChatRequestDirection(r.Direction) {
		fields = append(fields, "direction")
	}
	return append(fields, validPage(r.PaginationKey, r.Limit)...)
}

type ListHubChatRequestsResponse struct {
	// Items holds pending requests oldest first, then answered ones newest
	// first.
	Items             []HubChatRequest      `json:"items"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type HubAcceptChatRequestRequest struct {
	RequestID contacts.ChatRequestID `json:"request_id"`
}

func (r *HubAcceptChatRequestRequest) Normalize() {}

func (r HubAcceptChatRequestRequest) Validate() []string {
	if !contacts.IsChatRequestID(r.RequestID) {
		return []string{"request_id"}
	}
	return []string{}
}

type HubDeclineChatRequestRequest struct {
	RequestID contacts.ChatRequestID           `json:"request_id"`
	Scope     contacts.ChatRequestDeclineScope `json:"scope"`
}

func (r *HubDeclineChatRequestRequest) Normalize() {}

func (r HubDeclineChatRequestRequest) Validate() []string {
	fields := []string{}
	if !contacts.IsChatRequestID(r.RequestID) {
		fields = append(fields, "request_id")
	}
	if !contacts.IsChatRequestDeclineScope(r.Scope) {
		fields = append(fields, "scope")
	}
	return fields
}

type ListConversationsRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListConversationsRequest) Normalize() {}

func (r ListConversationsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return DefaultPage
	}
	return *r.Limit
}

func (r ListConversationsRequest) Validate() []string {
	return validPage(r.PaginationKey, r.Limit)
}

func validPage(key *common.PaginationKey, limit *int32) []string {
	fields := []string{}
	if key != nil && !common.IsPaginationKey(*key) {
		fields = append(fields, "pagination_key")
	}
	if limit != nil && (*limit < 1 || *limit > MaxPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListConversationsResponse struct {
	Items             []HubConversationSummary `json:"items"`
	NextPaginationKey *common.PaginationKey    `json:"next_pagination_key,omitempty"`
}

type GetConversationRequest struct {
	ContactID     contacts.ContactID    `json:"contact_id"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *GetConversationRequest) Normalize() {}

func (r GetConversationRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return DefaultPage
	}
	return *r.Limit
}

func (r GetConversationRequest) Validate() []string {
	fields := validPage(r.PaginationKey, r.Limit)
	if !contacts.IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	return fields
}

type ReplyToConversationRequest struct {
	ContactID contacts.ContactID   `json:"contact_id"`
	Text      contacts.MessageText `json:"text"`
}

func (r *ReplyToConversationRequest) Normalize() {
	r.Text = contacts.NormalizeMessageText(r.Text)
}

func (r ReplyToConversationRequest) Validate() []string {
	fields := []string{}
	if !contacts.IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if !contacts.IsMessageText(r.Text) {
		fields = append(fields, "text")
	}
	return fields
}

type DeleteConversationRequest struct {
	ContactID contacts.ContactID `json:"contact_id"`
}

func (r *DeleteConversationRequest) Normalize() {}

func (r DeleteConversationRequest) Validate() []string {
	if !contacts.IsContactID(r.ContactID) {
		return []string{"contact_id"}
	}
	return []string{}
}

type MarkConversationReadRequest struct {
	ContactID contacts.ContactID `json:"contact_id"`
}

func (r *MarkConversationReadRequest) Normalize() {}

func (r MarkConversationReadRequest) Validate() []string {
	if !contacts.IsContactID(r.ContactID) {
		return []string{"contact_id"}
	}
	return []string{}
}
