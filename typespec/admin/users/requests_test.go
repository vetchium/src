package users

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestCompleteSetupNormalizeAndValidate(t *testing.T) {
	request := CompleteSetupRequest{
		InvitationToken:   "tttttttttttttttttttttttttttttttt",
		Password:          "a sufficiently long password",
		DisplayName:       "  நிர்வாகி  ",
		PreferredLanguage: common.Tamil,
	}
	normalized := request.Normalize()
	if normalized.DisplayName != "நிர்வாகி" ||
		request.DisplayName != "  நிர்வாகி  " {
		t.Fatalf("normalization mutated input: %#v %#v", request, normalized)
	}
	if fields := normalized.Validate(); len(fields) != 0 {
		t.Fatalf("valid request fields = %v", fields)
	}

	normalized.DisplayName = " "
	normalized.PreferredLanguage = common.FrontendLocale("fr-FR")
	want := []string{"display_name", "preferred_language"}
	if fields := normalized.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("Validate() = %v, want %v", fields, want)
	}
}
