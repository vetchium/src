package auditlogs

import (
	"reflect"
	"testing"

	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

func TestListValidation(t *testing.T) {
	t.Parallel()
	email := common.EmailAddress("person@example.test")
	tests := []struct {
		name, start, end string
		invalid          bool
	}{
		{"exact 31 days", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", false},
		{"over by nanosecond", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00.000000001Z", true},
		{"reversed", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", true},
		{"equal", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", false},
		{"offset", "2026-01-01T00:00:00+00:00", "2026-01-02T00:00:00Z", true},
		{"missing", "", "", true},
		{"invalid", "2026-02-30T00:00:00Z", "2026-03-01T00:00:00Z", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := ListRequest{StartAt: tt.start, EndAt: tt.end, HubEmail: &email}
			if got := len(r.Validate()) > 0; got != tt.invalid {
				t.Fatalf("fields=%v", r.Validate())
			}
		})
	}
	r := ListRequest{StartAt: tests[0].start, EndAt: tests[0].end}
	if len(r.Validate()) != 4 {
		t.Fatalf("identity required: %v", r.Validate())
	}
	invalidEmail := common.EmailAddress("bad")
	invalidHandle := hub.HubHandle("bad")
	invalidDomain := hubsignupdomains.DomainName("*.example.test")
	badLimit := common.PageSize(101)
	emptyKey := common.PaginationKey("")
	r.HubEmail = &invalidEmail
	r.OrgUserEmail = &invalidEmail
	r.HubHandle = &invalidHandle
	r.OrgDomain = &invalidDomain
	r.Limit = &badLimit
	r.PaginationKey = &emptyKey
	want := []string{"hub_handle", "hub_email", "org_domain", "org_user_email", "limit", "pagination_key"}
	if !reflect.DeepEqual(r.Validate(), want) {
		t.Fatalf("got %v", r.Validate())
	}
}

func TestNormalizePreservesOriginal(t *testing.T) {
	t.Parallel()
	handle := hub.HubHandle(" ABCDEF12-123456789AB ")
	email := common.EmailAddress(" PERSON@EXAMPLE.TEST ")
	domain := hubsignupdomains.DomainName(" EXAMPLE.TEST. ")
	original := ListRequest{HubHandle: &handle, HubEmail: &email, OrgUserEmail: &email, OrgDomain: &domain}
	copy := original
	copy.Normalize()
	if string(*copy.HubHandle) != "abcdef12-123456789ab" || string(*copy.HubEmail) != "person@example.test" || string(*copy.OrgDomain) != "example.test" {
		t.Fatalf("normalized=%+v", copy)
	}
	if *original.HubHandle != handle || *original.HubEmail != email || *original.OrgDomain != domain || *original.OrgUserEmail != email {
		t.Fatal("mutated input")
	}
}
