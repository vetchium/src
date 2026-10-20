package contacts

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
)

const (
	// MaxNotesPerContact bounds the notes on one Contact (MKT-NOTE-001).
	MaxNotesPerContact = 200
	// MaxNewContactsPerDay bounds the Contacts an agency creates per UTC day,
	// counting those a conversation creates (MKT-CON-005).
	MaxNewContactsPerDay = 200
	// MaxNoteLength bounds a note in code points.
	MaxNoteLength = 5000
	// MaxPage bounds one page of Contacts or notes.
	MaxPage = 100
	// DefaultPage is the page size when a request names none.
	DefaultPage = 50
)

// ContactID names one Contact of an agency; never reused.
type ContactID string

type ContactNoteID string

// NoteText is plain text of 1–5,000 code points once trimmed.
type NoteText string

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

func NormalizeNoteText(value NoteText) NoteText {
	return NoteText(strings.TrimSpace(string(value)))
}

func IsNoteText(value NoteText) bool {
	length := utf8.RuneCountInString(string(NormalizeNoteText(value)))
	return length >= 1 && length <= MaxNoteLength
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
	ContactID      ContactID          `json:"contact_id"`
	DisplayName    common.DisplayName `json:"display_name"`
	Handle         hub.HubHandle      `json:"handle"`
	MessagesOff    bool               `json:"messages_off"`
	NoteCount      int32              `json:"note_count"`
	LastActivityAt time.Time          `json:"last_activity_at"`
}

func (c ContactSummary) Valid() bool {
	return IsContactID(c.ContactID) && common.IsDisplayName(c.DisplayName) &&
		hub.IsHubHandle(c.Handle) && c.NoteCount >= 0 &&
		c.NoteCount <= MaxNotesPerContact
}

type Contact struct {
	ContactSummary
	CreatedBy common.EmailAddress `json:"created_by"`
	CreatedAt time.Time           `json:"created_at"`
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
}

func (r *ListContactsRequest) Normalize() {}

func (r ListContactsRequest) EffectiveLimit() int32 { return effectiveLimit(r.Limit) }

func (r ListContactsRequest) Validate() []string {
	return validPage(r.PaginationKey, r.Limit)
}

type ListContactsResponse struct {
	Items             []ContactSummary      `json:"items"`
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
