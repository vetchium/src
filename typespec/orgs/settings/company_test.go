package settings

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
)

func TestCompanyDetails(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		valid bool
	}{{"  நிறுவனம்  ", true}, {"", false}, {" \t ", false}, {strings.Repeat("界", 200), true}, {strings.Repeat("界", 201), false}} {
		r := SetCompanyDetailsRequest{
			DisplayName: common.DisplayName(test.name), Country: "IN",
			DefaultLanguage: orgs.Tamil,
		}
		r.Normalize()
		if (len(r.Validate()) == 0) != test.valid {
			t.Errorf("valid=%t for name length %d", !test.valid, len([]rune(test.name)))
		}
	}
	invalid := SetCompanyDetailsRequest{
		DisplayName: "Acme", Country: "in", DefaultLanguage: "en",
	}
	want := []string{"country", "default_language"}
	if got := invalid.Validate(); !slices.Equal(got, want) {
		t.Fatalf("Validate() = %v, want %v", got, want)
	}
}
