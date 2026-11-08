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
	RequestNumber     contacts.ChatRequestNumber        `json:"request_number"`
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
	AgencyDisplayName string `json:"agency_display_name"`
	// AgencyDomain names the conversation: the agency's primary domain.
	AgencyDomain    orgs.OrgDomain                       `json:"agency_domain"`
	HasConversation bool                                 `json:"has_conversation"`
	Unread          bool                                 `json:"unread"`
	UnreadCount     int32                                `json:"unread_count"`
	ReadOnlyReason  *contacts.ConversationReadOnlyReason `json:"read_only_reason,omitempty"`
	Suggestions     []HubOpeningSuggestion               `json:"suggestions"`
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
	LatestRequest     *HubChatRequest        `json:"latest_request,omitempty"`
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
	AgencyDomain  orgs.OrgDomain             `json:"agency_domain"`
	RequestNumber contacts.ChatRequestNumber `json:"request_number"`
}

func (r *HubAcceptChatRequestRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
}

func (r HubAcceptChatRequestRequest) Validate() []string {
	fields := []string{}
	if !orgs.IsOrgDomain(r.AgencyDomain) {
		fields = append(fields, "agency_domain")
	}
	if r.RequestNumber < 1 {
		fields = append(fields, "request_number")
	}
	return fields
}

type HubDeclineChatRequestRequest struct {
	AgencyDomain  orgs.OrgDomain                   `json:"agency_domain"`
	RequestNumber contacts.ChatRequestNumber       `json:"request_number"`
	Scope         contacts.ChatRequestDeclineScope `json:"scope"`
}

func (r *HubDeclineChatRequestRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
}

func (r HubDeclineChatRequestRequest) Validate() []string {
	fields := HubAcceptChatRequestRequest{
		AgencyDomain: r.AgencyDomain, RequestNumber: r.RequestNumber,
	}.Validate()
	if !contacts.IsChatRequestDeclineScope(r.Scope) {
		fields = append(fields, "scope")
	}
	return fields
}

// ConversationFilter picks which of the Hub user's conversations a list
// holds.
type ConversationFilter string

const (
	ConversationFilterAll ConversationFilter = "all"
	// ConversationFilterRequestsReceived holds a pending chat request from
	// the agency to the Hub user.
	ConversationFilterRequestsReceived ConversationFilter = "requests_received"
	// ConversationFilterUnread holds agency messages the Hub user has not
	// read.
	ConversationFilterUnread ConversationFilter = "unread"
)

type ListConversationsRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
	Filter        *ConversationFilter   `json:"filter,omitempty"`
}

func (r *ListConversationsRequest) Normalize() {}

func (r ListConversationsRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return DefaultPage
	}
	return *r.Limit
}

func (r ListConversationsRequest) EffectiveFilter() ConversationFilter {
	if r.Filter == nil {
		return ConversationFilterAll
	}
	return *r.Filter
}

func (r ListConversationsRequest) Validate() []string {
	fields := validPage(r.PaginationKey, r.Limit)
	if r.Filter != nil {
		switch *r.Filter {
		case ConversationFilterAll, ConversationFilterRequestsReceived,
			ConversationFilterUnread:
		default:
			fields = append(fields, "filter")
		}
	}
	return fields
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

// AwaitingConversationCounts counts the conversations waiting on the Hub
// user, each under the ConversationFilter of the same name.
type AwaitingConversationCounts struct {
	RequestsReceived int32 `json:"requests_received"`
	Unread           int32 `json:"unread"`
}

func validAgencyDomain(domain orgs.OrgDomain) []string {
	if !orgs.IsOrgDomain(domain) {
		return []string{"agency_domain"}
	}
	return []string{}
}

type GetConversationRequest struct {
	AgencyDomain  orgs.OrgDomain        `json:"agency_domain"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *GetConversationRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
}

func (r GetConversationRequest) EffectiveLimit() int32 {
	if r.Limit == nil {
		return DefaultPage
	}
	return *r.Limit
}

func (r GetConversationRequest) Validate() []string {
	return append(validAgencyDomain(r.AgencyDomain), validPage(r.PaginationKey, r.Limit)...)
}

type ReplyToConversationRequest struct {
	AgencyDomain orgs.OrgDomain       `json:"agency_domain"`
	Text         contacts.MessageText `json:"text"`
}

func (r *ReplyToConversationRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
	r.Text = contacts.NormalizeMessageText(r.Text)
}

func (r ReplyToConversationRequest) Validate() []string {
	fields := validAgencyDomain(r.AgencyDomain)
	if !contacts.IsMessageText(r.Text) {
		fields = append(fields, "text")
	}
	return fields
}

// DeleteMessageRequest deletes one of the Hub user's own text messages
// (MKT-CNV-007).
type DeleteMessageRequest struct {
	AgencyDomain  orgs.OrgDomain         `json:"agency_domain"`
	MessageNumber contacts.MessageNumber `json:"message_number"`
}

func (r *DeleteMessageRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
}

func (r DeleteMessageRequest) Validate() []string {
	fields := validAgencyDomain(r.AgencyDomain)
	if r.MessageNumber < 1 {
		fields = append(fields, "message_number")
	}
	return fields
}

type MarkConversationReadRequest struct {
	AgencyDomain orgs.OrgDomain `json:"agency_domain"`
}

func (r *MarkConversationReadRequest) Normalize() {
	r.AgencyDomain = orgs.NormalizeOrgDomain(r.AgencyDomain)
}

func (r MarkConversationReadRequest) Validate() []string {
	return validAgencyDomain(r.AgencyDomain)
}
