package users

import (
	"slices"
	"testing"

	adminspec "github.com/vetchium/src/typespec/admin"
)

func TestCompleteSetupNormalizeAndValidate(t *testing.T) {
	request := CompleteSetupRequest{
		InvitationToken:   "tttttttttttttttttttttttttttttttt",
		Password:          "a sufficiently long password",
		DisplayName:       "  நிர்வாகி  ",
		PreferredLanguage: adminspec.Tamil,
	}
	request.Normalize()
	if request.DisplayName != "நிர்வாகி" {
		t.Fatalf("normalization = %#v", request)
	}
	if fields := request.Validate(); len(fields) != 0 {
		t.Fatalf("valid request fields = %v", fields)
	}

	request.DisplayName = " "
	request.PreferredLanguage = adminspec.FrontendLocale("fr-FR")
	want := []string{"display_name", "preferred_language"}
	if fields := request.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("Validate() = %v, want %v", fields, want)
	}
}
