package hubsignupdomains

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestDomainNameNormalizationAndValidation(t *testing.T) {
	valid := []string{
		"example.com",
		"jobs.example.co.in",
		"xn--bcher-kva.example",
		"a-b.example",
		strings.Repeat("a", 63) + ".example",
	}
	for _, value := range valid {
		if !IsDomainName(DomainName(value)) {
			t.Errorf("IsDomainName(%q) = false", value)
		}
	}
	if normalized := NormalizeDomainName("  EXAMPLE.COM.  "); normalized != "example.com" {
		t.Fatalf("NormalizeDomainName() = %q", normalized)
	}

	invalid := []string{
		"",
		"localhost",
		"*.example.com",
		"user@example.com",
		"https://example.com",
		"example.com:443",
		"127.0.0.1",
		"example.123",
		"example..com",
		"-example.com",
		"example-.com",
		"example.c_m",
		"bücher.example",
		strings.Repeat("a", 64) + ".example",
		strings.Repeat("a", 246) + ".example",
	}
	for _, value := range invalid {
		if IsDomainName(DomainName(value)) {
			t.Errorf("IsDomainName(%q) = true", value)
		}
	}
}

func TestRequestsNormalizeInPlaceAndReportAllFields(t *testing.T) {
	state := Active
	create := CreateRequest{Domain: " EXAMPLE.COM. ", State: &state}
	create.Normalize()
	if create.Domain != "example.com" {
		t.Fatalf("create normalization = %#v", create)
	}
	if fields := create.Validate(); len(fields) != 0 {
		t.Fatalf("valid create fields = %v", fields)
	}
	comment := DisableComment("  Vendor contract ended  ")
	disabledState := Disabled
	disabledCreate := CreateRequest{
		Domain: "example.org", State: &disabledState, DisabledComment: &comment,
	}
	disabledCreate.Normalize()
	if *disabledCreate.DisabledComment != "Vendor contract ended" ||
		len(disabledCreate.Validate()) != 0 {
		t.Fatalf("disabled create normalization = %#v", disabledCreate)
	}
	// Normalizing an optional field must retarget the pointer rather than
	// write through it, so a value the caller still holds stays untouched.
	if comment != "  Vendor contract ended  " {
		t.Fatalf("normalization wrote through the caller's pointer: %q", comment)
	}

	badState := State("retired")
	create = CreateRequest{Domain: "bad", State: &badState}
	if fields := create.Validate(); !slices.Equal(
		fields, []string{"domain", "state"},
	) {
		t.Fatalf("CreateRequest.Validate() = %v", fields)
	}

	update := UpdateRequest{
		HubSignupDomainID: "bad",
		Domain:            "not-a-domain",
		State:             badState,
	}
	if fields := update.Validate(); !slices.Equal(fields, []string{
		"hub_signup_domain_id", "domain", "state",
	}) {
		t.Fatalf("UpdateRequest.Validate() = %v", fields)
	}

	missingComment := UpdateRequest{
		HubSignupDomainID: "11111111-1111-4111-8111-111111111111",
		Domain:            "example.com",
		State:             Disabled,
	}
	if fields := missingComment.Validate(); !slices.Equal(
		fields, []string{"disabled_comment"},
	) {
		t.Fatalf("missing disable comment fields = %v", fields)
	}
	activeWithComment := missingComment
	activeWithComment.State = Active
	activeWithComment.DisabledComment = &comment
	if fields := activeWithComment.Validate(); !slices.Equal(
		fields, []string{"disabled_comment"},
	) {
		t.Fatalf("active disable comment fields = %v", fields)
	}
	tooLong := DisableComment(strings.Repeat("界", 501))
	missingComment.DisabledComment = &tooLong
	if fields := missingComment.Validate(); !slices.Equal(
		fields, []string{"disabled_comment"},
	) {
		t.Fatalf("long disable comment fields = %v", fields)
	}
}

func TestListRequestDefaultsNormalizationAndBounds(t *testing.T) {
	request := ListRequest{}
	if request.EffectiveLimit() != 50 || len(request.Validate()) != 0 {
		t.Fatalf("default list request = %#v", request)
	}
	search := DomainFilterText("  EXAMPLE  ")
	request.FilterSearch = &search
	if fields := request.Validate(); len(fields) != 0 {
		t.Fatalf("uppercase search fields = %v", fields)
	}
	request.Normalize()
	if *request.FilterSearch != "example" {
		t.Fatalf("list normalization = %#v", request)
	}
	if search != "  EXAMPLE  " {
		t.Fatalf("normalization wrote through the caller's pointer: %q", search)
	}

	zero := commonPageSize(0)
	emptyKey := commonPaginationKey("")
	emptySearch := DomainFilterText("%")
	badState := State("retired")
	request = ListRequest{
		Limit:         &zero,
		PaginationKey: &emptyKey,
		FilterSearch:  &emptySearch,
		FilterState:   &badState,
	}
	want := []string{"limit", "pagination_key", "filter_search", "filter_state"}
	if fields := request.Validate(); !slices.Equal(fields, want) {
		t.Fatalf("ListRequest.Validate() = %v, want %v", fields, want)
	}
}

func commonPageSize(value int32) common.PageSize {
	return common.PageSize(value)
}

func commonPaginationKey(value string) common.PaginationKey {
	return common.PaginationKey(value)
}
