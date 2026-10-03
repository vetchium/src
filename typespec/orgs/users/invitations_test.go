package users

import (
	"fmt"
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/authorization"
)

func addresses(count int) []InviteeAddress {
	result := make([]InviteeAddress, count)
	for index := range result {
		result[index] = InviteeAddress(fmt.Sprintf("user%d@example.com", index))
	}
	return result
}

func TestInviteUsersRequestNormalizeDoesNotMutateTheCallersSlice(t *testing.T) {
	t.Parallel()
	original := []InviteeAddress{" A@Example.COM "}
	request := InviteUsersRequest{EmailAddresses: original}
	request.Normalize()
	if request.EmailAddresses[0] != "a@example.com" {
		t.Fatalf("normalized = %q", request.EmailAddresses[0])
	}
	if original[0] != " A@Example.COM " {
		t.Fatalf("caller slice mutated to %q", original[0])
	}
}

func TestInviteUsersRequestValidate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		request InviteUsersRequest
		want    []string
	}{
		{"one address", InviteUsersRequest{EmailAddresses: addresses(1)}, []string{}},
		{"hundred addresses", InviteUsersRequest{EmailAddresses: addresses(100)}, []string{}},
		{"none", InviteUsersRequest{}, []string{"email_addresses"}},
		{"too many", InviteUsersRequest{EmailAddresses: addresses(101)}, []string{"email_addresses"}},
		{
			"duplicate after normalization",
			InviteUsersRequest{EmailAddresses: []InviteeAddress{"a@example.com", " A@EXAMPLE.com"}},
			[]string{"email_addresses"},
		},
		{
			"invalid address is the server's to report per address",
			InviteUsersRequest{EmailAddresses: []InviteeAddress{"not-an-address"}},
			[]string{},
		},
		{
			"empty entry",
			InviteUsersRequest{EmailAddresses: []InviteeAddress{""}},
			[]string{"email_addresses"},
		},
		{
			"unknown permission",
			InviteUsersRequest{
				EmailAddresses: addresses(1),
				Permissions:    []authorization.OrgPermissionID{"org:future"},
			},
			[]string{"permissions"},
		},
		{
			"duplicate permission",
			InviteUsersRequest{
				EmailAddresses: addresses(1),
				Permissions: []authorization.OrgPermissionID{
					"org:manage_users", "org:manage_users",
				},
			},
			[]string{"permissions"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			request := testCase.request
			request.Normalize()
			if got := request.Validate(); !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestListInvitationsRequestValidate(t *testing.T) {
	t.Parallel()
	zero, hundred, tooMany := common.PageSize(0), common.PageSize(100), common.PageSize(101)
	short, long := InvitationFilterText("a"), InvitationFilterText("ab")
	cases := []struct {
		name    string
		request ListInvitationsRequest
		want    []string
	}{
		{"defaults", ListInvitationsRequest{}, []string{}},
		{"limit 100", ListInvitationsRequest{Limit: &hundred}, []string{}},
		{"limit 0", ListInvitationsRequest{Limit: &zero}, []string{"limit"}},
		{"limit 101", ListInvitationsRequest{Limit: &tooMany}, []string{"limit"}},
		{"search one character", ListInvitationsRequest{FilterSearch: &short}, []string{"filter_search"}},
		{"search two characters", ListInvitationsRequest{FilterSearch: &long}, []string{}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := testCase.request.Validate(); !slices.Equal(got, testCase.want) {
				t.Fatalf("Validate() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestCancelAndResendRequestsNormalizeAndValidate(t *testing.T) {
	t.Parallel()
	cancel := CancelInvitationsRequest{
		EmailAddresses: []common.EmailAddress{" A@Example.com", "b@example.com"},
	}
	cancel.Normalize()
	if got := cancel.Validate(); len(got) != 0 {
		t.Fatalf("cancel Validate() = %v", got)
	}
	duplicate := CancelInvitationsRequest{
		EmailAddresses: []common.EmailAddress{"a@example.com", "A@EXAMPLE.com"},
	}
	duplicate.Normalize()
	if got := duplicate.Validate(); !slices.Equal(got, []string{"email_addresses"}) {
		t.Fatalf("duplicate cancel Validate() = %v", got)
	}
	invalid := CancelInvitationsRequest{EmailAddresses: []common.EmailAddress{"nope"}}
	invalid.Normalize()
	if got := invalid.Validate(); !slices.Equal(got, []string{"email_addresses"}) {
		t.Fatalf("invalid cancel Validate() = %v", got)
	}
	resend := ResendInvitationRequest{EmailAddress: " X@Example.com "}
	resend.Normalize()
	if resend.EmailAddress != "x@example.com" || len(resend.Validate()) != 0 {
		t.Fatalf("resend = %+v, %v", resend, resend.Validate())
	}
}

func TestAcceptInvitationRequestValidate(t *testing.T) {
	t.Parallel()
	valid := AcceptInvitationRequest{
		InvitationToken:   OrgInvitationToken("0123456789abcdef0123456789abcdef"),
		Password:          "a-long-enough-password",
		PreferredLanguage: "de-DE",
	}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("valid Validate() = %v", got)
	}
	invalid := AcceptInvitationRequest{
		InvitationToken: "short", Password: "short", PreferredLanguage: "fr-FR",
	}
	want := []string{"invitation_token", "password", "preferred_language"}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("invalid Validate() = %v, want %v", got, want)
	}
}
