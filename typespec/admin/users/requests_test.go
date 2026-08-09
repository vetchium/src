package users

import (
	"slices"
	"testing"

	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/common"
)

func TestCompleteSetupNormalizeAndValidate(t *testing.T) {
	language := admincommon.TamilIndia
	timezone := common.TimeZoneID("Asia/Kolkata")
	request := CompleteSetupRequest{
		InvitationToken: "tttttttttttttttttttttttttttttttt",
		Password:        "a sufficiently long password",
		DisplayNames: []common.LocalizedDisplayName{
			{LanguageCode: "en-US", DisplayName: "  Admin  "},
			{LanguageCode: "ta-IN", DisplayName: " நிர்வாகி "},
		},
		PrimaryDisplayNameLanguage: "en-US",
		PreferredLanguage:          &language,
		PreferredTimezone:          &timezone,
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
	invalidLanguage := admincommon.LanguageCode("fr-FR")
	invalidTimezone := common.TimeZoneID("US/Eastern")
	normalized.PreferredLanguage = &invalidLanguage
	normalized.PreferredTimezone = &invalidTimezone
	want := []string{
		"display_names", "primary_display_name_language",
		"preferred_language", "preferred_timezone",
	}
	if fields := normalized.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("Validate() = %v, want %v", fields, want)
	}
}
