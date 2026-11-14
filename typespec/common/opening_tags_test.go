package common

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIsOpeningTagOID(t *testing.T) {
	t.Parallel()
	valid := []string{"go", "c-plus-plus", strings.Repeat("a", 64)}
	for _, value := range valid {
		if !IsOpeningTagOID(OpeningTagOID(value)) {
			t.Errorf("IsOpeningTagOID(%q) = false, want true", value)
		}
	}
	invalid := []string{
		"a", strings.Repeat("a", 65), "Go", "-go", "go-", "go--lang",
		"go_lang", "c#",
	}
	for _, value := range invalid {
		if IsOpeningTagOID(OpeningTagOID(value)) {
			t.Errorf("IsOpeningTagOID(%q) = true, want false", value)
		}
	}
}

func TestListOpeningTagsResponseEncodesEmptyCollections(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		response ListOpeningTagsResponse
		want     string
	}{
		{"nil tags", ListOpeningTagsResponse{}, `{"tags":[]}`},
		{
			"nil localized names",
			ListOpeningTagsResponse{Tags: []OpeningTag{{TagOID: "golang", DisplayName: "Go"}}},
			`{"tags":[{"tag_oid":"golang","display_name":"Go","localized_names":{},"deprecated":false}]}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := json.Marshal(tc.response)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tc.want {
				t.Errorf("json.Marshal = %s, want %s", got, tc.want)
			}
		})
	}
}
