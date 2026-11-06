package contacts

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	// MaxNotesPerContact bounds the notes on one Contact (MKT-NOTE-001).
	MaxNotesPerContact = 200
	// MaxNewContactsPerDay bounds the Contacts an agency creates per UTC day,
	// counting those a conversation creates (MKT-CON-005).
	MaxNewContactsPerDay = 200
	// MaxNewConversationsPerDay bounds the new conversations per agency per UTC day (MKT-CNV-003).
	MaxNewConversationsPerDay = 50
	// MaxChatRequestsPerDay bounds the chat requests an agency sends per UTC
	// day (MKT-REQ-006).
	MaxChatRequestsPerDay = 50
	// MaxChatRequestNoteLength bounds a chat request's note in code points.
	MaxChatRequestNoteLength = 1000
	// MaxNoteLength bounds a note in code points.
	MaxNoteLength = 5000
	// MaxMessageLength bounds a message in code points.
	MaxMessageLength = 5000
	// MaxPage bounds one page of Contacts or notes.
	MaxPage = 100
	// DefaultPage is the page size when a request names none.
	DefaultPage = 50
)

// ContactID names one Contact of an agency; never reused.
type ContactID string

type ContactNoteID string

type ConversationID string

type MessageID string

// NoteText is plain text of 1–5,000 code points once trimmed.
type NoteText string

// MessageText is plain text of 1–5,000 code points once trimmed.
type MessageText string

type MessageKind string

const (
	MessageKindText       MessageKind = "text"
	MessageKindSuggestion MessageKind = "suggestion"
	// MessageKindRequest is an accepted chat request (MKT-REQ-005).
	MessageKindRequest MessageKind = "request"
)

type MessageSenderType string

const (
	MessageSenderTypeAgency  MessageSenderType = "agency"
	MessageSenderTypeHubUser MessageSenderType = "hub_user"
)

type ConversationReadOnlyReason string

const (
	ConversationReadOnlyMessagesOff    ConversationReadOnlyReason = "messages_off"
	ConversationReadOnlyHubUserDeleted ConversationReadOnlyReason = "hub_user_deleted"
	ConversationReadOnlyAgencyDeleted  ConversationReadOnlyReason = "agency_deleted"
)

type ContactFilter string

const (
	ContactFilterAll             ContactFilter = "all"
	ContactFilterRequests        ContactFilter = "requests"
	ContactFilterUnread          ContactFilter = "unread"
	ContactFilterHasConversation ContactFilter = "has_conversation"
	ContactFilterNotContacted    ContactFilter = "not_contacted"
)

// ContactNameQuery is a case-insensitive substring of the Contact's recorded
// display name.
type ContactNameQuery string

func NormalizeContactNameQuery(value ContactNameQuery) ContactNameQuery {
	return ContactNameQuery(strings.TrimSpace(string(value)))
}

// IsContactNameQuery reports a trimmed query of 2 to 100 code points.
func IsContactNameQuery(value ContactNameQuery) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 2 && length <= 100 &&
		value == NormalizeContactNameQuery(value)
}

