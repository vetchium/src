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
)

type HubOpeningSuggestion struct {
	ConsumerDomain orgs.OrgDomain         `json:"consumer_domain"`
	OpeningNumber  openings.OpeningNumber `json:"opening_number"`
	SentAt         time.Time              `json:"sent_at"`
}

type HubConversationSummary struct {
	ContactID         contacts.ContactID                   `json:"contact_id"`
	AgencyOrgDID      orgs.OrgDID                          `json:"agency_org_did"`
	AgencyDisplayName string                               `json:"agency_display_name"`
	AgencyDomain      orgs.OrgDomain                       `json:"agency_domain"`
	AgencyLogoURL     *string                              `json:"agency_logo_url,omitempty"`
	HasConversation   bool                                 `json:"has_conversation"`
	Unread            bool                                 `json:"unread"`
	UnreadCount       int32                                `json:"unread_count"`
	ReadOnlyReason    *contacts.ConversationReadOnlyReason `json:"read_only_reason,omitempty"`
	Suggestions       []HubOpeningSuggestion               `json:"suggestions"`
	LastActivityAt    time.Time                            `json:"last_activity_at"`
}

type HubConversationDetail struct {
	Conversation HubConversationSummary         `json:"conversation"`
	Messages     []contacts.ConversationMessage `json:"messages"`
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
	fields := []string{}
	if r.PaginationKey != nil && !common.IsPaginationKey(*r.PaginationKey) {
		fields = append(fields, "pagination_key")
	}
	if r.Limit != nil && (*r.Limit < 1 || *r.Limit > MaxPage) {
		fields = append(fields, "limit")
	}
	return fields
}

type ListConversationsResponse struct {
	Items             []HubConversationSummary `json:"items"`
	NextPaginationKey *common.PaginationKey    `json:"next_pagination_key,omitempty"`
}

type GetConversationRequest struct {
	ContactID contacts.ContactID `json:"contact_id"`
}

func (r *GetConversationRequest) Normalize() {}

func (r GetConversationRequest) Validate() []string {
	if !contacts.IsContactID(r.ContactID) {
		return []string{"contact_id"}
	}
	return []string{}
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
