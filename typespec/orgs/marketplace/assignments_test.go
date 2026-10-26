package marketplace

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/orgs/hiring"
)

func TestAssignmentRequestsValidate(t *testing.T) {
	t.Parallel()
	stage := hiring.PipelineStageID("01900000-0000-7000-8000-000000000009")
	badStage := hiring.PipelineStageID("x")
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"opening-wide", AssignOpeningProviderRequest{OpeningNumber: 1, EngagementID: engagementID}.Validate(), []string{}},
		{"stage", AssignOpeningProviderRequest{OpeningNumber: 1, EngagementID: engagementID, StageID: &stage}.Validate(), []string{}},
		{"bad numbers", AssignOpeningProviderRequest{StageID: &badStage}.Validate(), []string{"opening_number", "engagement_id", "stage_id"}},
		{"unassign", UnassignOpeningProviderRequest{OpeningNumber: 2, EngagementID: engagementID, StageID: &stage}.Validate(), []string{}},
		{"unassign invalid", UnassignOpeningProviderRequest{OpeningNumber: 0, EngagementID: "x"}.Validate(), []string{"opening_number", "engagement_id"}},
		{"read", GetOpeningProvidersRequest{OpeningNumber: 1}.Validate(), []string{}},
		{"read invalid", GetOpeningProvidersRequest{}.Validate(), []string{"opening_number"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
	if MaxOpeningAgencies != 20 || MaxStageProviders != 10 {
		t.Fatal("the caps are 20 agencies per Opening and 10 providers per stage")
	}
}

func TestPeerEngagementListingRequestValidation(t *testing.T) {
	t.Parallel()
	good := PeerEngagementListingRequest{
		EngagementID:   engagementID,
		ConsumerOrgDID: "01900000-0000-7000-8000-000000000001",
	}
	if got := good.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if got := (PeerEngagementListingRequest{}).Validate(); !slices.Equal(got, []string{"engagement_id", "consumer_org_did"}) {
		t.Fatalf("fields = %v", got)
	}
	relay := RelayEngagementListingRequest{Tenant: "Bad", Request: PeerEngagementListingRequest{}}
	want := []string{"tenant", "request.engagement_id", "request.consumer_org_did"}
	if got := relay.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
