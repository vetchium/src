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
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
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
