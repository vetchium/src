package work

import (
	"slices"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/hub"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"
)

const (
	providerDID  = orgs.OrgDID("01900000-0000-7000-8000-000000000002")
	applicantDID = hub.HubUserDID("01900000-0000-7000-8000-000000000004")
)

func TestCreditedReadsResumeAtAPosition(t *testing.T) {
	t.Parallel()
	position := CreditedPosition{
		AppliedAt:    time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC),
		EngagementID: engagementID, OpeningNumber: 3, ApplicationNumber: 7,
	}
	if !position.Valid() {
		t.Fatal("a complete position is valid")
	}
	for name, bad := range map[string]CreditedPosition{
		"no instant":     {EngagementID: engagementID, OpeningNumber: 3, ApplicationNumber: 7},
		"bad engagement": {AppliedAt: position.AppliedAt, EngagementID: "x", OpeningNumber: 3, ApplicationNumber: 7},
		"no opening":     {AppliedAt: position.AppliedAt, EngagementID: engagementID, ApplicationNumber: 7},
		"no application": {AppliedAt: position.AppliedAt, EngagementID: engagementID, OpeningNumber: 3},
	} {
		if bad.Valid() {
			t.Fatalf("%s must be invalid", name)
		}
	}

	list := PeerListCreditedApplicationsRequest{
		ProviderOrgDID: providerDID, ApplicantDIDs: []hub.HubUserDID{applicantDID},
		After: &position, Limit: 50,
	}
	if got := list.Validate(); len(got) != 0 {
		t.Fatalf("valid list rejected: %v", got)
	}
	opening := openings.OpeningNumber(0)
	route := marketplace.ReferralRoute("invited")
	status := hubspec.ApplicationStatus("pending")
	got := PeerListCreditedApplicationsRequest{
		ProviderOrgDID: "x", ClientDomain: orgDomain("not a domain"),
		OpeningNumber: &opening, Route: &route, Status: &status,
		ApplicantDIDs: []hub.HubUserDID{}, After: &CreditedPosition{},
	}.Validate()
	want := []string{"provider_org_did", "client_domain", "opening_number",
		"route", "status", "applicant_dids", "after", "limit"}
	if !slices.Equal(got, want) {
		t.Fatalf("list fields = %v, want %v", got, want)
	}
	tooMany := list
	tooMany.ApplicantDIDs = slices.Repeat([]hub.HubUserDID{applicantDID}, maxApplicants+1)
	if got := tooMany.Validate(); !slices.Equal(got, []string{"applicant_dids"}) {
		t.Fatalf("a read names at most a page of applicants: %v", got)
	}

	relay := RelayListCreditedApplicationsRequest{Tenant: "sgp", Request: list}
	relay.Request.ClientDomain = orgDomain(" Client.Example ")
	original := *relay.Request.ClientDomain
	copied := relay
	copied.Normalize()
	if *copied.Request.ClientDomain != "client.example" || original != " Client.Example " {
		t.Fatalf("normalized %q from %q", *copied.Request.ClientDomain, original)
	}
	if got := copied.Validate(); len(got) != 0 {
		t.Fatalf("valid relay rejected: %v", got)
	}
}

func TestCreditedCountsNameApplicants(t *testing.T) {
	t.Parallel()
	count := PeerCountCreditedApplicationsRequest{
		ProviderOrgDID: providerDID, ApplicantDIDs: []hub.HubUserDID{applicantDID},
	}
	if got := count.Validate(); len(got) != 0 {
		t.Fatalf("valid count rejected: %v", got)
	}
	got := PeerCountCreditedApplicationsRequest{ProviderOrgDID: "x", ApplicantDIDs: []hub.HubUserDID{"y"}}.Validate()
	if want := []string{"provider_org_did", "applicant_dids"}; !slices.Equal(got, want) {
		t.Fatalf("count fields = %v, want %v", got, want)
	}
	if got := (RelayCountCreditedApplicationsRequest{Tenant: "sgp", Request: count}).Validate(); len(got) != 0 {
		t.Fatalf("valid relay rejected: %v", got)
	}
	got = RelayCountCreditedApplicationsRequest{
		Tenant:  "Nope!",
		Request: PeerCountCreditedApplicationsRequest{ProviderOrgDID: providerDID},
	}.Validate()
	if want := []string{"tenant", "request.applicant_dids"}; !slices.Equal(got, want) {
		t.Fatalf("relay fields = %v, want %v", got, want)
	}
}
