package contacts

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

const (
	contactID = ContactID("01900000-0000-7000-8000-000000000001")
	noteID    = ContactNoteID("01900000-0000-7000-8000-000000000002")
	orgDID    = orgs.OrgDID("01900000-0000-7000-8000-000000000003")
)

func TestNoteTextBounds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		text NoteText
		want bool
	}{
		{"one letter", "a", true},
		{"padded", "  note  ", true},
		{"empty", "", false},
		{"blank", " \n\t ", false},
		{"limit in code points", NoteText(strings.Repeat("é", MaxNoteLength)), true},
		{"over the limit", NoteText(strings.Repeat("é", MaxNoteLength+1)), false},
		{"padding does not count", NoteText(" " + strings.Repeat("a", MaxNoteLength) + " "), true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsNoteText(test.text); got != test.want {
				t.Fatalf("IsNoteText = %t, want %t", got, test.want)
			}
		})
	}
}

func TestRequestsNormalizeOnACopyAndValidate(t *testing.T) {
	t.Parallel()
	original := AddPersonNoteRequest{Address: " priya ", Text: "  hello \n"}
	copied := original
	copied.Normalize()
	if copied.Address != "priya" || copied.Text != "hello" {
		t.Fatalf("normalized = %+v", copied)
	}
	if original.Address != " priya " || original.Text != "  hello \n" {
		t.Fatalf("the original changed: %+v", original)
	}
	badLimit, goodLimit := int32(101), int32(100)
	key := common.PaginationKey("")
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"person note", copied.Validate(), []string{}},
		{"person note invalid", AddPersonNoteRequest{Address: "x", Text: " "}.Validate(), []string{"address", "text"}},
		{"contact note", AddContactNoteRequest{ContactID: contactID, Text: "t"}.Validate(), []string{}},
		{"contact note invalid", AddContactNoteRequest{ContactID: "x"}.Validate(), []string{"contact_id", "text"}},
		{"edit", EditContactNoteRequest{ContactID: contactID, NoteID: noteID, Text: "t"}.Validate(), []string{}},
		{"edit invalid", EditContactNoteRequest{}.Validate(), []string{"contact_id", "note_id", "text"}},
		{"delete", DeleteContactNoteRequest{ContactID: contactID, NoteID: noteID}.Validate(), []string{}},
		{"delete invalid", DeleteContactNoteRequest{NoteID: "x"}.Validate(), []string{"contact_id", "note_id"}},
		{"reference", ContactReference{ContactID: contactID}.Validate(), []string{}},
		{"reference invalid", ContactReference{}.Validate(), []string{"contact_id"}},
		{"view", ViewHubProfileRequest{Address: "priya"}.Validate(), []string{}},
		{"view invalid", ViewHubProfileRequest{}.Validate(), []string{"address"}},
		{"list", ListContactsRequest{Limit: &goodLimit}.Validate(), []string{}},
		{"list invalid", ListContactsRequest{Limit: &badLimit, PaginationKey: &key}.Validate(), []string{"pagination_key", "limit"}},
		{"notes", ListContactNotesRequest{ContactID: contactID}.Validate(), []string{}},
		{"notes invalid", ListContactNotesRequest{Limit: &badLimit}.Validate(), []string{"contact_id", "limit"}},
		{"relay", RelayReadAgencyProfileRequest{AgencyOrgDID: orgDID, Address: "priya"}.Validate(), []string{}},
		{"relay invalid", RelayReadAgencyProfileRequest{}.Validate(), []string{"agency_org_did", "address"}},
		{"peer invalid", PeerReadAgencyProfileRequest{}.Validate(), []string{"agency_org_did", "target_hub_user_did"}},
		{"start conv text", StartConversationRequest{Address: "priya", Text: messageText("hello")}.Validate(), []string{}},
		{"start conv suggestion", StartConversationRequest{Address: "priya", Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{}},
		{"start conv both invalid", StartConversationRequest{Address: "priya", Text: messageText("hello"), Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{"text"}},
		{"start conv neither invalid", StartConversationRequest{Address: "priya"}.Validate(), []string{"text"}},
		{"start conv bad address", StartConversationRequest{Address: " ", Text: messageText("hello")}.Validate(), []string{"address"}},
		{"send message text", SendMessageRequest{ContactID: contactID, Text: messageText("hello")}.Validate(), []string{}},
		{"send message suggestion", SendMessageRequest{ContactID: contactID, Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{}},
		{"send message both invalid", SendMessageRequest{ContactID: contactID, Text: messageText("hello"), Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{"text"}},
		{"send message neither invalid", SendMessageRequest{ContactID: contactID}.Validate(), []string{"text"}},
		{"send message bad contact", SendMessageRequest{ContactID: "bad", Text: messageText("hello")}.Validate(), []string{"contact_id"}},
		{"get conv", GetConversationRequest{ContactID: contactID}.Validate(), []string{}},
		{"get conv invalid", GetConversationRequest{ContactID: "bad"}.Validate(), []string{"contact_id"}},
		{"mark read", MarkConversationReadRequest{ContactID: contactID}.Validate(), []string{}},
		{"mark read invalid", MarkConversationReadRequest{ContactID: "bad"}.Validate(), []string{"contact_id"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
}

func messageText(s string) *MessageText {
	t := MessageText(s)
	return &t
}

func TestMessageTextBounds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		text MessageText
		want bool
	}{
		{"one letter", "a", true},
		{"padded", "  message  ", true},
		{"empty", "", false},
		{"blank", " \n\t ", false},
		{"limit in code points", MessageText(strings.Repeat("é", MaxMessageLength)), true},
		{"over the limit", MessageText(strings.Repeat("é", MaxMessageLength+1)), false},
		{"padding does not count", MessageText(" " + strings.Repeat("a", MaxMessageLength) + " "), true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsMessageText(test.text); got != test.want {
				t.Fatalf("IsMessageText = %t, want %t", got, test.want)
			}
		})
	}
}

func TestPageDefaultsAndCaps(t *testing.T) {
	t.Parallel()
	if (ListContactsRequest{}).EffectiveLimit() != DefaultPage ||
		(ListContactNotesRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a request without a limit takes the default page")
	}
	if MaxNotesPerContact != 200 || MaxNewContactsPerDay != 200 || MaxNoteLength != 5000 {
		t.Fatal("the caps are 200 notes per Contact, 200 new Contacts per day, and 5,000 code points")
	}
	if MaxNewConversationsPerDay != 50 || MaxMessageLength != 5000 {
		t.Fatal("the caps are 50 new conversations per day and 5,000 code points per message")
	}
}

func TestVerifiedDomainCarriesMonthsOnly(t *testing.T) {
	t.Parallel()
	valid := VerifiedDomain{Domain: "acme.example", FirstVerifiedMonth: "2024-03", LastVerifiedMonth: "2025-01"}
	if !valid.Valid() {
		t.Fatal("a domain with ordered months is valid")
	}
	for name, domain := range map[string]VerifiedDomain{
		"reversed months": {Domain: "acme.example", FirstVerifiedMonth: "2025-01", LastVerifiedMonth: "2024-03"},
		"an instant":      {Domain: "acme.example", FirstVerifiedMonth: "2024-03-01T00:00:00Z", LastVerifiedMonth: "2025-01"},
		"an address":      {Domain: "me@acme.example", FirstVerifiedMonth: "2024-03", LastVerifiedMonth: "2025-01"},
	} {
		if domain.Valid() {
			t.Fatalf("%s must be invalid", name)
		}
	}
}

func TestAgencyProfileReadMustBeComplete(t *testing.T) {
	t.Parallel()
	read := AgencyProfileRead{}
	if read.Valid() {
		t.Fatal("an empty read is invalid")
	}
}

func TestListContactsFiltersAndNameQuery(t *testing.T) {
	t.Parallel()
	filter := func(value ContactFilter) *ContactFilter { return &value }
	query := func(value ContactNameQuery) *ContactNameQuery { return &value }
	for _, value := range []ContactFilter{ContactFilterAll, ContactFilterUnread,
		ContactFilterHasConversation, ContactFilterNotContacted} {
		if got := (ListContactsRequest{Filter: filter(value)}).Validate(); len(got) != 0 {
			t.Fatalf("filter %q rejected: %v", value, got)
		}
	}
	if (ListContactsRequest{}).EffectiveFilter() != ContactFilterAll {
		t.Fatal("a request without a filter lists every Contact")
	}
	badLimit := int32(0)
	got := ListContactsRequest{Limit: &badLimit, Filter: filter("archived"), NameQuery: query("a")}.Validate()
	if want := []string{"limit", "filter", "name_query"}; !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	for name, test := range map[string]struct {
		query ContactNameQuery
		want  bool
	}{
		"two letters":       {"ad", true},
		"limit":             {ContactNameQuery(strings.Repeat("é", 100)), true},
		"one letter":        {"a", false},
		"over the limit":    {ContactNameQuery(strings.Repeat("é", 101)), false},
		"untrimmed padding": {" ada", false},
	} {
		if got := IsContactNameQuery(test.query); got != test.want {
			t.Fatalf("%s: IsContactNameQuery = %t, want %t", name, got, test.want)
		}
	}
	original := ListContactsRequest{NameQuery: query("  ada ")}
	copied := original
	copied.Normalize()
	if *copied.NameQuery != "ada" || *original.NameQuery != "  ada " {
		t.Fatalf("normalized %q from %q", *copied.NameQuery, *original.NameQuery)
	}
}

func TestGetConversationPages(t *testing.T) {
	t.Parallel()
	limit, badLimit := int32(1), int32(101)
	key := common.PaginationKey("")
	if got := (GetConversationRequest{ContactID: contactID, Limit: &limit}).Validate(); len(got) != 0 {
		t.Fatalf("valid page rejected: %v", got)
	}
	got := GetConversationRequest{ContactID: "x", PaginationKey: &key, Limit: &badLimit}.Validate()
	if want := []string{"pagination_key", "limit", "contact_id"}; !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	if (GetConversationRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a conversation read without a limit takes the default page")
	}
}
