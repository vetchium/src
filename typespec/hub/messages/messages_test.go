package messages

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
)

const (
	contactID = contacts.ContactID("01900000-0000-7000-8000-000000000001")
)

func TestMessagesValidation(t *testing.T) {
	t.Parallel()
	badLimit, goodLimit := int32(101), int32(100)
	key := common.PaginationKey("")
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"list valid", ListConversationsRequest{Limit: &goodLimit}.Validate(), []string{}},
		{"list invalid", ListConversationsRequest{Limit: &badLimit, PaginationKey: &key}.Validate(), []string{"pagination_key", "limit"}},
		{"get valid", GetConversationRequest{ContactID: contactID}.Validate(), []string{}},
		{"get invalid", GetConversationRequest{ContactID: "bad"}.Validate(), []string{"contact_id"}},
		{"get page", GetConversationRequest{ContactID: contactID, Limit: &goodLimit}.Validate(), []string{}},
		{"get page invalid", GetConversationRequest{ContactID: "bad", PaginationKey: &key, Limit: &badLimit}.Validate(), []string{"pagination_key", "limit", "contact_id"}},
		{"reply valid", ReplyToConversationRequest{ContactID: contactID, Text: "hello"}.Validate(), []string{}},
		{"reply invalid", ReplyToConversationRequest{ContactID: "bad", Text: " "}.Validate(), []string{"contact_id", "text"}},
		{"delete valid", DeleteConversationRequest{ContactID: contactID}.Validate(), []string{}},
		{"delete invalid", DeleteConversationRequest{ContactID: "bad"}.Validate(), []string{"contact_id"}},
		{"mark read valid", MarkConversationReadRequest{ContactID: contactID}.Validate(), []string{}},
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

func TestPageDefaults(t *testing.T) {
	t.Parallel()
	if (ListConversationsRequest{}).EffectiveLimit() != DefaultPage ||
		(GetConversationRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a request without a limit takes the default page")
	}
}

func TestChatRequestValidation(t *testing.T) {
	t.Parallel()
	const requestID = contacts.ChatRequestID("01900000-0000-7000-8000-000000000005")
	note := contacts.ChatRequestNote("  hi  ")
	original := HubSendChatRequestRequest{Domain: " Client.Test ", OpeningNumber: 1,
		AgencyDomain: "Agency.Test", Note: &note}
	copied := original
	copied.Normalize()
	if copied.Domain != "client.test" || copied.AgencyDomain != "agency.test" || *copied.Note != "hi" {
		t.Fatalf("normalized = %+v %q", copied, *copied.Note)
	}
	if *original.Note != "  hi  " || original.Domain != " Client.Test " {
		t.Fatal("the original changed")
	}
	long := contacts.ChatRequestNote(strings.Repeat("a", contacts.MaxChatRequestNoteLength+1))
	badLimit := int32(0)
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"agencies", ListOpeningAgenciesRequest{Domain: "client.test", OpeningNumber: 1}.Validate(), []string{}},
		{"agencies invalid", ListOpeningAgenciesRequest{Domain: "x"}.Validate(), []string{"domain", "opening_number"}},
		{"send", copied.Validate(), []string{}},
		{"send invalid", HubSendChatRequestRequest{Note: &long}.Validate(), []string{"domain", "opening_number", "agency_domain", "note"}},
		{"list", ListHubChatRequestsRequest{Direction: contacts.ToHubUser}.Validate(), []string{}},
		{"list invalid", ListHubChatRequestsRequest{Limit: &badLimit}.Validate(), []string{"direction", "limit"}},
		{"accept", HubAcceptChatRequestRequest{RequestID: requestID}.Validate(), []string{}},
		{"accept invalid", HubAcceptChatRequestRequest{}.Validate(), []string{"request_id"}},
		{"decline", HubDeclineChatRequestRequest{RequestID: requestID, Scope: contacts.DeclineOpening}.Validate(), []string{}},
		{"decline invalid", HubDeclineChatRequestRequest{Scope: "x"}.Validate(), []string{"request_id", "scope"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
	if MaxChatRequestsPerDay != 10 || (ListHubChatRequestsRequest{}).EffectiveLimit() != DefaultPage {
		t.Fatal("a Hub user sends at most 10 chat requests per day; lists default to one page")
	}
}
