package marketplace

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

const engagementID = EngagementID("01900000-0000-7000-8000-000000000001")

func TestEngagementStates(t *testing.T) {
	t.Parallel()
	if len(EngagementStates()) != 6 || !IsEngagementState(ActiveEngagement) || IsEngagementState("paused") {
		t.Fatal("unexpected engagement states")
	}
	for _, state := range EngagementStates() {
		want := state != ProposedEngagement && state != ActiveEngagement
		if state.IsTerminal() != want {
			t.Errorf("%s terminal = %t, want %t", state, state.IsTerminal(), want)
		}
	}
	if !IsEngagementParty(ConsumerParty) || !IsEngagementParty(ProviderParty) || IsEngagementParty("both") {
		t.Fatal("unexpected parties")
	}
}

func TestProposeEngagementNormalizesAndValidates(t *testing.T) {
	t.Parallel()
	message := "  Hello  "
	request := ProposeEngagementRequest{ProviderDomain: " ACME.test ", Capability: Interviewing, Message: &message}
	request.Normalize()
	if request.ProviderDomain != "acme.test" || *request.Message != "Hello" || message != "  Hello  " {
		t.Fatalf("normalized = %+v (caller message %q)", request, message)
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	text := func(n int) *string { value := strings.Repeat("é", n); return &value }
	blank := ""
	nul := "a\x00"
	tests := []struct {
		name string
		in   ProposeEngagementRequest
		want []string
	}{
		{"no message", ProposeEngagementRequest{ProviderDomain: "acme.test", Capability: Sourcing}, []string{}},
		{"message 2000", ProposeEngagementRequest{ProviderDomain: "acme.test", Capability: Sourcing, Message: text(2000)}, []string{}},
		{"message 2001", ProposeEngagementRequest{ProviderDomain: "acme.test", Capability: Sourcing, Message: text(2001)}, []string{"message"}},
		{"blank message", ProposeEngagementRequest{ProviderDomain: "acme.test", Capability: Sourcing, Message: &blank}, []string{"message"}},
		{"NUL message", ProposeEngagementRequest{ProviderDomain: "acme.test", Capability: Sourcing, Message: &nul}, []string{"message"}},
		{"bad domain and capability", ProposeEngagementRequest{ProviderDomain: "x", Capability: "plumbing"}, []string{"provider_domain", "capability"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.in.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
}

func TestEngagementActionRequestsValidate(t *testing.T) {
	t.Parallel()
	text := func(n int) *string { value := strings.Repeat("é", n); return &value }
	if got := (EngagementTarget{EngagementID: engagementID, Version: 1}).Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if got := (EngagementTarget{EngagementID: "01900000-0000-7000-8000-00000000000A", Version: 0}).Validate(); !slices.Equal(got, []string{"engagement_id", "version"}) {
		t.Fatalf("fields = %v", got)
	}
	if got := (EndEngagementRequest{EngagementID: engagementID, Version: 1, Note: text(2000)}).Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if got := (EndEngagementRequest{EngagementID: engagementID, Version: 1, Note: text(2001)}).Validate(); !slices.Equal(got, []string{"note"}) {
		t.Fatalf("fields = %v", got)
	}
	if got := (SetEngagementReferenceRequest{EngagementID: engagementID, Version: 1}).Validate(); len(got) != 0 {
		t.Fatalf("clearing a reference must be valid: %v", got)
	}
	if got := (SetEngagementReferenceRequest{EngagementID: engagementID, Version: 1, Reference: text(200)}).Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if got := (SetEngagementReferenceRequest{EngagementID: engagementID, Version: 1, Reference: text(201)}).Validate(); !slices.Equal(got, []string{"reference"}) {
		t.Fatalf("fields = %v", got)
	}
	end := EndEngagementRequest{EngagementID: engagementID, Version: 1, Note: func() *string { v := "  bye  "; return &v }()}
	original := end.Note
	end.Normalize()
	if *end.Note != "bye" || *original != "  bye  " {
		t.Fatalf("normalized note %q (caller %q)", *end.Note, *original)
	}
	if got := (GetEngagementRequest{EngagementID: "x"}).Validate(); !slices.Equal(got, []string{"engagement_id"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestListEngagementsRequestValidates(t *testing.T) {
	t.Parallel()
	state, badState := ActiveEngagement, EngagementState("paused")
	capability, badCapability := Sourcing, Capability("x")
	zero, hundred, over := int32(0), int32(100), int32(101)
	tests := []struct {
		name string
		in   ListEngagementsRequest
		want []string
	}{
		{"empty", ListEngagementsRequest{}, []string{}},
		{"filters", ListEngagementsRequest{State: &state, Capability: &capability, Limit: &hundred}, []string{}},
		{"bad state", ListEngagementsRequest{State: &badState}, []string{"state"}},
		{"bad capability", ListEngagementsRequest{Capability: &badCapability}, []string{"capability"}},
		{"limit zero", ListEngagementsRequest{Limit: &zero}, []string{"limit"}},
		{"limit over", ListEngagementsRequest{Limit: &over}, []string{"limit"}},
		{"bad key", ListEngagementsRequest{PaginationKey: func() *common.PaginationKey { k := common.PaginationKey(""); return &k }()}, []string{"pagination_key"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.in.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
	if (ListEngagementsRequest{}).EffectiveLimit() != 50 {
		t.Fatal("default limit must be 50")
	}
}
