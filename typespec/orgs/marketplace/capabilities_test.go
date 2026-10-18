package marketplace

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/orgs/hiring"
)

func TestCapabilitiesAreStableAndCopied(t *testing.T) {
	t.Parallel()
	want := []Capability{
		"sourcing", "interviewing", "assessment", "background_check",
	}
	got := Capabilities()
	if !slices.Equal(got, want) {
		t.Fatalf("Capabilities() = %v, want %v", got, want)
	}
	got[0] = "changed"
	if !slices.Equal(Capabilities(), want) {
		t.Fatal("caller mutated the Capability catalog")
	}
}

func TestIsCapability(t *testing.T) {
	t.Parallel()
	for _, capability := range Capabilities() {
		if !IsCapability(capability) {
			t.Fatalf("defined Capability %q rejected", capability)
		}
	}
	if IsCapability("") || IsCapability("review") || IsCapability("Sourcing") {
		t.Fatal("unknown Capability accepted")
	}
}

func TestStageCapabilitiesPerformTheirStageKind(t *testing.T) {
	t.Parallel()
	cases := []struct {
		capability Capability
		kind       hiring.StageKind
		isStage    bool
	}{
		{Sourcing, "", false},
		{Interviewing, hiring.InterviewStage, true},
		{Assessment, hiring.AssessmentStage, true},
		{BackgroundCheck, hiring.BackgroundCheckStage, true},
		{"unknown", "", false},
	}
	for _, testCase := range cases {
		kind, ok := testCase.capability.StageKind()
		if kind != testCase.kind || ok != testCase.isStage ||
			testCase.capability.IsStage() != testCase.isStage {
			t.Fatalf("%q: StageKind() = %q, %t, want %q, %t",
				testCase.capability, kind, ok, testCase.kind,
				testCase.isStage)
		}
		if ok && !hiring.IsStageKind(kind) {
			t.Fatalf("%q performs undefined stage kind %q",
				testCase.capability, kind)
		}
	}
}

func TestNoCapabilityPerformsReviewStages(t *testing.T) {
	t.Parallel()
	for _, capability := range Capabilities() {
		if kind, _ := capability.StageKind(); kind == hiring.ReviewStage {
			t.Fatalf("%q performs in-house-only review stages", capability)
		}
	}
}
