package contacts

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
)

const (
	handle = hub.HubHandle("priyaaaa-00000000001")
	orgDID = orgs.OrgDID("01900000-0000-7000-8000-000000000003")
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
		{"contact note", AddContactNoteRequest{Handle: handle, Text: "t"}.Validate(), []string{}},
		{"contact note invalid", AddContactNoteRequest{Handle: "x"}.Validate(), []string{"handle", "text"}},
		{"edit", EditContactNoteRequest{Handle: handle, NoteNumber: 1, Text: "t"}.Validate(), []string{}},
		{"edit invalid", EditContactNoteRequest{}.Validate(), []string{"handle", "note_number", "text"}},
		{"reference", ContactReference{Handle: handle}.Validate(), []string{}},
		{"reference invalid", ContactReference{}.Validate(), []string{"handle"}},
		{"reference alias", ContactReference{Handle: "priya"}.Validate(), []string{"handle"}},
		{"view", ViewHubProfileRequest{Address: "priya"}.Validate(), []string{}},
		{"view invalid", ViewHubProfileRequest{}.Validate(), []string{"address"}},
		{"list", ListContactsRequest{Limit: &goodLimit}.Validate(), []string{}},
		{"list invalid", ListContactsRequest{Limit: &badLimit, PaginationKey: &key}.Validate(), []string{"pagination_key", "limit"}},
		{"notes", ListContactNotesRequest{Handle: handle}.Validate(), []string{}},
		{"notes invalid", ListContactNotesRequest{Limit: &badLimit}.Validate(), []string{"handle", "limit"}},
		{"relay", RelayReadAgencyProfileRequest{AgencyOrgDID: orgDID, Address: "priya"}.Validate(), []string{}},
		{"relay invalid", RelayReadAgencyProfileRequest{}.Validate(), []string{"agency_org_did", "address"}},
		{"peer invalid", PeerReadAgencyProfileRequest{}.Validate(), []string{"agency_org_did", "target_hub_user_did"}},
		{"send message text", SendMessageRequest{Handle: handle, Text: messageText("hello")}.Validate(), []string{}},
		{"send message suggestion", SendMessageRequest{Handle: handle, Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{}},
		{"send message both invalid", SendMessageRequest{Handle: handle, Text: messageText("hello"), Suggestion: &OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}.Validate(), []string{"text"}},
		{"send message neither invalid", SendMessageRequest{Handle: handle}.Validate(), []string{"text"}},
		{"send message bad contact", SendMessageRequest{Handle: "bad", Text: messageText("hello")}.Validate(), []string{"handle"}},
		{"delete message", DeleteMessageRequest{Handle: handle, MessageNumber: 3}.Validate(), []string{}},
		{"delete message invalid", DeleteMessageRequest{}.Validate(), []string{"handle", "message_number"}},
		{"get conv", GetConversationRequest{Handle: handle}.Validate(), []string{}},
		{"get conv invalid", GetConversationRequest{Handle: "bad"}.Validate(), []string{"handle"}},
		{"mark read", MarkConversationReadRequest{Handle: handle}.Validate(), []string{}},
		{"mark read invalid", MarkConversationReadRequest{Handle: "bad"}.Validate(), []string{"handle"}},
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
	if MaxMessageLength != 5000 {
		t.Fatal("the cap is 5,000 code points per message")
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
		ContactFilterRequests, ContactFilterHasConversation} {
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
	if got := (GetConversationRequest{Handle: handle, Limit: &limit}).Validate(); len(got) != 0 {
		t.Fatalf("valid page rejected: %v", got)
	}
	got := GetConversationRequest{Handle: "x", PaginationKey: &key, Limit: &badLimit}.Validate()
	if want := []string{"handle", "pagination_key", "limit"}; !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	if (GetConversationRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a conversation read without a limit takes the default page")
	}
}

func TestChatRequestNoteBounds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		note ChatRequestNote
		want bool
	}{
		{"one letter", "a", true},
		{"padded", "  hi  ", true},
		{"blank", " \n ", false},
		{"limit in code points", ChatRequestNote(strings.Repeat("é", MaxChatRequestNoteLength)), true},
		{"over the limit", ChatRequestNote(strings.Repeat("é", MaxChatRequestNoteLength+1)), false},
		{"padding does not count", ChatRequestNote(" " + strings.Repeat("a", MaxChatRequestNoteLength) + " "), true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsChatRequestNote(test.note); got != test.want {
				t.Fatalf("IsChatRequestNote = %t, want %t", got, test.want)
			}
		})
	}
	if MaxChatRequestsPerDay != 50 {
		t.Fatal("an agency sends at most 50 chat requests per UTC day")
	}
}

func TestChatRequestRequestsNormalizeOnACopyAndValidate(t *testing.T) {
	t.Parallel()
	note := ChatRequestNote("  hello \n")
	original := SendChatRequestRequest{Address: " priya ", Note: &note,
		Suggestion: OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}}
	copied := original
	copied.Normalize()
	if copied.Address != "priya" || *copied.Note != "hello" {
		t.Fatalf("normalized = %q %q", copied.Address, *copied.Note)
	}
	if original.Address != " priya " || *original.Note != "  hello \n" {
		t.Fatalf("the original changed: %q %q", original.Address, *original.Note)
	}
	blank := ChatRequestNote(" ")
	opening := OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 1}
	badLimit := int32(101)
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"by address", copied.Validate(), []string{}},
		{"by handle", SendChatRequestRequest{Address: "priyaaaa-00000000001", Suggestion: opening}.Validate(), []string{}},
		{"no person", SendChatRequestRequest{Suggestion: opening}.Validate(), []string{"address"}},
		{"bad address", SendChatRequestRequest{Address: "x", Suggestion: opening}.Validate(), []string{"address"}},
		{"bad opening and note", SendChatRequestRequest{Address: "priya", Note: &blank}.Validate(), []string{"suggestion", "note"}},
		{"list", ListChatRequestsRequest{Direction: ToAgency}.Validate(), []string{}},
		{"list invalid", ListChatRequestsRequest{Direction: "sideways", Limit: &badLimit}.Validate(), []string{"direction", "limit"}},
		{"accept", AcceptChatRequestRequest{Handle: handle, RequestNumber: 1}.Validate(), []string{}},
		{"accept invalid", AcceptChatRequestRequest{}.Validate(), []string{"handle", "request_number"}},
		{"decline opening", DeclineChatRequestRequest{Handle: handle, RequestNumber: 2, Scope: DeclineOpening}.Validate(), []string{}},
		{"decline sender", DeclineChatRequestRequest{Handle: handle, RequestNumber: 2, Scope: DeclineSender}.Validate(), []string{}},
		{"decline invalid", DeclineChatRequestRequest{Handle: "x", Scope: "forever"}.Validate(), []string{"handle", "request_number", "scope"}},
		{"requests filter", ListContactsRequest{Filter: ptr(ContactFilterRequests)}.Validate(), []string{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
	if (ListChatRequestsRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a request list without a limit takes the default page")
	}
}

func ptr[T any](value T) *T { return &value }

func TestContactStatusesAreClosed(t *testing.T) {
	t.Parallel()
	for _, status := range []ContactStatus{ContactRequestReceived,
		ContactRequestSent, ContactInConversation, ContactRequestDeclined,
		ContactRequestExpired, ContactConversationClosed,
		ContactNoConversation} {
		if !IsContactStatus(status) {
			t.Fatalf("status %q rejected", status)
		}
	}
	if IsContactStatus("not_contacted") {
		t.Fatal("an unknown status is accepted")
	}
}
