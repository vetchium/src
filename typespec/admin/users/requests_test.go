package users

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestCompleteSetupNormalizeAndValidate(t *testing.T) {
	request := CompleteSetupRequest{
		InvitationToken: "tttttttttttttttttttttttttttttttt",
		Password:        "a sufficiently long password",
		DisplayNames: []common.LocalizedDisplayName{
			{LanguageCode: "en-US", DisplayName: "  Admin  "},
			{LanguageCode: "ta-IN", DisplayName: " நிர்வாகி "},
		},
		PrimaryDisplayNameLanguage: "en-US",
		PreferredLanguage:          common.Tamil,
	}
	normalized := request.Normalize()
	if normalized.DisplayNames[0].DisplayName != "Admin" ||
		request.DisplayNames[0].DisplayName != "  Admin  " {
		t.Fatalf("normalization mutated input: %#v %#v", request, normalized)
	}
	if fields := normalized.Validate(); len(fields) != 0 {
		t.Fatalf("valid request fields = %v", fields)
	}

	normalized.DisplayNames = []common.LocalizedDisplayName{
		{LanguageCode: "en-US", DisplayName: "Admin"},
		{LanguageCode: "en-US", DisplayName: "Duplicate"},
	}
	normalized.PrimaryDisplayNameLanguage = "ta-IN"
	normalized.PreferredLanguage = common.FrontendLocale("fr-FR")
	want := []string{
		"display_names", "primary_display_name_language",
		"preferred_language",
	}
	if fields := normalized.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("Validate() = %v, want %v", fields, want)
	}
}
