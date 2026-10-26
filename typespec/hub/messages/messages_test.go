package messages

import (
	"slices"
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
