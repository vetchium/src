package users

import (
	"slices"
	"strings"
	"testing"
)

func TestSuggestOrgUsersValidatesQueryAndLimit(t *testing.T) {
	t.Parallel()
	query := func(value string) *UserSuggestionQuery {
		q := UserSuggestionQuery(value)
		return &q
	}
	limit := func(value int32) *int32 { return &value }
	tests := []struct {
		name    string
		request SuggestOrgUsersRequest
		want    []string
	}{
		{"no query", SuggestOrgUsersRequest{}, []string{}},
		{"bounds", SuggestOrgUsersRequest{Query: query(strings.Repeat("é", 100)), Limit: limit(20)}, []string{}},
		{"empty query", SuggestOrgUsersRequest{Query: query("")}, []string{"query"}},
		{"long query", SuggestOrgUsersRequest{Query: query(strings.Repeat("a", 101))}, []string{"query"}},
		{"NUL query", SuggestOrgUsersRequest{Query: query("a\x00b")}, []string{"query"}},
		{"untrimmed query and zero limit", SuggestOrgUsersRequest{Query: query(" a"), Limit: limit(0)}, []string{"query", "limit"}},
		{"limit above maximum", SuggestOrgUsersRequest{Limit: limit(21)}, []string{"limit"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.request.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
}

func TestSuggestOrgUsersNormalizesACopy(t *testing.T) {
	t.Parallel()
	original := UserSuggestionQuery("  Pri ")
	request := SuggestOrgUsersRequest{Query: &original}
	request.Normalize()
	if *request.Query != "Pri" || original != "  Pri " {
		t.Fatalf("query = %q, original = %q", *request.Query, original)
	}
	if request.EffectiveLimit() != MaxUserSuggestions {
		t.Fatalf("default limit = %d", request.EffectiveLimit())
	}
	empty := SuggestOrgUsersRequest{}
	empty.Normalize()
	if empty.Query != nil {
		t.Fatal("an absent query stays absent")
	}
}
