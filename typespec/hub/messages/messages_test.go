package messages

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
)

const agency = orgs.OrgDomain("agency.test")

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
		{"get valid", GetConversationRequest{AgencyDomain: agency}.Validate(), []string{}},
		{"get invalid", GetConversationRequest{AgencyDomain: "bad"}.Validate(), []string{"agency_domain"}},
		{"get page", GetConversationRequest{AgencyDomain: agency, Limit: &goodLimit}.Validate(), []string{}},
		{"get page invalid", GetConversationRequest{AgencyDomain: "bad", PaginationKey: &key, Limit: &badLimit}.Validate(), []string{"agency_domain", "pagination_key", "limit"}},
		{"reply valid", ReplyToConversationRequest{AgencyDomain: agency, Text: "hello"}.Validate(), []string{}},
		{"reply invalid", ReplyToConversationRequest{AgencyDomain: "bad", Text: " "}.Validate(), []string{"agency_domain", "text"}},
		{"delete valid", DeleteMessageRequest{AgencyDomain: agency, MessageNumber: 2}.Validate(), []string{}},
		{"delete invalid", DeleteMessageRequest{AgencyDomain: "bad"}.Validate(), []string{"agency_domain", "message_number"}},
		{"mark read valid", MarkConversationReadRequest{AgencyDomain: agency}.Validate(), []string{}},
		{"mark read invalid", MarkConversationReadRequest{AgencyDomain: "bad"}.Validate(), []string{"agency_domain"}},
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
		{"accept", HubAcceptChatRequestRequest{AgencyDomain: agency, RequestNumber: 1}.Validate(), []string{}},
		{"accept invalid", HubAcceptChatRequestRequest{}.Validate(), []string{"agency_domain", "request_number"}},
		{"decline", HubDeclineChatRequestRequest{AgencyDomain: agency, RequestNumber: 1, Scope: contacts.DeclineOpening}.Validate(), []string{}},
		{"decline invalid", HubDeclineChatRequestRequest{Scope: "x"}.Validate(), []string{"agency_domain", "request_number", "scope"}},
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