var uuidPattern = regexp.MustCompile(
	`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// IsContactID accepts the lowercase form the API returns.
func IsContactID(value ContactID) bool {
	return uuidPattern.MatchString(string(value))
}

func IsContactNoteID(value ContactNoteID) bool {
	return uuidPattern.MatchString(string(value))
}

func IsConversationID(value ConversationID) bool {
	return uuidPattern.MatchString(string(value))
}

func IsMessageID(value MessageID) bool {
	return uuidPattern.MatchString(string(value))
}

func NormalizeNoteText(value NoteText) NoteText {
	return NoteText(strings.TrimSpace(string(value)))
}

func NormalizeMessageText(value MessageText) MessageText {
	return MessageText(strings.TrimSpace(string(value)))
}

func IsNoteText(value NoteText) bool {
	length := utf8.RuneCountInString(string(NormalizeNoteText(value)))
	return length >= 1 && length <= MaxNoteLength
}

func IsMessageText(value MessageText) bool {
	length := utf8.RuneCountInString(string(NormalizeMessageText(value)))
	return length >= 1 && length <= MaxMessageLength
}

// ChatRequestID names one chat request; never reused.
type ChatRequestID string

func IsChatRequestID(value ChatRequestID) bool {
	return uuidPattern.MatchString(string(value))
}

// ChatRequestNote is plain text of 1–1,000 code points once trimmed.
type ChatRequestNote string

func NormalizeChatRequestNote(value ChatRequestNote) ChatRequestNote {
	return ChatRequestNote(strings.TrimSpace(string(value)))
}

func IsChatRequestNote(value ChatRequestNote) bool {
	length := utf8.RuneCountInString(string(NormalizeChatRequestNote(value)))
	return length >= 1 && length <= MaxChatRequestNoteLength
}

type ChatRequestState string

const (
	ChatRequestPending  ChatRequestState = "pending"
	ChatRequestAccepted ChatRequestState = "accepted"
	ChatRequestDeclined ChatRequestState = "declined"
	ChatRequestExpired  ChatRequestState = "expired"
)

// ChatRequestDirection names who the request asks.
type ChatRequestDirection string

const (
	ToHubUser ChatRequestDirection = "to_hub_user"
	ToAgency  ChatRequestDirection = "to_agency"
)

func IsChatRequestDirection(value ChatRequestDirection) bool {
	return value == ToHubUser || value == ToAgency
}

// ChatRequestDeclineScope is what a decline blocks (MKT-REQ-007).
type ChatRequestDeclineScope string

const (
	// DeclineOpening stops the sender requesting with that Opening again.
	DeclineOpening ChatRequestDeclineScope = "opening"
	// DeclineSender stops every request from the sender for one window.
	DeclineSender ChatRequestDeclineScope = "sender"
)

func IsChatRequestDeclineScope(value ChatRequestDeclineScope) bool {
	return value == DeclineOpening || value == DeclineSender
}

type OpeningSuggestion struct {
	ConsumerDomain orgs.OrgDomain         `json:"consumer_domain"`
	OpeningNumber  openings.OpeningNumber `json:"opening_number"`
}

func (s OpeningSuggestion) Valid() bool {
	return orgs.IsOrgDomain(s.ConsumerDomain) && s.OpeningNumber > 0
}

// ChatRequest is a chat request as the agency sees it (MKT-REQ-001).
type ChatRequest struct {
	RequestID ChatRequestID        `json:"request_id"`
	ContactID ContactID            `json:"contact_id"`
	Direction ChatRequestDirection `json:"direction"`
	State     ChatRequestState     `json:"state"`
	Opening   OpeningSuggestion    `json:"opening"`
	// Note is present only while the request is pending (MKT-REQ-012).
	Note          *ChatRequestNote   `json:"note,omitempty"`
	HubUserName   common.DisplayName `json:"hub_user_name"`
	HubUserHandle hub.HubHandle      `json:"hub_user_handle"`
	// SentBy is the sending agency user's email address; nil for a Hub
	// user's request.
	SentBy       *common.EmailAddress     `json:"sent_by,omitempty"`
	SentAt       time.Time                `json:"sent_at"`
	AnsweredAt   *time.Time               `json:"answered_at,omitempty"`
	DeclineScope *ChatRequestDeclineScope `json:"decline_scope,omitempty"`
	BlockedUntil *time.Time               `json:"blocked_until,omitempty"`
	// WindowDays is the conversation window in whole days, for "Not for N
	// days".
	WindowDays *int32 `json:"window_days,omitempty"`
}

type ConversationMessage struct {
	MessageID         MessageID         `json:"message_id"`
	SenderType        MessageSenderType `json:"sender_type"`
	SenderDisplayName string            `json:"sender_display_name"`
	Kind              MessageKind       `json:"kind"`
	Text              *MessageText      `json:"text,omitempty"`
	// Suggestion is the Opening of a suggestion or a request message.
	Suggestion *OpeningSuggestion `json:"suggestion,omitempty"`
	// Note is a request message's note, when its sender wrote one.
	Note   *ChatRequestNote `json:"note,omitempty"`
	SentAt time.Time        `json:"sent_at"`
}

type ConversationSummary struct {
	ConversationID        ConversationID              `json:"conversation_id"`
	ContactID             ContactID                   `json:"contact_id"`
	RecordedHubUserName   string                      `json:"recorded_hub_user_name"`
	RecordedHubUserHandle hub.HubHandle               `json:"recorded_hub_user_handle"`
	RecordedAgencyName    string                      `json:"recorded_agency_name"`
	RecordedAgencyDomain  orgs.OrgDomain              `json:"recorded_agency_domain"`
	AgencyUnread          bool                        `json:"agency_unread"`
	ReadOnlyReason        *ConversationReadOnlyReason `json:"read_only_reason,omitempty"`
	// AgencyMayWriteUntil and HubMayWriteUntil are nil for a side that may
	// not write (MKT-REQ-004).
	AgencyMayWriteUntil *time.Time `json:"agency_may_write_until,omitempty"`
	HubMayWriteUntil    *time.Time `json:"hub_may_write_until,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	LastActivityAt      time.Time  `json:"last_activity_at"`
}

