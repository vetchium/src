package openings

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestListOrgOpeningsTagFilter(t *testing.T) {
	t.Parallel()
	wellFormed := common.OpeningTagOID("golang")
	malformed := common.OpeningTagOID("Go Lang")
	tests := []struct {
		name string
		tag  *common.OpeningTagOID
		want []string
	}{
		{"absent", nil, []string{}},
		{"well-formed", &wellFormed, []string{}},
		{"malformed", &malformed, []string{"tag_oid"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ListOrgOpeningsRequest{Domain: "example.com", TagOID: test.tag}.Validate()
			if !slices.Equal(got, test.want) {
				t.Fatalf("Validate() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPublicOpeningSummaryTagsAreAlwaysAList(t *testing.T) {
	t.Parallel()
	body, err := json.Marshal(PublicOpeningSummary{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"tags":[]`) {
		t.Fatalf("summary without tags = %s, want \"tags\":[]", body)
	}
}

func TestPublicOpeningSummarySalaryOnlyWhenDisclosed(t *testing.T) {
	t.Parallel()
	body, err := json.Marshal(PublicOpeningSummary{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "salary") {
		t.Fatalf("summary without salary = %s", body)
	}
	body, err = json.Marshal(PublicOpeningSummary{Salary: &common.OpeningSalary{
		Currency: "EUR", Min: 50000, Max: 70000, Period: common.OpeningYear,
	}})
	if err != nil {
		t.Fatal(err)
	}
	want := `"salary":{"currency":"EUR","min":50000,"max":70000,"period":"year"}`
	if !strings.Contains(string(body), want) {
		t.Fatalf("summary with salary = %s, want %s", body, want)
	}
}