type ConversationDetail struct {
	Conversation ConversationSummary `json:"conversation"`
	// Messages is one page, newest first.
	Messages []ConversationMessage `json:"messages"`
	// NextPaginationKey resumes with older messages.
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// VerifiedDomain is a verified professional-email domain with the months of
// its first and last verification. Never an address, a local part, or an
// exact instant.
type VerifiedDomain struct {
	Domain             common.ProfessionalDomain `json:"domain"`
	FirstVerifiedMonth profile.ProfileMonth      `json:"first_verified_month"`
	LastVerifiedMonth  profile.ProfileMonth      `json:"last_verified_month"`
}

func (d VerifiedDomain) Valid() bool {
	return common.IsProfessionalDomain(d.Domain) &&
		profile.IsProfileMonth(d.FirstVerifiedMonth) &&
		profile.IsProfileMonth(d.LastVerifiedMonth) &&
		d.FirstVerifiedMonth <= d.LastVerifiedMonth
}

// ContactSummary is one Contact in a list or beside a profile.
type ContactSummary struct {
	ContactID   ContactID          `json:"contact_id"`
	DisplayName common.DisplayName `json:"display_name"`
	Handle      hub.HubHandle      `json:"handle"`
	MessagesOff bool               `json:"messages_off"`
	// AccountDeleted reports that the person's account no longer exists and
	// only the conversation remains.
	AccountDeleted  bool  `json:"account_deleted"`
	NoteCount       int32 `json:"note_count"`
	HasConversation bool  `json:"has_conversation"`
	// PendingRequestDirection is the direction of a pending chat request
	// between the two, if any.
	PendingRequestDirection *ChatRequestDirection `json:"pending_request_direction,omitempty"`
	UnreadMessagesCount     int32                 `json:"unread_messages_count"`
	CreditedCount           int32                 `json:"credited_count"`
	LastActivityAt          time.Time             `json:"last_activity_at"`
}

func (c ContactSummary) Valid() bool {
	return IsContactID(c.ContactID) && common.IsDisplayName(c.DisplayName) &&
		hub.IsHubHandle(c.Handle) && c.NoteCount >= 0 &&
		c.NoteCount <= MaxNotesPerContact && c.UnreadMessagesCount >= 0 &&
		c.CreditedCount >= 0
}

type ContactOpeningSuggestion struct {
	ConsumerDomain orgs.OrgDomain         `json:"consumer_domain"`
	OpeningNumber  openings.OpeningNumber `json:"opening_number"`
	SuggestedAt    time.Time              `json:"suggested_at"`
}

type Contact struct {
	ContactSummary
	CreatedBy         common.EmailAddress        `json:"created_by"`
	SuggestedOpenings []ContactOpeningSuggestion `json:"suggested_openings"`
	// LatestRequest is the latest chat request between the two, in any state.
	LatestRequest *ChatRequest `json:"latest_request,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
}

type ContactNote struct {
	NoteID    ContactNoteID       `json:"note_id"`
	Author    common.EmailAddress `json:"author"`
	Mine      bool                `json:"mine"`
	Text      NoteText            `json:"text"`
	CreatedAt time.Time           `json:"created_at"`
	EditedAt  *time.Time          `json:"edited_at,omitempty"`
}

// AgencyProfile is a Hub user's profile as an agency sees it.
type AgencyProfile struct {
	Profile         profile.PublicProfile `json:"profile"`
	VerifiedDomains []VerifiedDomain      `json:"verified_domains"`
	Contact         *ContactSummary       `json:"contact,omitempty"`
}

type ViewHubProfileRequest struct {
	Address profile.ProfileAddress `json:"address"`
}

func (r *ViewHubProfileRequest) Normalize() {
	r.Address = profile.ProfileAddress(strings.TrimSpace(string(r.Address)))
}

func (r ViewHubProfileRequest) Validate() []string {
	if !profile.IsProfileAddress(r.Address) {
		return []string{"address"}
	}
	return []string{}
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

func effectiveLimit(limit *int32) int32 {
	if limit == nil {
		return DefaultPage
	}
	return *limit
}

type ListContactsRequest struct {
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
	Filter        *ContactFilter        `json:"filter,omitempty"`
	NameQuery     *ContactNameQuery     `json:"name_query,omitempty"`
}

func (r *ListContactsRequest) Normalize() {
	if r.NameQuery != nil {
		query := NormalizeContactNameQuery(*r.NameQuery)
		r.NameQuery = &query
	}
}

func (r ListContactsRequest) EffectiveLimit() int32 { return effectiveLimit(r.Limit) }

func (r ListContactsRequest) EffectiveFilter() ContactFilter {
	if r.Filter == nil {
		return ContactFilterAll
	}
	return *r.Filter
}

func (r ListContactsRequest) Validate() []string {
	fields := validPage(r.PaginationKey, r.Limit)
	if r.Filter != nil {
		switch *r.Filter {
		case ContactFilterAll, ContactFilterRequests, ContactFilterUnread,
			ContactFilterHasConversation,
			ContactFilterNotContacted:
		default:
			fields = append(fields, "filter")
		}
	}
	if r.NameQuery != nil && !IsContactNameQuery(*r.NameQuery) {
		fields = append(fields, "name_query")
	}
	return fields
}

// ContactCounts is how many of the agency's Contacts each Contacts tab holds.
type ContactCounts struct {
	All             int32 `json:"all"`
	Requests        int32 `json:"requests"`
	Unread          int32 `json:"unread"`
	HasConversation int32 `json:"has_conversation"`
	NotContacted    int32 `json:"not_contacted"`
}

type ListContactsResponse struct {
	Items []ContactSummary `json:"items"`
	// Counts counts every Contact of the agency, whatever the filter and
	// query.
	Counts            ContactCounts         `json:"counts"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type ContactReference struct {
	ContactID ContactID `json:"contact_id"`
}

func (r *ContactReference) Normalize() {}

func (r ContactReference) Validate() []string {
	if !IsContactID(r.ContactID) {
		return []string{"contact_id"}
	}
	return []string{}
}

type ListContactNotesRequest struct {
	ContactID     ContactID             `json:"contact_id"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListContactNotesRequest) Normalize() {}

func (r ListContactNotesRequest) EffectiveLimit() int32 { return effectiveLimit(r.Limit) }

func (r ListContactNotesRequest) Validate() []string {
	fields := []string{}
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	return append(fields, validPage(r.PaginationKey, r.Limit)...)
}

type ListContactNotesResponse struct {
	Items             []ContactNote         `json:"items"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// AddPersonNoteRequest writes a note on the person at Address, creating the
// agency's Contact if it has none.
type AddPersonNoteRequest struct {
	Address profile.ProfileAddress `json:"address"`
	Text    NoteText               `json:"text"`
}

func (r *AddPersonNoteRequest) Normalize() {
	r.Address = profile.ProfileAddress(strings.TrimSpace(string(r.Address)))
	r.Text = NormalizeNoteText(r.Text)
}

func (r AddPersonNoteRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Address) {
		fields = append(fields, "address")
	}
	if !IsNoteText(r.Text) {
		fields = append(fields, "text")
	}
	return fields
}

type AddContactNoteRequest struct {
	ContactID ContactID `json:"contact_id"`
	Text      NoteText  `json:"text"`
}

func (r *AddContactNoteRequest) Normalize() { r.Text = NormalizeNoteText(r.Text) }

func (r AddContactNoteRequest) Validate() []string {
	fields := []string{}
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if !IsNoteText(r.Text) {
		fields = append(fields, "text")
	}
	return fields
}

// AddedNote is the note written and the Contact it belongs to.
type AddedNote struct {
	Contact ContactSummary `json:"contact"`
	Note    ContactNote    `json:"note"`
}

type EditContactNoteRequest struct {
	ContactID ContactID     `json:"contact_id"`
	NoteID    ContactNoteID `json:"note_id"`
	Text      NoteText      `json:"text"`
}

func (r *EditContactNoteRequest) Normalize() { r.Text = NormalizeNoteText(r.Text) }

func (r EditContactNoteRequest) Validate() []string {
	fields := []string{}
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if !IsContactNoteID(r.NoteID) {
		fields = append(fields, "note_id")
	}
	if !IsNoteText(r.Text) {
		fields = append(fields, "text")
	}
	return fields
}

type DeleteContactNoteRequest struct {
	ContactID ContactID     `json:"contact_id"`
	NoteID    ContactNoteID `json:"note_id"`
}

func (r *DeleteContactNoteRequest) Normalize() {}

func (r DeleteContactNoteRequest) Validate() []string {
	fields := []string{}
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if !IsContactNoteID(r.NoteID) {
		fields = append(fields, "note_id")
	}
	return fields
}

type DeletedNote struct {
	ContactDeleted bool `json:"contact_deleted"`
}

type StartConversationRequest struct {
	Address    profile.ProfileAddress `json:"address"`
	Text       *MessageText           `json:"text,omitempty"`
	Suggestion *OpeningSuggestion     `json:"suggestion,omitempty"`
}

func (r *StartConversationRequest) Normalize() {
	r.Address = profile.ProfileAddress(strings.TrimSpace(string(r.Address)))
	if r.Text != nil {
		normalized := NormalizeMessageText(*r.Text)
		r.Text = &normalized
	}
}

func (r StartConversationRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Address) {
		fields = append(fields, "address")
	}
	hasText := r.Text != nil && IsMessageText(*r.Text)
	hasSuggestion := r.Suggestion != nil && r.Suggestion.Valid()
	if (!hasText && !hasSuggestion) || (hasText && hasSuggestion) {
		if r.Text != nil && !IsMessageText(*r.Text) {
			fields = append(fields, "text")
		} else if r.Suggestion != nil && !r.Suggestion.Valid() {
			fields = append(fields, "suggestion")
		} else {
			fields = append(fields, "text")
		}
	}
	return fields
}

// SendChatRequestRequest asks a person, by handle or alias or by the
// agency's Contact, to open the conversation about an Opening. Exactly one of
// Address and ContactID.
type SendChatRequestRequest struct {
	Address    *profile.ProfileAddress `json:"address,omitempty"`
	ContactID  *ContactID              `json:"contact_id,omitempty"`
	Suggestion OpeningSuggestion       `json:"suggestion"`
	Note       *ChatRequestNote        `json:"note,omitempty"`
}

func (r *SendChatRequestRequest) Normalize() {
	if r.Address != nil {
		address := profile.ProfileAddress(strings.TrimSpace(string(*r.Address)))
		r.Address = &address
	}
	if r.Note != nil {
		note := NormalizeChatRequestNote(*r.Note)
		r.Note = &note
	}
}

func (r SendChatRequestRequest) Validate() []string {
	fields := []string{}
	switch {
	case r.Address == nil && r.ContactID == nil,
		r.Address != nil && r.ContactID != nil:
		fields = append(fields, "address", "contact_id")
	case r.Address != nil && !profile.IsProfileAddress(*r.Address):
		fields = append(fields, "address")
	case r.ContactID != nil && !IsContactID(*r.ContactID):
		fields = append(fields, "contact_id")
	}
	if !r.Suggestion.Valid() {
		fields = append(fields, "suggestion")
	}
	if r.Note != nil && !IsChatRequestNote(*r.Note) {
		fields = append(fields, "note")
	}
	return fields
}

type ListChatRequestsRequest struct {
	Direction     ChatRequestDirection  `json:"direction"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListChatRequestsRequest) Normalize() {}

func (r ListChatRequestsRequest) EffectiveLimit() int32 { return effectiveLimit(r.Limit) }

func (r ListChatRequestsRequest) Validate() []string {
	fields := []string{}
	if !IsChatRequestDirection(r.Direction) {
		fields = append(fields, "direction")
	}
	return append(fields, validPage(r.PaginationKey, r.Limit)...)
}

type ListChatRequestsResponse struct {
	// Items holds pending requests oldest first, then answered ones newest
	// first.
	Items             []ChatRequest         `json:"items"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

// PendingChatRequestCount counts the Hub users' requests awaiting the
// agency's answer.
type PendingChatRequestCount struct {
	Count int32 `json:"count"`
}

type AcceptChatRequestRequest struct {
	RequestID ChatRequestID `json:"request_id"`
}

func (r *AcceptChatRequestRequest) Normalize() {}

func (r AcceptChatRequestRequest) Validate() []string {
	if !IsChatRequestID(r.RequestID) {
		return []string{"request_id"}
	}
	return []string{}
}

type DeclineChatRequestRequest struct {
	RequestID ChatRequestID           `json:"request_id"`
	Scope     ChatRequestDeclineScope `json:"scope"`
}

func (r *DeclineChatRequestRequest) Normalize() {}

func (r DeclineChatRequestRequest) Validate() []string {
	fields := []string{}
	if !IsChatRequestID(r.RequestID) {
		fields = append(fields, "request_id")
	}
	if !IsChatRequestDeclineScope(r.Scope) {
		fields = append(fields, "scope")
	}
	return fields
}

type SendMessageRequest struct {
	ContactID  ContactID          `json:"contact_id"`
	Text       *MessageText       `json:"text,omitempty"`
	Suggestion *OpeningSuggestion `json:"suggestion,omitempty"`
}

func (r *SendMessageRequest) Normalize() {
	if r.Text != nil {
		normalized := NormalizeMessageText(*r.Text)
		r.Text = &normalized
	}
}

func (r SendMessageRequest) Validate() []string {
	fields := []string{}
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	hasText := r.Text != nil && IsMessageText(*r.Text)
	hasSuggestion := r.Suggestion != nil && r.Suggestion.Valid()
	if (!hasText && !hasSuggestion) || (hasText && hasSuggestion) {
		if r.Text != nil && !IsMessageText(*r.Text) {
			fields = append(fields, "text")
		} else if r.Suggestion != nil && !r.Suggestion.Valid() {
			fields = append(fields, "suggestion")
		} else {
			fields = append(fields, "text")
		}
	}
	return fields
}

type GetConversationRequest struct {
	ContactID     ContactID             `json:"contact_id"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *GetConversationRequest) Normalize() {}

func (r GetConversationRequest) EffectiveLimit() int32 { return effectiveLimit(r.Limit) }

func (r GetConversationRequest) Validate() []string {
	fields := validPage(r.PaginationKey, r.Limit)
	if !IsContactID(r.ContactID) {
		fields = append(fields, "contact_id")
	}
	if len(fields) > 0 {
		return fields
	}
	return []string{}
}

type MarkConversationReadRequest struct {
	ContactID ContactID `json:"contact_id"`
}

func (r *MarkConversationReadRequest) Normalize() {}

func (r MarkConversationReadRequest) Validate() []string {
	if !IsContactID(r.ContactID) {
		return []string{"contact_id"}
	}
	return []string{}
}
